'use strict';

/**
 * Make `orders.razorpay_order_id` unique.
 *
 * The webhook decides which internal order a payment belongs to with
 * `Order.findOne({ where: { razorpayOrderId } })`. Nothing in the schema
 * guaranteed that lookup was unambiguous: if two orders ever carried the same
 * Razorpay order id, findOne would pick one arbitrarily and a real payment
 * could be applied to the wrong order.
 *
 * paymentInit already makes that collision unlikely — Razorpay order ids are
 * globally unique, and the column is written with a compare-and-set — but
 * "unlikely by construction" is not the same as "impossible", and this is the
 * key money is routed by. The constraint makes it impossible.
 *
 * FILTERED, deliberately. Every order starts with a NULL here and only gets a
 * value when payment-init runs. SQL Server treats NULLs as equal for
 * uniqueness, so a plain UNIQUE index would allow just one unpaid order in the
 * entire table. The `WHERE ... IS NOT NULL` predicate constrains only rows
 * that actually carry an id.
 *
 * No equivalent index on razorpay_payment_id: that column is written but never
 * used to look an order up, so a duplicate value there cannot misroute a
 * payment. Adding one would be protection against nothing.
 *
 * Verified clean before writing this migration: zero duplicate
 * razorpay_order_id groups in the existing data.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX UX_orders_razorpay_order_id
      ON orders (razorpay_order_id)
      WHERE razorpay_order_id IS NOT NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX UX_orders_razorpay_order_id ON orders
    `);
  },
};
