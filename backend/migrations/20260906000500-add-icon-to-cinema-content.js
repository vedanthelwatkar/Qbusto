'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if the column already exists before adding it (idempotent).
    const table = await queryInterface.describeTable('cinema_content');
    if (!table.icon_url) {
      await queryInterface.addColumn('cinema_content', 'icon_url', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  down: () => {
    throw new Error('Irreversible migration');
  },
};
