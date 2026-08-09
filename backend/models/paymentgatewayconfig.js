'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PaymentGatewayConfig extends Model {
    static associate(models) {
      PaymentGatewayConfig.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      PaymentGatewayConfig.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      PaymentGatewayConfig.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  PaymentGatewayConfig.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      gatewayUrl: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      gatewayId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Ciphertext only. The encryption key lives outside the database (server
      // config or a secret manager), never in this table.
      gatewaySecretEncrypted: {
        type: DataTypes.STRING(1000),
        allowNull: false,
      },
      // A filtered unique index allows only one active config per cinema;
      // inactive historical rows may remain.
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PaymentGatewayConfig',
      tableName: 'payment_gateway_config',
      underscored: true,
      timestamps: true,
    }
  );

  return PaymentGatewayConfig;
};
