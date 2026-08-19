'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('banners', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      image_url: { type: 'VARCHAR(500)', allowNull: false },
      // 'H' = Header, 'I' = Inner. V1 uses Header only.
      type: { type: 'CHAR(1)', allowNull: false },
      sequence: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      start_date: { type: 'DATETIME2', allowNull: true },
      end_date: { type: 'DATETIME2', allowNull: true },
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

    await queryInterface.sequelize.query(
      "ALTER TABLE [banners] ADD CONSTRAINT [CK_banners_type] CHECK ([type] IN ('H','I'))"
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('banners');
  },
};
