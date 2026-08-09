'use strict';

/**
 * `chains.created_by` / `updated_by` reference `users.id`, but `users.chain_id`
 * references `chains.id`. The cycle means the audit FKs cannot be declared here;
 * they are added in 20260809000600-add-audit-fks-chains-cinemas.js once `users`
 * exists. The columns themselves are created now.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('chains', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: 'VARCHAR(100)', allowNull: false },
      logo_image_url: { type: 'VARCHAR(500)', allowNull: true },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
      created_by: { type: Sequelize.INTEGER, allowNull: true },
      updated_by: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chains');
  },
};
