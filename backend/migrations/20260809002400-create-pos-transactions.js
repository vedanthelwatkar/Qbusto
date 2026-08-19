'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pos_transactions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      order_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      pos_integration_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'pos_integrations', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      operation: { type: 'VARCHAR(30)', allowNull: false },
      idempotency_key: { type: 'VARCHAR(100)', allowNull: false },
      status: { type: 'VARCHAR(20)', allowNull: false, defaultValue: 'pending' },
      attempt_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      external_response_id: { type: 'VARCHAR(100)', allowNull: true },
      // Never store secrets, auth tokens, or sensitive PII in the payload columns.
      request_payload: { type: 'NVARCHAR(4000)', allowNull: true },
      response_payload: { type: 'NVARCHAR(4000)', allowNull: true },
      last_error: { type: 'VARCHAR(500)', allowNull: true },
      last_attempted_at: { type: 'DATETIME2', allowNull: true },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex('pos_transactions', ['idempotency_key'], {
      name: 'UQ_pos_transactions_idempotency_key',
      unique: true,
    });
    await queryInterface.addIndex('pos_transactions', ['order_id'], {
      name: 'IX_pos_transactions_order_id',
    });

    const checks = [
      ['CK_pos_transactions_status', "[status] IN ('pending','success','failed','unknown')"],
      ['CK_pos_transactions_attempt_count', '[attempt_count] >= 1'],
    ];

    for (const [name, expression] of checks) {
      await queryInterface.sequelize.query(
        `ALTER TABLE [pos_transactions] ADD CONSTRAINT [${name}] CHECK (${expression})`
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pos_transactions');
  },
};
