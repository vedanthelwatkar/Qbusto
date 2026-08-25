'use strict';

/**
 * Cinema-scoped coupons, managed from the Dashboard's Offers tab.
 *
 * SUPERSEDED NOTE (kept for history - this table's ORIGINAL design)
 *
 * This migration originally created `cashfree_offer_id` here too, for a
 * design where an ACTIVE offer's Cashfree-side id was passed to Cashfree's
 * own `order_meta.offer_filters` as an ALLOW list, and reconciliation
 * accepted a payment short by exactly one of these offers' discount as
 * genuinely discounted. That was abandoned: it meant a third party
 * (Cashfree) could ultimately decide what a customer owed, which is exactly
 * what a demo offer observed in Cashfree's own sandbox
 * (`testRetoolTPAPUPIoffer`, redeemable despite existing nowhere in the
 * merchant's own Offers dashboard) demonstrated is not safe to trust.
 * `cashfree_offer_id` was dropped by
 * `20260825000600-revert-cashfree-offer-sync.js`, which also added
 * `orders.offer_id`. See `services/coupon.service.js` for the model that
 * replaced this one: a coupon is validated and applied ENTIRELY within
 * QBusto, and Cashfree is handed only the final, already-discounted amount
 * with no discount/offer concept of its own.
 *
 * `(cinema_id, code)` is unique: one code means one specific coupon within
 * one cinema.
 *
 * Every amount/limit column is nullable except `disc_amount`: a cap or floor
 * that was never configured places no limit, rather than defaulting to zero
 * and silently blocking every redemption.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('offers', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },

      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },

      // What a customer types into "Apply coupon" in the Consumer app, e.g.
      // "abcd15".
      code: { type: 'VARCHAR(50)', allowNull: false },
      name: { type: 'VARCHAR(150)', allowNull: false },

      // Free text, not a CHECK-constrained enum, but with a DEFINED meaning
      // (see services/coupon.service.js): 'percentage' drives percent-of-cart
      // math, anything else (including 'flat') is a flat rupee amount.
      discount_type: { type: 'VARCHAR(30)', allowNull: false },

      description: { type: 'VARCHAR(500)', allowNull: true },
      tnc: { type: 'VARCHAR(2000)', allowNull: true },

      // Free text ('active'/'inactive', or whatever the operator chooses to
      // call it) rather than a boolean, so a status can be added later
      // (e.g. 'paused', 'expired') without a schema change.
      status: { type: 'VARCHAR(20)', allowNull: false, defaultValue: 'active' },

      // Literal string, per the operator's own instruction: 'all' | 'prepaid'
      // | 'one', passed straight through rather than mapped to an invented
      // enum whose values might not match how Cashfree itself names them.
      payment_modes: { type: 'VARCHAR(20)', allowNull: false, defaultValue: 'all' },

      // 'discount' | 'cashback' | 'both' - same free-text treatment.
      offer_category: { type: 'VARCHAR(20)', allowNull: false },

      disc_amount: { type: 'DECIMAL(10,2)', allowNull: false },
      max_disc_amount: { type: 'DECIMAL(10,2)', allowNull: true },
      min_txn_amount: { type: 'DECIMAL(10,2)', allowNull: true },
      max_txn_amount: { type: 'DECIMAL(10,2)', allowNull: true },
      // A count (how many times this offer may be redeemed), not an amount.
      max_txn_limit: { type: Sequelize.INTEGER, allowNull: true },

      valid_from: { type: 'DATETIME2', allowNull: true },
      valid_until: { type: 'DATETIME2', allowNull: true },

      // SUPERSEDED: dropped by 20260825000600-revert-cashfree-offer-sync.js.
      // Kept here, uncommented, only because this is the historical up() that
      // originally created it - see this file's header note.
      cashfree_offer_id: { type: 'VARCHAR(100)', allowNull: true },

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

    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX [UX_offers_cinema_id_code] ON [offers]([cinema_id], [code])'
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('offers');
  },
};
