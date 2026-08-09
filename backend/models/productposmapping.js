'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductPosMapping extends Model {
    static associate(models) {
      ProductPosMapping.belongsTo(models.PosIntegration, {
        foreignKey: 'posIntegrationId',
        as: 'posIntegration',
      });
      ProductPosMapping.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });

      ProductPosMapping.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      ProductPosMapping.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  ProductPosMapping.init(
    {
      posIntegrationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      externalItemId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      externalGroupId: {
        type: DataTypes.STRING(50),
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
      modelName: 'ProductPosMapping',
      tableName: 'product_pos_mappings',
      underscored: true,
      timestamps: true,
    }
  );

  return ProductPosMapping;
};
