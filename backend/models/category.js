'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Category extends Model {
    static associate(models) {
      Category.belongsTo(models.Chain, { foreignKey: 'chainId', as: 'chain' });

      Category.hasMany(models.Product, { foreignKey: 'categoryId', as: 'products' });
      Category.hasMany(models.CinemaCategory, { foreignKey: 'categoryId', as: 'cinemaCategories' });

      Category.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Category.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Category.init(
    {
      // Categories are chain-scoped; per-cinema availability lives in cinema_categories.
      chainId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      imageUrl: {
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
      modelName: 'Category',
      tableName: 'categories',
      underscored: true,
      timestamps: true,
    }
  );

  return Category;
};
