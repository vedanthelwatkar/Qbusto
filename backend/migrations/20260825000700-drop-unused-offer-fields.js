'use strict';

/**
 * Drops `offers.offer_category` and `offers.payment_modes`.
 *
 * WHY THESE ARE SAFE TO REMOVE
 *
 * Both were added when `offers` still mirrored Cashfree's own offer
 * vocabulary (see `20260825000300-create-offers.js`'s header note on that
 * abandoned design). Neither has ever been read by `coupon.service.js` - the
 * only place a coupon's discount is actually computed - and a repository-wide
 * search at the time of this migration found no other backend, database or
 * frontend consumer of either column beyond the CRUD path that writes and
 * displays them. They are pure unused metadata, not load-bearing state.
 *
 * `discountType`, by contrast, is NOT touched here: coupon.service.js reads
 * it directly to decide percentage-vs-flat math, so it stays.
 *
 * REVERSIBLE
 *
 * `down()` restores both columns with their original defaults. Restored data
 * is NOT recoverable - this is a genuine drop, not a deactivation - so this
 * should only be rolled back if nothing has relied on the columns being gone
 * in the meantime.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('offers', 'offer_category');
    await queryInterface.removeColumn('offers', 'payment_modes');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('offers', 'offer_category', {
      type: 'VARCHAR(20)',
      allowNull: false,
      defaultValue: 'discount',
    });
    await queryInterface.addColumn('offers', 'payment_modes', {
      type: 'VARCHAR(20)',
      allowNull: false,
      defaultValue: 'all',
    });
  },
};
