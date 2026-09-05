'use strict';

/**
 * Adds `offers_enabled` to `cinemas`.
 *
 * A per-cinema switch for the coupon/"Apply coupon" feature, matching the
 * existing `sms_enabled`/`whatsapp_enabled` pattern exactly: a boolean flag a
 * staff user flips from the Dashboard, not a secret and not a new table.
 *
 * Defaults to TRUE so every existing cinema keeps its current behaviour -
 * coupons already work today, and this flag is an off switch layered on top,
 * not an opt-in every cinema would otherwise silently lose.
 *
 * Turning it off does not touch `offers` rows: existing coupons stay exactly
 * as configured and become available again the moment the flag is switched
 * back on. See coupon.service.validateCoupon for the enforcement point.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [cols] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cinemas') AND name = 'offers_enabled'`
    );
    if (Number(cols[0].n) > 0) return;

    await queryInterface.addColumn('cinemas', 'offers_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    const [cols] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cinemas') AND name = 'offers_enabled'`
    );
    if (Number(cols[0].n) === 0) return;

    await queryInterface.removeColumn('cinemas', 'offers_enabled');
  },
};
