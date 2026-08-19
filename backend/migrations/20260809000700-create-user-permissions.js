'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_permissions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      module_name: { type: 'VARCHAR(50)', allowNull: false },
      can_read: { type: 'BIT', allowNull: false, defaultValue: 0 },
      can_edit: { type: 'BIT', allowNull: false, defaultValue: 0 },
      can_delete: { type: 'BIT', allowNull: false, defaultValue: 0 },
      created_by: { type: Sequelize.INTEGER, allowNull: true },
      updated_by: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    // Audit FKs are added separately so all three FKs to `users` stay NO ACTION
    // and individually named (see 20260809000600 for the SET NULL rationale).
    for (const field of ['created_by', 'updated_by']) {
      await queryInterface.addConstraint('user_permissions', {
        fields: [field],
        type: 'foreign key',
        name: `FK_user_permissions_${field}`,
        references: { table: 'users', field: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      });
    }

    await queryInterface.addIndex('user_permissions', ['user_id', 'module_name'], {
      name: 'UQ_user_permissions',
      unique: true,
    });

    await queryInterface.sequelize.query(
      "ALTER TABLE [user_permissions] ADD CONSTRAINT [CK_user_permissions_module_name] " +
        "CHECK ([module_name] IN ('Dashboard','Orders','Products','Categories','Pricing'," +
        "'Banners','Users','Reports','POS Integrations','Settings'))"
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_permissions');
  },
};
