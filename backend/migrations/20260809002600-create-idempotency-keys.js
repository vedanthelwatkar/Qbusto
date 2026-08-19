'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('idempotency_keys', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      key: {
        type: 'VARCHAR(36)',
        allowNull: false,
        unique: true,
        comment: 'UUID v4 from Idempotency-Key header',
      },
      order_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('idempotency_keys', ['key'], {
      name: 'IX_idempotency_keys_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('idempotency_keys');
  },
};
