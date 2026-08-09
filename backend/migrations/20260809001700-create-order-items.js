'use strict';

/**
 * schema.md gives order_items no created_at / updated_at columns, so the model
 * runs with timestamps disabled.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_items', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      order_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      product_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'products', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      // Frozen snapshots for historical accuracy.
      product_name: { type: 'VARCHAR(200)', allowNull: false },
      pos_item_id: { type: 'VARCHAR(50)', allowNull: true },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      unit_price: { type: 'DECIMAL(10,2)', allowNull: false },
      discount: { type: 'DECIMAL(10,2)', allowNull: false, defaultValue: 0 },
      total: { type: 'DECIMAL(10,2)', allowNull: false },
    });

    await queryInterface.addIndex('order_items', ['order_id'], { name: 'IX_order_items_order_id' });

    const checks = [
      ['CK_order_items_quantity', '[quantity] > 0'],
      ['CK_order_items_unit_price', '[unit_price] >= 0'],
      ['CK_order_items_discount', '[discount] >= 0'],
      ['CK_order_items_total', '[total] >= 0'],
    ];

    for (const [name, expression] of checks) {
      await queryInterface.sequelize.query(
        `ALTER TABLE [order_items] ADD CONSTRAINT [${name}] CHECK (${expression})`
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_items');
  },
};
