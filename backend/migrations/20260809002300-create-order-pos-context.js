'use strict';

/**
 * Immutable after creation - intentionally no updated_at column
 * (model sets updatedAt: false).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_pos_context', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      order_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      pos_integration_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'pos_integrations', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      external_session_id: { type: 'VARCHAR(100)', allowNull: true },
      external_film_id: { type: 'VARCHAR(50)', allowNull: true },
      external_screen_id: { type: 'VARCHAR(50)', allowNull: true },
      // Implements the client's POS_BookingId requirement.
      external_booking_id: { type: 'VARCHAR(100)', allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
    });

    // Exactly one POS context per order.
    await queryInterface.addIndex('order_pos_context', ['order_id'], {
      name: 'UQ_order_pos_context_order_id',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_pos_context');
  },
};
