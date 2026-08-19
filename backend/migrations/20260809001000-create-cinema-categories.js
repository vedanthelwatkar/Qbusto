'use strict';

/**
 * The DB does not enforce that `categories.chain_id` matches `cinemas.chain_id`
 * for a given row. That validation lives in the CinemaCategory model hook
 * (see models/cinemacategory.js) per schema.md's "Legacy and deferred notes".
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cinema_categories', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      category_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'categories', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      sequence: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
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

    await queryInterface.addIndex('cinema_categories', ['cinema_id', 'category_id'], {
      name: 'UQ_cinema_categories',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cinema_categories');
  },
};
