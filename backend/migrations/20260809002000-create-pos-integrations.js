'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pos_integrations', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      provider: { type: 'VARCHAR(30)', allowNull: false },
      // External POS cinema identifier - distinct from cinemas.code.
      external_cinema_id: { type: 'VARCHAR(50)', allowNull: false },
      api_url: { type: 'VARCHAR(500)', allowNull: false },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
      // Pointer to external secret storage; never the secret itself.
      credential_ref: { type: 'VARCHAR(200)', allowNull: true },
      config: { type: 'NVARCHAR(MAX)', allowNull: true },
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

    await queryInterface.addIndex('pos_integrations', ['cinema_id', 'provider'], {
      name: 'UQ_pos_integrations_cinema_provider',
      unique: true,
    });

    // Filtered unique index - raw SQL because addIndex has no WHERE support for mssql.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX [UQ_pos_integrations_active_cinema] ' +
        'ON [pos_integrations]([cinema_id]) WHERE [is_active] = 1'
    );

    await queryInterface.sequelize.query(
      "ALTER TABLE [pos_integrations] ADD CONSTRAINT [CK_pos_integrations_provider] " +
        "CHECK ([provider] IN ('vista','showbizz','impact','qbusto'))"
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pos_integrations');
  },
};
