'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      chain_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chains', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      role: { type: 'VARCHAR(20)', allowNull: false },
      username: { type: 'VARCHAR(50)', allowNull: false },
      password_hash: { type: 'VARCHAR(255)', allowNull: false },
      first_name: { type: 'VARCHAR(50)', allowNull: true },
      last_name: { type: 'VARCHAR(50)', allowNull: true },
      mobile: { type: 'VARCHAR(15)', allowNull: true },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('users', ['username'], {
      name: 'UQ_users_username',
      unique: true,
    });

    await queryInterface.sequelize.query(
      "ALTER TABLE [users] ADD CONSTRAINT [CK_users_role] " +
        "CHECK ([role] IN ('owner','chain_admin','cinema_admin','kitchen_staff','cinema_accountant'))"
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
