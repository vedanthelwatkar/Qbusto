'use strict';

/**
 * Adds `timezone` to `cinemas` (Phase B5 - POS show sync).
 *
 * docs/pos-integration.md section 9.4 decided this column: an IANA timezone
 * string per cinema, not a global env var, because a multi-cinema chain may
 * span timezones. Deferred at the time to "Phase B5, where the sync service
 * performs the conversion and first reads it" - this migration is that.
 *
 * The sync service (src/services/showSync.service.js) uses this to convert a
 * POS provider's cinema-local wall-clock show time into an instant before
 * storing it as IST wall clock, the same way every other QBusto datetime
 * column is stored (see config/config.js).
 *
 * NOT NULL with a default rather than nullable: every cinema QBusto currently
 * operates is in India, and a null here would silently skip timezone
 * conversion in a way indistinguishable from "IST was correct" versus "nobody
 * has configured this cinema yet". Existing rows get 'Asia/Kolkata', which is
 * accurate for all of them today.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cinemas', 'timezone', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'Asia/Kolkata',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cinemas', 'timezone');
  },
};
