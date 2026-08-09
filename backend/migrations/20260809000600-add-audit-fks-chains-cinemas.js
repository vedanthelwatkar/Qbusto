'use strict';

/**
 * Closes the `chains` <-> `users` and `cinemas` <-> `users` FK cycle.
 *
 * `chains` and `cinemas` are created before `users` (because `users.chain_id` and
 * `users.cinema_id` point at them), so their `created_by` / `updated_by` FKs can
 * only be attached once `users` exists.
 *
 * NOTE: schema.md specifies `ON DELETE SET NULL` for all audit FKs. SQL Server
 * rejects two cascading FKs from the same table to the same parent table
 * (Msg 1785, "may cause cycles or multiple cascade paths"), so every audit FK in
 * this schema uses `ON DELETE NO ACTION` and the null-on-delete behaviour is
 * enforced in the service layer instead. Same rule applies in every other
 * migration in this folder.
 *
 * @type {import('sequelize-cli').Migration}
 */

const AUDIT_FKS = [
  { table: 'chains', field: 'created_by' },
  { table: 'chains', field: 'updated_by' },
  { table: 'cinemas', field: 'created_by' },
  { table: 'cinemas', field: 'updated_by' },
];

module.exports = {
  async up(queryInterface) {
    for (const { table, field } of AUDIT_FKS) {
      await queryInterface.addConstraint(table, {
        fields: [field],
        type: 'foreign key',
        name: `FK_${table}_${field}`,
        references: { table: 'users', field: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      });
    }
  },

  async down(queryInterface) {
    for (const { table, field } of AUDIT_FKS.slice().reverse()) {
      await queryInterface.removeConstraint(table, `FK_${table}_${field}`);
    }
  },
};
