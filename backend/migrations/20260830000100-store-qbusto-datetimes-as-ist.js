'use strict';

/**
 * Convert every QBusto-owned datetime value from UTC storage to IST storage.
 *
 * WHY
 *
 * The client requires timestamps to be stored as IST. `datetime2` carries no
 * offset, so that means the columns must hold IST WALL CLOCK. From this
 * migration onward the application writes IST (config/config.js sets
 * `timezone: '+05:30'` with `useUTC: false`); this brings the rows that were
 * written under the previous UTC convention into line with them.
 *
 * NO SCHEMA CHANGE. Not one column type, nullability, index or constraint is
 * touched - every QBusto date column stays `datetime2(7)`. Converting them to
 * `datetime` was considered and rejected: Sequelize renders a DATE as
 * DATETIMEOFFSET, which `datetime` cannot accept, so every write through the
 * ORM would fail. Type does not carry timezone meaning either way.
 *
 * THIS MIGRATION IS NOT RE-RUNNABLE, WHICH IS UNUSUAL HERE
 *
 * The rest of this directory guards each step so it can run twice safely.
 * A value shift cannot work that way: running it twice moves everything a
 * further 5.5 hours, and the second run looks exactly like the first. Three
 * independent safeguards therefore replace the usual idempotent DDL guard:
 *
 *   1. A MARKER row. If it exists, up() logs and returns without touching a
 *      single value - so a re-run, or a restored SequelizeMeta, is inert.
 *   2. A VALUE-LEVEL BACKUP. Every value it changes is copied first, keyed by
 *      table/column/row id, so down() restores the exact original rather than
 *      applying an inverse formula.
 *   3. ONE TRANSACTION. Any failure rolls the whole thing back, marker and
 *      backup included.
 *
 * THE SHIFT IS NOT UNIFORM - THIS IS THE IMPORTANT PART
 *
 * Three groups, because the stored values do not all mean the same thing:
 *
 *   SHIFT +330   Genuine UTC instants: audit stamps, delivered_at, status log
 *                times. These move forward 5.5 hours to become IST.
 *
 *   SKIP         `orders.show_time` ALREADY holds IST wall clock. Two faults
 *                cancelled: the pre-fix Session getter read Vista's IST as if
 *                it were UTC, and that "instant" was written back as UTC wall
 *                clock, landing on the original digits. Verified against live
 *                data - 13 rows match a surviving session's
 *                Session_dtmRealShow exactly, and ZERO match it shifted.
 *                Shifting these would push every show 5.5 hours late.
 *
 *   NORMALISE    Date BOUNDARIES (a banner window, a cinema's active-since).
 *                These hold mixed provenance: some are plain midnights that
 *                were never converted, others are 18:30 - IST midnight already
 *                turned into UTC. Confirmed live: the only time components
 *                present are 00:00:00 and 18:30:00. Adding 330 minutes and
 *                flooring to midnight lands both on the intended IST date:
 *                00:00 -> +5:30 -> floors back to the same date; 18:30 ->
 *                next-day 00:00 -> floors to that date. A blanket shift would
 *                turn every midnight into 05:30.
 *
 * The client's Vista provider columns (`film`, `session`) are excluded
 * entirely - they already store IST and are not ours to rewrite.
 */

const MARKER_TABLE = 'qbusto_timezone_migration';
const BACKUP_TABLE = 'qbusto_timezone_migration_backup';
const MARKER_KEY = 'qbusto-datetimes-stored-as-ist';

/** IST is UTC+05:30, and has been since 1945. No DST. */
const IST_OFFSET_MINUTES = 330;

/** Client-owned provider tables. Their datetime columns are never touched. */
const VISTA_TABLES = new Set(['film', 'session']);

/** Already IST wall clock - must NOT be shifted. See header. */
const ALREADY_IST = new Set(['orders.show_time']);

/** Business-window edges, normalised to IST midnight rather than shifted. */
const DATE_BOUNDARY = new Set([
  'banners.start_date',
  'banners.end_date',
  'cinema_products.available_from',
  'cinema_products.available_until',
  'cinemas.active_since',
  'offers.valid_from',
  'offers.valid_until',
]);

function classify(key) {
  if (ALREADY_IST.has(key)) return 'SKIP';
  if (DATE_BOUNDARY.has(key)) return 'NORMALISE';
  return 'SHIFT';
}

async function tableExists(qi, name, transaction) {
  const [rows] = await qi.sequelize.query(
    `SELECT 1 AS present FROM sys.tables WHERE name = '${name}'`,
    { transaction }
  );
  return rows.length > 0;
}

/**
 * Every QBusto-owned datetime/datetime2 column, discovered from the live
 * schema rather than hard-coded, so a column added since this was written
 * cannot be silently left behind in UTC.
 *
 * Excludes this migration's OWN bookkeeping tables. They are datetime2 too,
 * so a naive scan picks them up and the migration shifts its own backup and
 * marker - corrupting the record of what the original values were, which is
 * the one thing that must survive. (Learned the hard way: an earlier run
 * shifted 915 backup rows and copied them into themselves.)
 */
const SELF_TABLES = new Set([MARKER_TABLE, BACKUP_TABLE]);

async function qbustoDateColumns(qi, transaction) {
  /*
   * Restricted to tables with a SINGLE-COLUMN `id` primary key.
   *
   * The backup below records a value as (table, column, row_id) and restores
   * it by joining on `t.[id]`, so a table keyed any other way cannot be backed
   * up or reversed. Naming `film`/`session` explicitly is not enough on its
   * own: this runs against a database that may also hold other client tables
   * restored from their .bak, and a schema-wide scan would either abort on
   * one or - worse - shift data this migration promises not to touch.
   *
   * A QBusto-owned table always has `id INT IDENTITY` as its primary key, so
   * this is a structural test for ownership rather than a hardcoded list that
   * silently rots as the client's schema grows.
   */
  const [rows] = await qi.sequelize.query(
    `SELECT t.name AS tbl, c.name AS col
       FROM sys.columns c
       JOIN sys.tables t ON t.object_id = c.object_id
       JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE ty.name IN ('datetime2', 'datetime')
        AND EXISTS (
          SELECT 1
            FROM sys.indexes i
            JOIN sys.index_columns ic
              ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns pk
              ON pk.object_id = i.object_id AND pk.column_id = ic.column_id
           WHERE i.is_primary_key = 1
             AND i.object_id = t.object_id
             AND pk.name = 'id'
           GROUP BY i.object_id
          HAVING COUNT(*) = 1
        )
      ORDER BY t.name, c.column_id`,
    { transaction }
  );

  return rows.filter((r) => !VISTA_TABLES.has(r.tbl) && !SELF_TABLES.has(r.tbl));
}

module.exports = {
  async up(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    // Safeguard 1: the marker. Checked before the transaction opens so a
    // re-run costs nothing and says clearly why it did nothing.
    if (await tableExists(queryInterface, MARKER_TABLE)) {
      const [done] = await queryInterface.sequelize.query(
        `SELECT 1 AS present FROM [${MARKER_TABLE}] WHERE migration_key = '${MARKER_KEY}'`
      );
      if (done.length > 0) {
        console.log(
          `[tz] ${MARKER_KEY} has already been applied - no values changed. ` +
            `Re-running would shift every timestamp a further ${IST_OFFSET_MINUTES} minutes.`
        );
        return;
      }
    }

    await queryInterface.sequelize.transaction(async (transaction) => {
      await q(
        `IF OBJECT_ID('${MARKER_TABLE}') IS NULL
         CREATE TABLE [${MARKER_TABLE}] (
           migration_key varchar(100) NOT NULL PRIMARY KEY,
           applied_at    datetime2(7) NOT NULL,
           values_shifted    int NOT NULL,
           values_normalised int NOT NULL,
           values_skipped    int NOT NULL
         )`,
        transaction
      );

      // Safeguard 2: the backup. old_value is datetime2(7) - the widest of the
      // types being copied - so nothing is rounded on the way in or out.
      await q(
        `IF OBJECT_ID('${BACKUP_TABLE}') IS NULL
         CREATE TABLE [${BACKUP_TABLE}] (
           id          int IDENTITY(1,1) PRIMARY KEY,
           table_name  varchar(128) NOT NULL,
           column_name varchar(128) NOT NULL,
           row_id      int NOT NULL,
           old_value   datetime2(7) NOT NULL
         )`,
        transaction
      );

      const columns = await qbustoDateColumns(queryInterface, transaction);

      let shifted = 0;
      let normalised = 0;
      let skipped = 0;

      for (const { tbl, col } of columns) {
        const key = `${tbl}.${col}`;
        const action = classify(key);

        const [countRows] = await q(
          `SELECT COUNT([${col}]) AS n FROM [${tbl}]`,
          transaction
        );
        const n = Number(countRows[0].n);

        if (action === 'SKIP') {
          skipped += n;
          if (n > 0) console.log(`[tz] SKIP      ${key.padEnd(42)} ${n} values already IST`);
          continue;
        }

        if (n === 0) continue;

        // Backed up before it is touched, so down() can restore the exact
        // value instead of trusting an inverse formula.
        await q(
          `INSERT INTO [${BACKUP_TABLE}] (table_name, column_name, row_id, old_value)
           SELECT '${tbl}', '${col}', [id], [${col}] FROM [${tbl}] WHERE [${col}] IS NOT NULL`,
          transaction
        );

        if (action === 'SHIFT') {
          await q(
            `UPDATE [${tbl}]
                SET [${col}] = DATEADD(MINUTE, ${IST_OFFSET_MINUTES}, [${col}])
              WHERE [${col}] IS NOT NULL`,
            transaction
          );
          shifted += n;
          console.log(`[tz] SHIFT     ${key.padEnd(42)} ${n} values +${IST_OFFSET_MINUTES}m`);
        } else {
          // Add the offset, then floor to midnight - see the header for why
          // this lands both 00:00 and 18:30 values on the intended IST date.
          await q(
            `UPDATE [${tbl}]
                SET [${col}] = DATEADD(DAY, DATEDIFF(DAY, 0, DATEADD(MINUTE, ${IST_OFFSET_MINUTES}, [${col}])), 0)
              WHERE [${col}] IS NOT NULL`,
            transaction
          );
          normalised += n;
          console.log(`[tz] NORMALISE ${key.padEnd(42)} ${n} values -> IST midnight`);
        }
      }

      await q(
        `INSERT INTO [${MARKER_TABLE}]
           (migration_key, applied_at, values_shifted, values_normalised, values_skipped)
         VALUES ('${MARKER_KEY}', SYSDATETIME(), ${shifted}, ${normalised}, ${skipped})`,
        transaction
      );

      console.log(
        `[tz] done: ${shifted} shifted, ${normalised} normalised, ${skipped} left as-is ` +
          `(${shifted + normalised} values changed).`
      );
    });
  },

  /**
   * Restores every value from the backup, exactly.
   *
   * Deliberately NOT an inverse formula. Subtracting 330 minutes would undo
   * the shift but could never recover the NORMALISE group - flooring to
   * midnight discards whether a value started at 00:00 or 18:30, so that half
   * is mathematically irreversible. Restoring recorded values is the only
   * honest reversal, and it is exact for both groups.
   */
  async down(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    if (!(await tableExists(queryInterface, BACKUP_TABLE))) {
      console.warn(
        `[tz] ${BACKUP_TABLE} is missing - the original values cannot be restored. ` +
          'Refusing to guess with an inverse shift; nothing changed.'
      );
      return;
    }

    await queryInterface.sequelize.transaction(async (transaction) => {
      const [pairs] = await q(
        `SELECT DISTINCT table_name, column_name FROM [${BACKUP_TABLE}]`,
        transaction
      );

      let restored = 0;

      for (const { table_name: tbl, column_name: col } of pairs) {
        await q(
          `UPDATE t
              SET t.[${col}] = b.old_value
             FROM [${tbl}] t
             JOIN [${BACKUP_TABLE}] b
               ON b.row_id = t.[id]
              AND b.table_name = '${tbl}'
              AND b.column_name = '${col}'`,
          transaction
        );

        // Counted from the backup rather than @@ROWCOUNT: a multi-statement
        // batch's result shape is dialect-dependent, and the backup is the
        // authoritative record of what this migration actually changed.
        const [c] = await q(
          `SELECT COUNT(*) AS n FROM [${BACKUP_TABLE}]
            WHERE table_name = '${tbl}' AND column_name = '${col}'`,
          transaction
        );
        const n = Number(c[0].n);
        restored += n;
        console.log(`[tz] restored  ${`${tbl}.${col}`.padEnd(42)} ${n} values`);
      }

      await q(`DELETE FROM [${MARKER_TABLE}] WHERE migration_key = '${MARKER_KEY}'`, transaction);
      await q(`DROP TABLE [${BACKUP_TABLE}]`, transaction);

      console.log(`[tz] reverted: ${restored} values restored from backup.`);
    });
  },
};
