'use strict';

/**
 * Audit FKs are deferred to 20260809000600 for the same cycle reason as `chains`
 * (`users.cinema_id` references `cinemas.id`).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cinemas', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      chain_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chains', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      code: { type: 'VARCHAR(10)', allowNull: false },
      name: { type: 'VARCHAR(100)', allowNull: false },
      location: { type: 'VARCHAR(255)', allowNull: true },
      city: { type: 'VARCHAR(100)', allowNull: true },
      gst_number: { type: 'VARCHAR(50)', allowNull: true },
      fssai_number: { type: 'VARCHAR(50)', allowNull: true },
      active_since: { type: 'DATETIME2', allowNull: true },
      sms_enabled: { type: 'BIT', allowNull: false, defaultValue: 0 },
      whatsapp_enabled: { type: 'BIT', allowNull: false, defaultValue: 0 },
      is_active: { type: 'BIT', allowNull: false, defaultValue: 1 },
      created_by: { type: Sequelize.INTEGER, allowNull: true },
      updated_by: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('cinemas', ['code'], {
      name: 'UQ_cinemas_code',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cinemas');
  },
};
