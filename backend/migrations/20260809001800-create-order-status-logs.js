'use strict';

/**
 * Append-only log: created_at but no updated_at (model sets updatedAt: false).
 * The status update and the log insert must share one transaction.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_status_logs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      order_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      previous_status_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'order_statuses', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      new_status_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'order_statuses', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      changed_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      reason: { type: 'VARCHAR(500)', allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_status_logs');
  },
};
