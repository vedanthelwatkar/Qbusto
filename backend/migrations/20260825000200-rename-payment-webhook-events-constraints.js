'use strict';

/**
 * Finishes the provider-neutral rename started in
 * 20260825000100-rename-payment-columns-provider-neutral.js.
 *
 * That migration renamed the `razorpay_webhook_events` TABLE to
 * `payment_webhook_events` via sp_rename. What it did not - and could not -
 * touch is the table's SYSTEM-GENERATED constraint names: SQL Server bakes
 * the table name into an auto-generated PK/UQ/FK constraint name at the
 * moment the constraint is created, and renaming the table afterwards does
 * not cascade to rename them. Three were created that way when
 * `razorpay_webhook_events` was first defined
 * (20260817000100-create-razorpay-webhook-events.js) and are still named
 * after the old table today:
 *
 *   PK__razorpay__3213E83FC86306D2   primary key on `id`
 *   UQ__razorpay__2370F726C9633EC4   unique constraint on `event_id`
 *   FK__razorpay___order__42E1EEFE   foreign key `order_id` -> orders.id
 *
 * NAMING ONLY, same as the migration before it. No column, no data, no
 * constraint DEFINITION changes - only what each constraint is called.
 * Application code never references a SQL Server constraint name (Sequelize
 * does not need one for ordinary queries), so this has zero runtime effect;
 * it exists so a schema script or SSMS object browser no longer shows
 * "razorpay" anywhere in a database that has been fully on Cashfree for some
 * time.
 *
 * WHY sp_rename, WHY 'OBJECT', WHY TWO-PART NAMES
 *
 * Unlike a column or index - which are addressed as sub-objects of their
 * table (`schema.table.column_name`) - a constraint is itself a directly
 * named object in the schema's namespace, the same as a table. It renames
 * with the two-part form: `sp_rename 'schema.constraint_name', 'new_name',
 * 'OBJECT'`. The three-part form was tried first and fails outright with
 * "Either the parameter @objname is ambiguous or the claimed @objtype
 * (OBJECT) is wrong" - confirmed against this database, not assumed. This is
 * metadata-only either way - no rebuild, no data movement, no rewritten
 * index - because nothing about the constraint's definition changes, only
 * its name.
 *
 * Every SOURCE name is schema-qualified (`dbo.`) for the same reason the
 * previous migration qualifies its probes and renames: an unqualified name
 * resolves against the caller's default schema, not against `dbo`, and a
 * login whose default schema differs would otherwise hit error 15225 - "No
 * item by the name of ... could be found" - against an object that plainly
 * exists.
 *
 * Guarded and re-runnable: each rename checks the OLD name is present and the
 * NEW name is not already there before acting, so running this twice, or
 * against a database that already has the new names, is a no-op.
 */

const SCHEMA = 'dbo';

async function tableExists(queryInterface, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name = '${name}' AND s.name = '${SCHEMA}'`
  );
  return rows.length > 0;
}

/** True when an object with this name exists and belongs to the given table. */
async function constraintExists(queryInterface, table, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.objects
      WHERE name = '${name}' AND parent_object_id = OBJECT_ID('${SCHEMA}.${table}')`
  );
  return rows.length > 0;
}

/** Renames a table-owned constraint (PK/UQ/FK) only if there is work to do. */
async function renameConstraint(queryInterface, table, from, to) {
  if (!(await tableExists(queryInterface, table))) return;
  if (await constraintExists(queryInterface, table, to)) return;
  if (!(await constraintExists(queryInterface, table, from))) return;

  await queryInterface.sequelize.query(`EXEC sp_rename '${SCHEMA}.${from}', '${to}', 'OBJECT'`);
}

/** [table, from, to] - applied in order, reversed on down(). */
const CONSTRAINT_RENAMES = [
  ['payment_webhook_events', 'PK__razorpay__3213E83FC86306D2', 'PK_payment_webhook_events'],
  ['payment_webhook_events', 'UQ__razorpay__2370F726C9633EC4', 'UQ_payment_webhook_events_event_id'],
  ['payment_webhook_events', 'FK__razorpay___order__42E1EEFE', 'FK_payment_webhook_events_order_id'],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const [table, from, to] of CONSTRAINT_RENAMES) {
      await renameConstraint(queryInterface, table, from, to);
    }
  },

  async down(queryInterface) {
    for (const [table, from, to] of [...CONSTRAINT_RENAMES].reverse()) {
      await renameConstraint(queryInterface, table, to, from);
    }
  },
};
