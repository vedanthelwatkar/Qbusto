'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('orders', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      screen_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'screens', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      seat_number: { type: 'VARCHAR(20)', allowNull: true },
      status_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'order_statuses', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      source: { type: 'VARCHAR(20)', allowNull: true },
      customer_mobile: { type: 'VARCHAR(15)', allowNull: true },
      customer_email: { type: 'VARCHAR(200)', allowNull: true },
      film_title: { type: 'VARCHAR(200)', allowNull: true },
      show_time: { type: 'DATETIME2', allowNull: true },
      subtotal: { type: 'DECIMAL(10,2)', allowNull: false },
      discount: { type: 'DECIMAL(10,2)', allowNull: false, defaultValue: 0 },
      total: { type: 'DECIMAL(10,2)', allowNull: false },
      payment_status_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'payment_statuses', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      // NULL means the channel was not applicable or not enabled for this order.
      sms_status: { type: 'VARCHAR(20)', allowNull: true },
      whatsapp_status: { type: 'VARCHAR(20)', allowNull: true },
      razorpay_order_id: { type: 'VARCHAR(100)', allowNull: true },
      razorpay_payment_id: { type: 'VARCHAR(100)', allowNull: true },
      razorpay_signature: { type: 'VARCHAR(255)', allowNull: true },
      notes: { type: 'VARCHAR(500)', allowNull: true },
      delivered_at: { type: 'DATETIME2', allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('orders', ['cinema_id', 'created_at'], {
      name: 'IX_orders_cinema_created_at',
    });
    await queryInterface.addIndex('orders', ['status_id'], { name: 'IX_orders_status_id' });
    await queryInterface.addIndex('orders', ['payment_status_id'], {
      name: 'IX_orders_payment_status_id',
    });

    const checks = [
      ['CK_orders_source', "[source] IN ('qr','seat_qr','kiosk','counter')"],
      ['CK_orders_subtotal', '[subtotal] >= 0'],
      ['CK_orders_discount', '[discount] >= 0'],
      ['CK_orders_total', '[total] >= 0'],
      ['CK_orders_sms_status', "[sms_status] IN ('pending','success','failed')"],
      ['CK_orders_whatsapp_status', "[whatsapp_status] IN ('pending','success','failed')"],
    ];

    for (const [name, expression] of checks) {
      await queryInterface.sequelize.query(
        `ALTER TABLE [orders] ADD CONSTRAINT [${name}] CHECK (${expression})`
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('orders');
  },
};
