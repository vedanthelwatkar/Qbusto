'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payment_gateway_config', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      gateway_url: { type: 'VARCHAR(500)', allowNull: false },
      gateway_id: { type: 'VARCHAR(255)', allowNull: false },
      // Ciphertext only. The encryption key lives outside the database.
      gateway_secret_encrypted: { type: 'VARCHAR(1000)', allowNull: false },
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

    // Filtered unique index - raw SQL because addIndex has no WHERE support for mssql.
    // Only one active gateway config per cinema; inactive history may remain.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX [UQ_payment_gateway_config_active_cinema] ' +
        'ON [payment_gateway_config]([cinema_id]) WHERE [is_active] = 1'
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_gateway_config');
  },
};
