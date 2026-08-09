'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('products', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      chain_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chains', key: 'id' },
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
      name: { type: 'VARCHAR(200)', allowNull: false },
      description: { type: 'NVARCHAR(MAX)', allowNull: true },
      weight: { type: 'VARCHAR(50)', allowNull: true },
      image_url: { type: 'VARCHAR(500)', allowNull: true },
      tax_slab_code: { type: 'VARCHAR(20)', allowNull: true },
      is_addon: { type: 'BIT', allowNull: false, defaultValue: 0 },
      // Self-reference; the FK is attached below so it gets an explicit name and
      // is not affected by createTable's self-referential special-casing.
      addon_parent_id: { type: Sequelize.INTEGER, allowNull: true },
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

    await queryInterface.addConstraint('products', {
      fields: ['addon_parent_id'],
      type: 'foreign key',
      name: 'FK_products_addon_parent_id',
      references: { table: 'products', field: 'id' },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('products');
  },
};
