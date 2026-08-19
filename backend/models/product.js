'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      Product.belongsTo(models.Chain, { foreignKey: 'chainId', as: 'chain' });
      Product.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });

      // Nullable self-reference: an add-on points at the product it attaches to.
      Product.belongsTo(models.Product, { foreignKey: 'addonParentId', as: 'addonParent' });
      Product.hasMany(models.Product, { foreignKey: 'addonParentId', as: 'addons' });

      Product.hasMany(models.CinemaProduct, { foreignKey: 'productId', as: 'cinemaProducts' });
      Product.hasMany(models.ProductPricing, { foreignKey: 'productId', as: 'pricings' });
      Product.hasMany(models.OrderItem, { foreignKey: 'productId', as: 'orderItems' });
      Product.hasMany(models.ProductPosMapping, { foreignKey: 'productId', as: 'posMappings' });

      Product.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Product.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Product.init(
    {
      chainId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      categoryId: {
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
      weight: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      imageUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      taxSlabCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      isAddon: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      addonParentId: {
        type: DataTypes.INTEGER,
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
      modelName: 'Product',
      tableName: 'products',
      underscored: true,
      timestamps: true,
    }
  );

  return Product;
};
