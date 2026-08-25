'use strict';

/**
 * Reverts the Cashfree-side offer/coupon integration in favour of a strictly
 * QBusto-side coupon system.
 *
 * WHAT CHANGED AND WHY
 *
 * An earlier version of this feature tried to let Cashfree apply its own
 * offers/discounts at checkout, with QBusto reconciling a short payment
 * against a registered offer's discount. That was abandoned: QBusto is now
 * the ONLY place a coupon is validated and applied, computed into the
 * order's own `discount`/`total` BEFORE `payment-init` ever runs, so
 * Cashfree only ever sees a plain, final amount and has no discount/offer
 * concept in this flow at all.
 *
 * `offers.cashfree_offer_id` existed only to populate Cashfree's
 * `order_meta.offer_filters` - with that mechanism gone, keeping the column
 * would be exactly the kind of vestigial, confusing field this schema
 * otherwise avoids (a column implying a sync that no longer happens).
 *
 * `orders.offer_id` is new: which coupon (if any) was applied to an order,
 * for the offer's own `max_txn_limit` (a redemption count) to be enforced,
 * and for reporting. Nullable FK, `NO ACTION` on delete/update matching this
 * schema's audit-FK convention elsewhere (see 20260809000600's rationale) -
 * an order's history must never silently lose which coupon it used because
 * the coupon was later deleted.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn('offers', 'cashfree_offer_id');

    await queryInterface.addColumn('orders', 'offer_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'offers', key: 'id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('orders', 'offer_id');

    await queryInterface.addColumn('offers', 'cashfree_offer_id', {
      type: 'VARCHAR(100)',
      allowNull: true,
    });
  },
};
