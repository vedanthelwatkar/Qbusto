'use strict';

/**
 * Aligns the client's table and column names with the naming used everywhere
 * else in this schema.
 *
 * NAMING ONLY. Not one row is inserted, updated, deleted or moved, and no
 * type, nullability, key, index or constraint changes. The client's data is
 * correct as it stands; only the identifiers around it are being made
 * consistent.
 *
 * WHAT CHANGES
 *
 *   Film              -> film                    (table)
 *   Session           -> session                 (table)
 *   screens.Category  -> screens.category        (column)
 *   screens.SeatRow   -> screens.seat_row        (column)
 *   screen_layout.ScreenName -> screen_name      (column)
 *   screen_layout.Category   -> category         (column)
 *   screen_layout.SeatRow    -> seat_row         (column)
 *   screen_layout.SeatNo     -> seat_no          (column)
 *
 * WHAT DELIBERATELY DOES NOT CHANGE
 *
 * The provider columns inside `film` and `session` - `Film_strCode`,
 * `Session_lngSessionId`, `Session_dtmRealShow` and the rest. Those names are
 * the source system's contract, not ours; renaming them would break the
 * mapping the client syncs against for no benefit on this side.
 *
 * WHY sp_rename
 *
 * It renames the object in place, so every row, key, index, default and
 * foreign key survives untouched. `FK_Session_Film`, `PK_Film`, `PK_Session`
 * and `DF_Film_Film_dtmStamp` keep their own names and keep working - a
 * constraint's name is independent of the table it sits on. A case-only
 * rename is accepted by sp_rename directly; no temporary name is needed.
 */

/** Renames only if the source exists, so the migration is safe to re-run. */
async function renameTable(queryInterface, from, to) {
  const [[row]] = await queryInterface.sequelize.query(
    `SELECT name FROM sys.tables WHERE name = '${from}'`
  );

  // Names are case-insensitive here, so this also matches when the table has
  // already been renamed. Compare exactly to decide whether there is work.
  if (row && row.name !== to) {
    await queryInterface.sequelize.query(`EXEC sp_rename '${from}', '${to}'`);
  }
}

async function renameColumn(queryInterface, table, from, to) {
  const [[row]] = await queryInterface.sequelize.query(
    `SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('${table}') AND c.name = '${from}'`
  );

  if (row && row.name !== to) {
    await queryInterface.sequelize.query(`EXEC sp_rename '${table}.${from}', '${to}', 'COLUMN'`);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await renameTable(queryInterface, 'Film', 'film');
    await renameTable(queryInterface, 'Session', 'session');

    await renameColumn(queryInterface, 'screens', 'Category', 'category');
    await renameColumn(queryInterface, 'screens', 'SeatRow', 'seat_row');

    await renameColumn(queryInterface, 'screen_layout', 'ScreenName', 'screen_name');
    await renameColumn(queryInterface, 'screen_layout', 'Category', 'category');
    await renameColumn(queryInterface, 'screen_layout', 'SeatRow', 'seat_row');
    await renameColumn(queryInterface, 'screen_layout', 'SeatNo', 'seat_no');
  },

  async down(queryInterface) {
    await renameColumn(queryInterface, 'screen_layout', 'seat_no', 'SeatNo');
    await renameColumn(queryInterface, 'screen_layout', 'seat_row', 'SeatRow');
    await renameColumn(queryInterface, 'screen_layout', 'category', 'Category');
    await renameColumn(queryInterface, 'screen_layout', 'screen_name', 'ScreenName');

    await renameColumn(queryInterface, 'screens', 'seat_row', 'SeatRow');
    await renameColumn(queryInterface, 'screens', 'category', 'Category');

    await renameTable(queryInterface, 'session', 'Session');
    await renameTable(queryInterface, 'film', 'Film');
  },
};
