'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('order_items');
    if (!table.special_instructions) {
      await queryInterface.addColumn('order_items', 'special_instructions', {
        type: Sequelize.STRING(500),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable('order_items');
    if (table.special_instructions) {
      await queryInterface.removeColumn('order_items', 'special_instructions');
    }
  },
};
