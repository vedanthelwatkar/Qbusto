'use strict';

/**
 * Adds 'Offers' to the CHECK constraint on `user_permissions.module_name`.
 *
 * `MODULES` in src/constants.js mirrors this constraint deliberately (see its
 * own comment) so a typo'd module name fails at authorize() boot time rather
 * than as a confusing database error mid-request. Adding `MODULES.OFFERS`
 * there without this migration would mean granting anyone the Offers
 * permission fails with a CHECK constraint violation the moment
 * user.service tries to write the user_permissions row - both have to move
 * together.
 */

const OLD_VALUES = [
  'Dashboard',
  'Orders',
  'Products',
  'Categories',
  'Pricing',
  'Banners',
  'Users',
  'Reports',
  'POS Integrations',
  'Settings',
];

const NEW_VALUES = [...OLD_VALUES, 'Offers'];

function checkClause(values) {
  const list = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(',');
  return `CHECK ([module_name] IN (${list}))`;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE [user_permissions] DROP CONSTRAINT [CK_user_permissions_module_name]'
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE [user_permissions] ADD CONSTRAINT [CK_user_permissions_module_name] ${checkClause(NEW_VALUES)}`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE [user_permissions] DROP CONSTRAINT [CK_user_permissions_module_name]'
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE [user_permissions] ADD CONSTRAINT [CK_user_permissions_module_name] ${checkClause(OLD_VALUES)}`
    );
  },
};
