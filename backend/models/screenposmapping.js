'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ScreenPosMapping extends Model {
    static associate(models) {
      ScreenPosMapping.belongsTo(models.PosIntegration, {
        foreignKey: 'posIntegrationId',
        as: 'posIntegration',
      });
      ScreenPosMapping.belongsTo(models.Screen, { foreignKey: 'screenId', as: 'screen' });

      ScreenPosMapping.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      ScreenPosMapping.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  ScreenPosMapping.init(
    {
      posIntegrationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      screenId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      externalScreenId: {
        type: DataTypes.STRING(50),
        allowNull: false,
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
      modelName: 'ScreenPosMapping',
      tableName: 'screen_pos_mappings',
      underscored: true,
      timestamps: true,
    }
  );

  return ScreenPosMapping;
};
