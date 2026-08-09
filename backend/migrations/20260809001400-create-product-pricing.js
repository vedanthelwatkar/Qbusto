'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_pricing', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
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
      // 0 = default/all days, 1 = Monday ... 7 = Sunday
      day_of_week: { type: 'TINYINT', allowNull: false, defaultValue: 0 },
      base_price: { type: 'DECIMAL(10,2)', allowNull: false },
      // 'P' = Percentage, 'F' = Flat Amount. Governs every discount_on_* column.
      discount_type: { type: 'CHAR(1)', allowNull: true },
      discount_value: { type: 'DECIMAL(10,2)', allowNull: true },
      discount_on_qr: { type: 'DECIMAL(10,2)', allowNull: true },
      discount_on_kiosk: { type: 'DECIMAL(10,2)', allowNull: true },
      discount_on_seat_qr: { type: 'DECIMAL(10,2)', allowNull: true },
      discount_on_counter: { type: 'DECIMAL(10,2)', allowNull: true },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
      // Audit FKs: NO ACTION, not SET NULL - see 20260809000600 for why.
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('product_pricing', ['cinema_id', 'product_id', 'day_of_week'], {
      name: 'UQ_product_pricing',
      unique: true,
    });

    const checks = [
      ['CK_product_pricing_discount_type', "[discount_type] IN ('P','F')"],
      ['CK_product_pricing_base_price', '[base_price] >= 0'],
      ['CK_product_pricing_discount_value', '[discount_value] >= 0'],
      ['CK_product_pricing_discount_on_qr', '[discount_on_qr] >= 0'],
      ['CK_product_pricing_discount_on_kiosk', '[discount_on_kiosk] >= 0'],
      ['CK_product_pricing_discount_on_seat_qr', '[discount_on_seat_qr] >= 0'],
      ['CK_product_pricing_discount_on_counter', '[discount_on_counter] >= 0'],
    ];

    for (const [name, expression] of checks) {
      await queryInterface.sequelize.query(
        `ALTER TABLE [product_pricing] ADD CONSTRAINT [${name}] CHECK (${expression})`
      );
    }

    // The "discount_on_* is only meaningful when discount_type is set" rule is
    // cross-field and enforced by the ProductPricing model hook, not the DB.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_pricing');
  },
};
