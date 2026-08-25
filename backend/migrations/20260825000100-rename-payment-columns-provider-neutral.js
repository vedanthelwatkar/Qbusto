'use strict';

/**
 * Makes the payment columns provider-neutral, ahead of the Razorpay ->
 * Cashfree migration.
 *
 * NAMING ONLY. Not one row is inserted, updated, deleted or moved, and no
 * type, nullability, key, index or constraint definition changes. Every value
 * already stored stays exactly where it is, under a new name.
 *
 * WHY THIS IS A RENAME AND NOT A NEW SET OF COLUMNS
 *
 * Every Cashfree identifier fits the existing columns as they stand:
 *
 *   orders.razorpay_order_id      VARCHAR(100)  <- "qbusto_order_<id>"  (~20)
 *   orders.razorpay_payment_id    VARCHAR(100)  <- cf_payment_id
 *   ..._webhook_events.event_id   VARCHAR(64)   <- "<TYPE>:<cf_payment_id>" (~45)
 *   ..._webhook_events.event      VARCHAR(50)   <- PAYMENT_USER_DROPPED_WEBHOOK (28)
 *
 * So no widening, and no second set of columns, is needed - a migration is not
 * required for the data to be representable at all. What IS wrong is the name:
 * after the switch these columns hold Cashfree values, and a column called
 * `razorpay_order_id` holding a Cashfree order id is the kind of thing that
 * misleads someone reading a production query at 2am.
 *
 * Renaming once to a provider-neutral name also means the NEXT provider change
 * needs no migration at all, which is the whole point of doing it now rather
 * than adding `cashfree_order_id` beside the old column and carrying both.
 *
 * WHY sp_rename
 *
 * It renames in place, so every row, key, index, default and foreign key
 * survives untouched. SQL Server rewrites dependent index definitions itself,
 * including the filtered predicate on UX_orders_razorpay_order_id - the index
 * keeps working across the rename and is renamed separately below purely so
 * its name matches its column again.
 *
 * Follows the pattern already established by
 * 20260823001000-align-client-naming.js: guarded, re-runnable, reversible.
 *
 * SCHEMA QUALIFICATION
 *
 * Every sp_rename SOURCE below is qualified `dbo.`, because sp_rename resolves
 * an unqualified name against the CALLER'S default schema, not against dbo.
 * A login whose default schema is not dbo gets error 15225 - "No item by the
 * name of ... could be found" - even though the object plainly exists. The
 * NEW name is deliberately left unqualified: sp_rename rejects a schema
 * prefix there, since a rename cannot move an object between schemas.
 *
 * THE FILTERED INDEX HAS TO BE DROPPED AND REBUILT
 *
 * `UX_orders_razorpay_order_id` is a FILTERED index, and its predicate
 * (`razorpay_order_id IS NOT NULL`) names the column. SQL Server refuses to
 * rename a column referenced by a filtered index predicate - and it refuses
 * with an EMPTY error message, which is why this is called out here rather
 * than left to be rediscovered.
 *
 * So that one index is dropped before the rename and recreated afterwards
 * against the new column name. The window in which it does not exist is
 * inside this migration only. It matters because that index is what
 * guarantees one gateway order per QBusto order, so it is recreated
 * unconditionally rather than left to a later step.
 *
 * Ordinary (non-filtered) indexes do NOT block a column rename - SQL Server
 * updates them itself - so the webhook-events index is simply renamed.
 *
 * The same qualification applies to every EXISTENCE PROBE below, not just to
 * the renames. An unqualified `OBJECT_ID('orders')` also resolves against the
 * caller's default schema, so under a non-dbo login the probes would report
 * every column as absent, every rename would silently skip - and, because the
 * filtered index is dropped BEFORE the renames, the migration would fail
 * part-way with the uniqueness guard already gone. Probing and renaming must
 * agree on which schema they mean.
 */

/** The schema every table in this database lives in. */
const SCHEMA = 'dbo';

async function tableExists(queryInterface, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name = '${name}' AND s.name = '${SCHEMA}'`
  );
  return rows.length > 0;
}

/** Renames only if the source exists and the target name differs. Re-runnable. */
async function renameTable(queryInterface, from, to) {
  const [[row]] = await queryInterface.sequelize.query(
    `SELECT t.name FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name = '${from}' AND s.name = '${SCHEMA}'`
  );

  // Names are case-insensitive here, so this also matches a table that has
  // already been renamed. Compare exactly to decide whether there is work.
  if (row && row.name !== to) {
    await queryInterface.sequelize.query(`EXEC sp_rename '${SCHEMA}.${from}', '${to}'`);
  }
}

async function renameColumn(queryInterface, table, from, to) {
  if (!(await tableExists(queryInterface, table))) return;

  const [[row]] = await queryInterface.sequelize.query(
    `SELECT c.name FROM sys.columns c
      WHERE c.object_id = OBJECT_ID('${SCHEMA}.${table}') AND c.name = '${from}'`
  );

  if (row && row.name !== to) {
    await queryInterface.sequelize.query(
      `EXEC sp_rename '${SCHEMA}.${table}.${from}', '${to}', 'COLUMN'`
    );
  }
}

/** Drop an index if it is there. Used only where a rename is impossible. */
async function dropIndexIfExists(queryInterface, table, name) {
  if (!(await tableExists(queryInterface, table))) return;

  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.indexes
      WHERE object_id = OBJECT_ID('${SCHEMA}.${table}') AND name = '${name}'`
  );

  if (rows.length > 0) {
    await queryInterface.sequelize.query(`DROP INDEX ${name} ON ${SCHEMA}.${table}`);
  }
}

/** Create the filtered uniqueness guard over whichever column now holds it. */
async function createGatewayOrderIndex(queryInterface, name, column) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.indexes
      WHERE object_id = OBJECT_ID('${SCHEMA}.orders') AND name = '${name}'`
  );
  if (rows.length > 0) return;

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX ${name}
    ON ${SCHEMA}.orders (${column})
    WHERE ${column} IS NOT NULL
  `);
}

async function renameIndex(queryInterface, table, from, to) {
  if (!(await tableExists(queryInterface, table))) return;

  const [[row]] = await queryInterface.sequelize.query(
    `SELECT i.name FROM sys.indexes i
      WHERE i.object_id = OBJECT_ID('${SCHEMA}.${table}') AND i.name = '${from}'`
  );

  if (row && row.name !== to) {
    await queryInterface.sequelize.query(
      `EXEC sp_rename '${SCHEMA}.${table}.${from}', '${to}', 'INDEX'`
    );
  }
}

/** [table, from, to] - applied in order, reversed on down(). */
const COLUMN_RENAMES = [
  ['orders', 'razorpay_order_id', 'gateway_order_id'],
  ['orders', 'razorpay_payment_id', 'gateway_payment_id'],
  // Present in the schema but never written by any code path. Renamed rather
  // than dropped: removing a column is destructive and is not what this
  // migration is for.
  ['orders', 'razorpay_signature', 'gateway_signature'],
  ['payment_status_logs', 'razorpay_payment_id', 'gateway_payment_id'],
  ['payment_webhook_events', 'razorpay_order_id', 'gateway_order_id'],
  ['payment_webhook_events', 'razorpay_payment_id', 'gateway_payment_id'],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Table first, so the column and index work below addresses it by its
    // new name.
    await renameTable(queryInterface, 'razorpay_webhook_events', 'payment_webhook_events');

    // Must go before the column rename: its filter predicate names the column.
    await dropIndexIfExists(queryInterface, 'orders', 'UX_orders_razorpay_order_id');

    for (const [table, from, to] of COLUMN_RENAMES) {
      await renameColumn(queryInterface, table, from, to);
    }

    // Rebuilt against the new column name. This is the guarantee of one
    // gateway order per QBusto order, so it is never left absent.
    await createGatewayOrderIndex(queryInterface, 'UX_orders_gateway_order_id', 'gateway_order_id');

    await renameIndex(
      queryInterface,
      'payment_webhook_events',
      'IX_razorpay_webhook_events_razorpay_order_id',
      'IX_payment_webhook_events_gateway_order_id'
    );
  },

  async down(queryInterface) {
    await renameIndex(
      queryInterface,
      'payment_webhook_events',
      'IX_payment_webhook_events_gateway_order_id',
      'IX_razorpay_webhook_events_razorpay_order_id'
    );

    // Same constraint in reverse: drop before renaming the column back.
    await dropIndexIfExists(queryInterface, 'orders', 'UX_orders_gateway_order_id');

    for (const [table, from, to] of [...COLUMN_RENAMES].reverse()) {
      await renameColumn(queryInterface, table, to, from);
    }

    await createGatewayOrderIndex(
      queryInterface,
      'UX_orders_razorpay_order_id',
      'razorpay_order_id'
    );

    await renameTable(queryInterface, 'payment_webhook_events', 'razorpay_webhook_events');
  },
};
