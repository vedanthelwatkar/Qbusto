'use strict';

/**
 * `session` becomes the single source of truth for show data.
 *
 * THREE TABLES BECOME ONE
 *
 *   film        DROPPED. Its only application use was supplying a session's
 *               display title; that title now lives on the session row itself
 *               (`Film_strName`), so the join - and the table - stop earning
 *               their keep.
 *   shows       DROPPED. A QBusto-owned mirror of POS show data, created in
 *               20260813000100 and never populated (0 rows on every database
 *               checked). It duplicated `session` by construction: two tables
 *               answering "what is playing on this screen right now" is the
 *               ambiguity this migration removes.
 *   session     RESHAPED. Ten columns, one per fact the application actually
 *               reads, including the film title.
 *
 * THE SHAPE COMES FROM `session_old`, NOT FROM THIS FILE
 *
 * The client supplied the intended replacement as a table named `session_old`
 * sitting alongside the live one. This migration does not invent a schema: it
 * adopts that table's, verified column by column against the live database
 * before this file was written.
 *
 *   Code                   varchar(10)   NOT NULL   cinema code -> cinemas.code
 *   Session_lngSessionId   int           NOT NULL   provider session id
 *   Film_strName           varchar(200)  NULL       display title (NEW)
 *   Film_strCode           varchar(20)   NOT NULL   provider film code
 *   Screen_bytNum          int           NULL       auditorium number
 *   Screen_strName         varchar(25)   NULL       auditorium name
 *   Session_strStatus      varchar(1)    NOT NULL   O = open, the only bookable one
 *   Session_dtmRealShow    datetime      NOT NULL   start, IST wall clock
 *   Session_dtmFinishShow  datetime      NOT NULL   end, IST wall clock
 *   Session_dtmStamp       datetime      NULL       provider's own stamp
 *
 * The 14 columns that do not appear (PGroup_strCode, Session_strSeatAllocation,
 * Session_intSeatsAvail/Total, Event_*, Session_strSalesChannel, ...) are gone
 * on purpose. Only `Session_intSeatsAvail` was read by anything, and only to be
 * echoed back in a payload nothing consumed.
 *
 * NO DATA IS LOST, AND THAT WAS MEASURED
 *
 * `session_old` is not simply "the new one" - the two tables overlap but
 * neither contains the other. Measured on the live database before writing
 * this:
 *
 *   session      179 rows
 *   session_old  252 rows
 *   in session but NOT in session_old:   10 rows
 *   in session_old but NOT in session:   83 rows
 *
 * So a plain drop-and-rename would silently lose 10 rows. Step 2 below copies
 * them across first. All 10 carry `Session_lngSessionId >= 900000`, the range
 * `scripts/seed-dev-sessions.js` reserves for development rows, so on the
 * client's own database this step is expected to move nothing - it is
 * correctness insurance, not a data fix.
 *
 * THE TITLE BACKFILL IS WHAT MAKES DROPPING `film` SAFE
 *
 * 223 of the 252 `session_old` rows have a NULL `Film_strName`. Step 1 fills
 * every one of them from `film.Film_strTitle` BEFORE the table is dropped.
 * Verified on live data: 223 of 223 resolve, and zero rows would still be NULL
 * afterwards. Dropping `film` first, or skipping this step, would leave 88% of
 * the schedule with no title to show a customer.
 *
 * TWO WORLDS, TWO PATHS
 *
 * 20260824000100 creates `film` and the OLD `session` on a database that has
 * neither - a fresh install, CI, disaster recovery. Such a database reaches
 * this migration with the old `session` and NO `session_old` at all, so a
 * rename would have nothing to rename. Step 3 handles that by reshaping
 * `session` in place instead. Both paths end at exactly the same schema, which
 * `scripts/verify-schema.js` then checks.
 *
 * RE-RUNNABLE. Every step is guarded by an existence check, per the
 * conventions in .claude/rules/migrations.md. Running it against an
 * already-migrated database changes nothing.
 *
 * `down()` IS DELIBERATELY PARTIAL - see the note on it below.
 */

const TARGET_COLUMNS = [
  ['Code', 'varchar(10)', 'NOT NULL'],
  ['Session_lngSessionId', 'int', 'NOT NULL'],
  ['Film_strName', 'varchar(200)', 'NULL'],
  ['Film_strCode', 'varchar(20)', 'NOT NULL'],
  ['Screen_bytNum', 'int', 'NULL'],
  ['Screen_strName', 'varchar(25)', 'NULL'],
  ['Session_strStatus', 'varchar(1)', 'NOT NULL'],
  ['Session_dtmRealShow', 'datetime', 'NOT NULL'],
  ['Session_dtmFinishShow', 'datetime', 'NOT NULL'],
  ['Session_dtmStamp', 'datetime', 'NULL'],
];

async function scalar(queryInterface, sql, transaction) {
  const [rows] = await queryInterface.sequelize.query(sql, { transaction });
  return rows.length ? Object.values(rows[0])[0] : null;
}

async function tableExists(queryInterface, name, transaction) {
  return (
    (await scalar(
      queryInterface,
      `SELECT COUNT(*) c FROM sys.tables WHERE name = '${name}' AND schema_id = SCHEMA_ID('dbo')`,
      transaction
    )) > 0
  );
}

async function columnExists(queryInterface, table, column, transaction) {
  return (
    (await scalar(
      queryInterface,
      `SELECT COUNT(*) c FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.${table}') AND name = '${column}'`,
      transaction
    )) > 0
  );
}

async function constraintExists(queryInterface, name, transaction) {
  return (
    (await scalar(
      queryInterface,
      `SELECT COUNT(*) c FROM sys.objects WHERE name = '${name}' AND parent_object_id > 0`,
      transaction
    )) > 0
  );
}

async function indexExists(queryInterface, table, name, transaction) {
  return (
    (await scalar(
      queryInterface,
      `SELECT COUNT(*) c FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.${table}') AND name = '${name}'`,
      transaction
    )) > 0
  );
}

/** Drop every foreign key pointing AT a table, so the table can be dropped. */
async function dropInboundForeignKeys(queryInterface, table, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT fk.name AS name, OBJECT_NAME(fk.parent_object_id) AS child
       FROM sys.foreign_keys fk
      WHERE fk.referenced_object_id = OBJECT_ID('dbo.${table}')`,
    { transaction }
  );

  for (const row of rows) {
    await queryInterface.sequelize.query(
      `ALTER TABLE [dbo].[${row.child}] DROP CONSTRAINT [${row.name}]`,
      { transaction }
    );
  }
}

/** Drop every foreign key OWNED BY a table. */
async function dropOutboundForeignKeys(queryInterface, table, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT name FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.${table}')`,
    { transaction }
  );

  for (const row of rows) {
    await queryInterface.sequelize.query(
      `ALTER TABLE [dbo].[${table}] DROP CONSTRAINT [${row.name}]`,
      { transaction }
    );
  }
}

module.exports = {
  async up(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    await queryInterface.sequelize.transaction(async (transaction) => {
      const hasFilm = await tableExists(queryInterface, 'film', transaction);
      const hasSessionOld = await tableExists(queryInterface, 'session_old', transaction);
      const hasSession = await tableExists(queryInterface, 'session', transaction);

      if (!hasSession && !hasSessionOld) {
        throw new Error(
          'Neither `session` nor `session_old` exists. Run 20260824000100-provision-client-schema first.'
        );
      }

      // ---------------------------------------------------------------------
      // STEP 1 - Backfill the display title while `film` is still here.
      //
      // This is the step that makes dropping `film` safe. It runs against
      // whichever table is about to become `session`.
      // ---------------------------------------------------------------------
      const stagingTable = hasSessionOld ? 'session_old' : 'session';

      if (
        hasFilm &&
        (await columnExists(queryInterface, stagingTable, 'Film_strName', transaction))
      ) {
        await q(
          `UPDATE s
              SET s.[Film_strName] = LEFT(f.[Film_strTitle], 200)
             FROM [dbo].[${stagingTable}] s
             JOIN [dbo].[film] f ON f.[Film_strCode] = s.[Film_strCode]
            WHERE s.[Film_strName] IS NULL
              AND f.[Film_strTitle] IS NOT NULL`,
          transaction
        );
      }

      if (hasSessionOld && hasSession) {
        // -------------------------------------------------------------------
        // STEP 2 - Carry across the rows that live only in the current
        // `session`, so the swap loses nothing. See the header for the counts.
        // -------------------------------------------------------------------
        /*
         * The title comes from `film` when `film` is still here, and from the
         * outgoing row's own `Film_strName` when it is not. Naming `dbo.film`
         * unconditionally would be an "Invalid object name" on any database
         * that has already lost it - a re-run, or a restore taken mid-way.
         */
        const titleExpression = hasFilm
          ? `LEFT(COALESCE(${
              (await columnExists(queryInterface, 'session', 'Film_strName', transaction))
                ? 's.[Film_strName], '
                : ''
            }f.[Film_strTitle]), 200)`
          : (await columnExists(queryInterface, 'session', 'Film_strName', transaction))
            ? `LEFT(s.[Film_strName], 200)`
            : `NULL`;

        const titleJoin = hasFilm
          ? `LEFT JOIN [dbo].[film] f ON f.[Film_strCode] = s.[Film_strCode]`
          : '';

        await q(
          `INSERT INTO [dbo].[session_old]
             ([Code], [Session_lngSessionId], [Film_strName], [Film_strCode],
              [Screen_bytNum], [Screen_strName], [Session_strStatus],
              [Session_dtmRealShow], [Session_dtmFinishShow], [Session_dtmStamp])
           SELECT s.[Code],
                  s.[Session_lngSessionId],
                  ${titleExpression},
                  ISNULL(s.[Film_strCode], ''),
                  s.[Screen_bytNum],
                  s.[Screen_strName],
                  s.[Session_strStatus],
                  s.[Session_dtmRealShow],
                  s.[Session_dtmFinishShow],
                  s.[Session_dtmStamp]
             FROM [dbo].[session] s
             ${titleJoin}
            WHERE NOT EXISTS (
                    SELECT 1 FROM [dbo].[session_old] o
                     WHERE o.[Code] = s.[Code]
                       AND o.[Session_lngSessionId] = s.[Session_lngSessionId])`,
          transaction
        );

        // Drop the outgoing table, FK to `film` and all.
        await dropOutboundForeignKeys(queryInterface, 'session', transaction);
        await dropInboundForeignKeys(queryInterface, 'session', transaction);
        await q(`DROP TABLE [dbo].[session]`, transaction);

        // The FK carries the old table's name; drop it before the rename so
        // the recreated one below reads correctly.
        await dropOutboundForeignKeys(queryInterface, 'session_old', transaction);
        await q(`EXEC sp_rename 'dbo.session_old', 'session'`, transaction);
      } else if (hasSessionOld && !hasSession) {
        /*
         * Staging table present, target gone. Reached by a re-run interrupted
         * between the DROP and the rename above, or by a restore taken at that
         * moment. Nothing to merge - just finish the rename the interrupted run
         * did not reach.
         */
        await dropOutboundForeignKeys(queryInterface, 'session_old', transaction);
        await q(`EXEC sp_rename 'dbo.session_old', 'session'`, transaction);
      } else if (!hasSessionOld) {
        // -------------------------------------------------------------------
        // STEP 3 - Fresh database: no `session_old` to rename, so reshape the
        // `session` that 20260824000100 created. Same destination.
        // -------------------------------------------------------------------
        if (!(await columnExists(queryInterface, 'session', 'Film_strName', transaction))) {
          await q(`ALTER TABLE [dbo].[session] ADD [Film_strName] varchar(200) NULL`, transaction);

          if (hasFilm) {
            await q(
              `UPDATE s
                  SET s.[Film_strName] = LEFT(f.[Film_strTitle], 200)
                 FROM [dbo].[session] s
                 JOIN [dbo].[film] f ON f.[Film_strCode] = s.[Film_strCode]
                WHERE s.[Film_strName] IS NULL`,
              transaction
            );
          }
        }

        // `Film_strCode` is NOT NULL in the target shape.
        await q(
          `UPDATE [dbo].[session] SET [Film_strCode] = '' WHERE [Film_strCode] IS NULL`,
          transaction
        );

        await dropOutboundForeignKeys(queryInterface, 'session', transaction);

        const [existing] = await q(
          `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.session')`,
          transaction
        );
        const keep = new Set(TARGET_COLUMNS.map(([name]) => name.toLowerCase()));

        for (const column of existing) {
          if (keep.has(column.name.toLowerCase())) continue;

          // A dropped column takes its defaults with it.
          const [defaults] = await q(
            `SELECT dc.name
               FROM sys.default_constraints dc
               JOIN sys.columns c
                 ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
              WHERE dc.parent_object_id = OBJECT_ID('dbo.session') AND c.name = '${column.name}'`,
            transaction
          );
          for (const dc of defaults) {
            await q(`ALTER TABLE [dbo].[session] DROP CONSTRAINT [${dc.name}]`, transaction);
          }

          await q(`ALTER TABLE [dbo].[session] DROP COLUMN [${column.name}]`, transaction);
        }

        for (const [name, type, nullability] of TARGET_COLUMNS) {
          if (!(await columnExists(queryInterface, 'session', name, transaction))) {
            await q(
              `ALTER TABLE [dbo].[session] ADD [${name}] ${type} ${nullability}`,
              transaction
            );
          }
        }

        /*
         * Match the target nullability on the columns that were already there.
         *
         * The client DDL 20260824000100 reproduces differs from the target on
         * two: `Film_strCode` arrives nullable and `Session_dtmStamp` arrives
         * NOT NULL. Without this, a fresh database ends up structurally
         * different from a migrated one, which is precisely the drift this
         * branch exists to prevent.
         *
         * Safe to ALTER here: the only index on the table at this point is the
         * inherited primary key, and neither of these columns is in it. The
         * key columns themselves are deliberately excluded - see step 4.
         */
        for (const [name, type, nullability] of TARGET_COLUMNS) {
          if (['Code', 'Session_lngSessionId'].includes(name)) continue;

          const isNullable = await scalar(
            queryInterface,
            `SELECT COUNT(*) c FROM sys.columns
              WHERE object_id = OBJECT_ID('dbo.session')
                AND name = '${name}' AND is_nullable = 1`,
            transaction
          );

          const wantNullable = nullability === 'NULL';

          if (Boolean(Number(isNullable)) !== wantNullable) {
            await q(
              `ALTER TABLE [dbo].[session] ALTER COLUMN [${name}] ${type} ${nullability}`,
              transaction
            );
          }
        }
      }

      // ---------------------------------------------------------------------
      // STEP 4 - Give the surviving table its keys.
      //
      // `session_old` arrived with NO primary key and NO index of any kind.
      // (Code, Session_lngSessionId) was verified unique across all 252 rows
      // before this was written, so the PK below cannot fail on client data.
      // ---------------------------------------------------------------------
      const hasPrimaryKey = await scalar(
        queryInterface,
        `SELECT COUNT(*) c FROM sys.indexes
          WHERE object_id = OBJECT_ID('dbo.session') AND is_primary_key = 1`,
        transaction
      );

      /*
       * The key columns must be NOT NULL before a PK can be built on them.
       *
       * ONLY when there is no primary key yet. SQL Server refuses to ALTER a
       * column an index depends on (error 5074: "The object 'PK_Session' is
       * dependent on column 'Code'"), and the fresh-install path arrives here
       * with the PK that 20260824000100 created still in place - as does any
       * re-run after this migration's own PK_session exists. Running these
       * unconditionally would fail `make migrate` on a CI or
       * disaster-recovery database, which is exactly the path this branch was
       * written to serve.
       */
      if (!Number(hasPrimaryKey)) {
        for (const [name, type] of TARGET_COLUMNS) {
          if (['Code', 'Session_lngSessionId'].includes(name)) {
            await q(
              `ALTER TABLE [dbo].[session] ALTER COLUMN [${name}] ${type} NOT NULL`,
              transaction
            );
          }
        }
      }

      if (!Number(hasPrimaryKey)) {
        await q(
          `ALTER TABLE [dbo].[session]
             ADD CONSTRAINT [PK_session] PRIMARY KEY CLUSTERED ([Code], [Session_lngSessionId])`,
          transaction
        );
      }

      if (!(await constraintExists(queryInterface, 'FK_session_cinemas', transaction))) {
        // Only added when every code present resolves. A session naming a
        // cinema that is not provisioned yet is the client's data being ahead
        // of ours, and refusing to migrate over that would be the wrong trade.
        const orphans = await scalar(
          queryInterface,
          `SELECT COUNT(*) c FROM [dbo].[session] s
            WHERE NOT EXISTS (SELECT 1 FROM [dbo].[cinemas] c WHERE c.[code] = s.[Code])`,
          transaction
        );

        if (Number(orphans) === 0) {
          await q(
            `ALTER TABLE [dbo].[session]
               ADD CONSTRAINT [FK_session_cinemas] FOREIGN KEY ([Code])
               REFERENCES [dbo].[cinemas] ([code])`,
            transaction
          );
        } else {
          console.warn(
            `[session] ${orphans} session row(s) name a cinema code that does not exist; ` +
              'FK_session_cinemas not created. Provision the cinemas, then re-run this migration.'
          );
        }
      }

      // The index the "what is playing on this screen right now" lookup reads:
      // cinema, then auditorium, then start time. Finish time, status and the
      // screen name ride along so the lookup never leaves the index.
      if (
        !(await indexExists(queryInterface, 'session', 'IX_session_cinema_screen_start', transaction))
      ) {
        await q(
          `CREATE NONCLUSTERED INDEX [IX_session_cinema_screen_start]
             ON [dbo].[session] ([Code], [Screen_bytNum], [Session_dtmRealShow])
             INCLUDE ([Session_dtmFinishShow], [Session_strStatus], [Screen_strName])`,
          transaction
        );
      }

      // ---------------------------------------------------------------------
      // STEP 5 - Drop the two tables `session` replaces.
      //
      // `film` last, so the backfill above has already run against it. `shows`
      // is dropped with its own FKs; nothing in the database references it.
      // ---------------------------------------------------------------------
      if (await tableExists(queryInterface, 'shows', transaction)) {
        const showRows = await scalar(
          queryInterface,
          `SELECT COUNT(*) c FROM [dbo].[shows]`,
          transaction
        );
        await dropInboundForeignKeys(queryInterface, 'shows', transaction);
        await dropOutboundForeignKeys(queryInterface, 'shows', transaction);
        await q(`DROP TABLE [dbo].[shows]`, transaction);

        if (Number(showRows) > 0) {
          console.warn(
            `[session] dropped shows with ${showRows} row(s) - see this migration's header.`
          );
        }
      }

      if (await tableExists(queryInterface, 'film', transaction)) {
        const stillNull = await scalar(
          queryInterface,
          `SELECT COUNT(*) c FROM [dbo].[session] WHERE [Film_strName] IS NULL`,
          transaction
        );

        if (Number(stillNull) > 0) {
          console.warn(
            `[session] ${stillNull} session row(s) still have no Film_strName after the backfill; ` +
              'their film code has no row in `film`, so there was no title to recover.'
          );
        }

        await dropInboundForeignKeys(queryInterface, 'film', transaction);
        await dropOutboundForeignKeys(queryInterface, 'film', transaction);
        await q(`DROP TABLE [dbo].[film]`, transaction);
      }
    });
  },

  /**
   * PARTIAL BY DESIGN.
   *
   * `film` and `shows` are dropped by up(), rows and all. There is no backup
   * table to restore them from, and a 44-column provider catalogue cannot be
   * reconstructed from the ten columns that survive, so down() does not
   * pretend it can: it restores the SHAPE that 20260824000100 created - an
   * empty `film`, and `session` without the title column - and says plainly
   * what it could not bring back.
   *
   * Rolling this back on a database that matters means restoring from backup,
   * not running this function.
   */
  async down(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!(await tableExists(queryInterface, 'film', transaction))) {
        await q(
          `CREATE TABLE [dbo].[film] (
             [Film_strCode] varchar(20) NOT NULL,
             [Film_strTitle] varchar(500) NULL,
             [Film_strCensor] varchar(10) NULL,
             [Film_intDuration] smallint NULL,
             [Film_strStatus] varchar(1) NULL,
             [Film_strNowShowingFlag] varchar(1) NULL,
             [Film_strURLforGraphic] varchar(255) NULL,
             [Film_dtmOpeningDate] datetime NULL,
             [Film_dtmStamp] datetime NOT NULL CONSTRAINT [DF_Film_Film_dtmStamp] DEFAULT (getdate()),
             CONSTRAINT [PK_Film] PRIMARY KEY CLUSTERED ([Film_strCode])
           )`,
          transaction
        );
      }

      console.warn(
        '[session] down(): `film` recreated EMPTY and `shows` not recreated at all. ' +
          'Neither table can have its rows recovered from this migration - restore from backup.'
      );

      if (await columnExists(queryInterface, 'session', 'Film_strName', transaction)) {
        await q(`ALTER TABLE [dbo].[session] DROP COLUMN [Film_strName]`, transaction);
      }
    });
  },
};
