'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screen_pos_mappings', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      pos_integration_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'pos_integrations', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      screen_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'screens', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      external_screen_id: { type: 'VARCHAR(50)', allowNull: false },
      // Audit FKs: NO ACTION, not SET NULL - see 20260809000600 for why.
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

    await queryInterface.addIndex('screen_pos_mappings', ['pos_integration_id', 'screen_id'], {
      name: 'UQ_screen_pos_mappings',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('screen_pos_mappings');
  },
};
