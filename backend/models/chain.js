'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Chain extends Model {
    static associate(models) {
      Chain.hasMany(models.Cinema, { foreignKey: 'chainId', as: 'cinemas' });
      Chain.hasMany(models.Category, { foreignKey: 'chainId', as: 'categories' });
      Chain.hasMany(models.Product, { foreignKey: 'chainId', as: 'products' });
      Chain.hasMany(models.User, { foreignKey: 'chainId', as: 'users' });

      Chain.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Chain.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Chain.init(
    {
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      logoImageUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
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
      modelName: 'Chain',
      tableName: 'chains',
      underscored: true,
      timestamps: true,
    }
  );

  return Chain;
};
