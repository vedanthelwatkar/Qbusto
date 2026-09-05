'use strict';

/**
 * READ-ONLY inventory of every QBusto-owned datetime column, ahead of the
 * IST-storage migration.
 *
 * Writes nothing. Prints, for each column, the row count and the migration
 * action it needs - which is deliberately NOT uniform: see CLASSIFICATION.
 *
 *   node scripts/tz-inventory.js
 */

const { sequelize } = require('../src/config/database');

/** Client-owned. Never touched by the IST migration. */
const VISTA_TABLES = new Set(['session']);

/**
 * The IST migration's own bookkeeping. Excluded for the same reason the
 * migration excludes them: they are datetime2 tables ABOUT the conversion, not
 * application data, and counting them inflates the surface being reported.
 */
const SELF_TABLES = new Set(['qbusto_timezone_migration', 'qbusto_timezone_migration_backup']);

/**
 * Columns that are already IST wall clock and must NOT be shifted.
 *
 * orders.show_time was written by a path where two faults cancelled: the
 * pre-fix Session getter read Vista's IST as if it were UTC, and that
 * "instant" was then stored back as UTC wall clock - landing on the original
 * IST digits. Shifting these would move every one 5.5 hours into the future.
 */
const ALREADY_IST = new Set(['orders.show_time']);

/**
 * Date BOUNDARY columns - a business window's edge, not an instant.
 *
 * These hold mixed provenance: some values are plain midnights that were never
 * timezone-converted, others are 18:30 (IST midnight already converted to UTC).
 * A blanket shift is wrong for the first group and required for the second, so
 * they are normalised to IST midnight instead of shifted.
 */
const DATE_BOUNDARY = new Set([
  'banners.start_date',
  'banners.end_date',
  'cinema_products.available_from',
  'cinema_products.available_until',
  'cinemas.active_since',
  'offers.valid_from',
  'offers.valid_until',
]);

function actionFor(key) {
  if (ALREADY_IST.has(key)) return ['SKIP', 'already IST wall clock'];
  if (DATE_BOUNDARY.has(key)) return ['NORMALISE', 'date boundary -> IST midnight'];
  return ['SHIFT +330', 'UTC instant -> IST wall clock'];
}

async function main() {
  const [cols] = await sequelize.query(`
    SELECT t.name AS tbl, c.name AS col, ty.name AS type_name, c.scale
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
     WHERE ty.name IN ('datetime2','datetime')
     ORDER BY t.name, c.column_id
  `);

  const groups = { 'SHIFT +330': [], NORMALISE: [], SKIP: [] };
  let grandTotal = 0;
  let vistaCols = 0;
  let qbustoCols = 0;

  for (const { tbl, col, type_name, scale } of cols) {
    if (VISTA_TABLES.has(tbl)) {
      vistaCols += 1;
      continue;
    }
    if (SELF_TABLES.has(tbl)) continue;

    qbustoCols += 1;

    const key = `${tbl}.${col}`;
    const [r] = await sequelize.query(
      `SELECT COUNT([${col}]) AS n,
              CONVERT(varchar(19), MIN([${col}]), 121) AS lo,
              CONVERT(varchar(19), MAX([${col}]), 121) AS hi
         FROM [${tbl}]`
    );

    const n = Number(r[0].n);
    const [action, why] = actionFor(key);
    groups[action].push({ key, n, lo: r[0].lo, hi: r[0].hi, why, type: `${type_name}(${scale})` });
    grandTotal += n;
  }

  console.log('\n' + '='.repeat(78));
  console.log('QBUSTO-OWNED DATETIME INVENTORY  (read-only, nothing written)');
  console.log('='.repeat(78));

  let willChange = 0;

  for (const action of ['SHIFT +330', 'NORMALISE', 'SKIP']) {
    const list = groups[action];
    const subtotal = list.reduce((s, c) => s + c.n, 0);
    const withData = list.filter((c) => c.n > 0);

    console.log(`\n--- ${action} --- ${list[0] ? list[0].why : ''}`);
    console.log(`    ${list.length} columns, ${withData.length} with data, ${subtotal} values\n`);

    for (const c of withData) {
      console.log(
        `    ${c.key.padEnd(42)} ${String(c.n).padStart(5)}  ${c.lo} .. ${c.hi}`
      );
    }
    const empty = list.filter((c) => c.n === 0);
    if (empty.length) {
      console.log(`    (${empty.length} empty: ${empty.map((c) => c.key).join(', ')})`);
    }

    if (action !== 'SKIP') willChange += subtotal;
  }

  console.log('\n' + '-'.repeat(78));
  console.log(`  QBusto date columns      : ${qbustoCols}`);
  console.log(`  Vista columns (untouched): ${vistaCols}`);
  console.log(`  Total values             : ${grandTotal}`);
  console.log(`  Values the migration WILL change: ${willChange}`);
  console.log(`  Values deliberately left alone  : ${grandTotal - willChange}`);
  console.log('-'.repeat(78) + '\n');
}

main()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error('tz-inventory failed:', error.message);
    await sequelize.close();
    process.exitCode = 1;
  });
