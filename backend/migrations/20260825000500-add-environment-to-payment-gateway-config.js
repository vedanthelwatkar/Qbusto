'use strict';

/**
 * Adds a dedicated `environment` column to `payment_gateway_config`.
 *
 * Each cinema's Cashfree credentials need to say whether they are test/sandbox
 * or live - the SDK client is built differently for each (see
 * cashfree.client.resolveCredentials). The obvious alternative was reusing
 * the existing `gateway_url` column, since it was unused and free text would
 * technically fit either a URL or an environment name - but that would mean
 * a column literally named "url" secretly holding the string "test" or
 * "prod", which is exactly the kind of implicit, easy-to-misread repurposing
 * this schema avoids everywhere else. A real column, named for what it holds,
 * costs one migration and reads correctly forever after.
 *
 * `gateway_url` is left as originally defined and genuinely unused for now -
 * available if a future provider's credentials need an actual URL.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('payment_gateway_config', 'environment', {
      type: Sequelize.STRING(20),
      allowNull: false,
      // Matches CASHFREE_ENVIRONMENT's own default - a newly-added row with
      // no explicit choice defaults to the safe (non-money-moving) option.
      defaultValue: 'test',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('payment_gateway_config', 'environment');
  },
};
