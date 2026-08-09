'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PosTransaction extends Model {
    static associate(models) {
      PosTransaction.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
      PosTransaction.belongsTo(models.PosIntegration, {
        foreignKey: 'posIntegrationId',
        as: 'posIntegration',
      });
    }
  }

  PosTransaction.init(
    {
      orderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      posIntegrationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      operation: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      idempotencyKey: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      // Operational state, not a master table.
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        validate: {
          isIn: [['pending', 'success', 'failed', 'unknown']],
        },
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: { min: 1 },
      },
      externalResponseId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      // Never store secrets, auth tokens, or sensitive PII in the payload columns.
      requestPayload: {
        type: DataTypes.STRING(4000),
        allowNull: true,
      },
      responsePayload: {
        type: DataTypes.STRING(4000),
        allowNull: true,
      },
      lastError: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      lastAttemptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PosTransaction',
      tableName: 'pos_transactions',
      underscored: true,
      timestamps: true,
    }
  );

  return PosTransaction;
};
