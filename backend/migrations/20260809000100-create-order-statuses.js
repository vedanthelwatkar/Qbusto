'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_statuses', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      code: { type: 'VARCHAR(30)', allowNull: false },
      name: { type: 'VARCHAR(100)', allowNull: false },
      description: { type: 'VARCHAR(255)', allowNull: true },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('order_statuses', ['code'], {
      name: 'UQ_order_statuses_code',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_statuses');
  },
};
