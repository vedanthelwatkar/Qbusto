'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PosIntegration extends Model {
    static associate(models) {
      PosIntegration.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      PosIntegration.hasMany(models.ScreenPosMapping, {
        foreignKey: 'posIntegrationId',
        as: 'screenMappings',
      });
      PosIntegration.hasMany(models.ProductPosMapping, {
        foreignKey: 'posIntegrationId',
        as: 'productMappings',
      });
      PosIntegration.hasMany(models.OrderPosContext, {
        foreignKey: 'posIntegrationId',
        as: 'orderContexts',
      });
      PosIntegration.hasMany(models.PosTransaction, {
        foreignKey: 'posIntegrationId',
        as: 'transactions',
      });
      PosIntegration.hasMany(models.Show, {
        foreignKey: 'posIntegrationId',
        as: 'shows',
      });

      PosIntegration.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      PosIntegration.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  PosIntegration.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: {
          isIn: [['vista', 'showbizz', 'impact', 'qbusto']],
        },
      },
      // External POS cinema identifier - distinct from cinemas.code.
      externalCinemaId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      apiUrl: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      // Also answers the client's IS_Intigrated question; no duplicate flag exists.
      // A filtered unique index allows only one active row per cinema.
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Pointer into external secret storage. POS secrets are never stored here.
      credentialRef: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      // Non-secret JSON config only.
      config: {
        type: DataTypes.TEXT,
        allowNull: true,
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
      modelName: 'PosIntegration',
      tableName: 'pos_integrations',
      underscored: true,
      timestamps: true,
    }
  );

  return PosIntegration;
};
