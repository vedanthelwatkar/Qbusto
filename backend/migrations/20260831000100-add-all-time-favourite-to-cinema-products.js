'use strict';

/**
 * Adds `is_all_time_favourite` to `cinema_products`.
 *
 * "All Time Favourite" is a fixed, non-editable section at the top of the
 * Consumer catalogue holding the products a cinema wants to push. It was
 * originally modelled as an ordinary `categories` row, which cannot express it:
 * `categories.chain_id` is NOT NULL and there is no `cinema_id`, so one
 * category row is shared by every cinema in the chain and the selection could
 * never differ per cinema. `cinema_products` is already the per-cinema,
 * per-product row (it carries `sequence`, the date range and `is_active`), so
 * the flag belongs here and nowhere else.
 *
 * Filing a product as a favourite therefore does NOT move it out of its real
 * category - it keeps its `products.category_id` and simply appears in the
 * fixed section as well.
 *
 * NOT NULL DEFAULT 0: every existing link starts as "not a favourite", which is
 * the correct reading of rows written before the column existed, and it keeps
 * the flag a plain boolean with no third "unset" state for the catalogue query
 * to interpret.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cinema_products', 'is_all_time_favourite', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cinema_products', 'is_all_time_favourite');
  },
};
