'use strict';

const { Model } = require('sequelize');

const { ConflictError } = require('../src/utils/errors');

module.exports = (sequelize, DataTypes) => {
  class CinemaProduct extends Model {
    static associate(models) {
      CinemaProduct.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      CinemaProduct.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });

      CinemaProduct.hasMany(models.ProductAvailabilityHour, {
        foreignKey: 'cinemaProductId',
        as: 'availabilityHours',
      });

      CinemaProduct.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      CinemaProduct.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  CinemaProduct.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Date-range availability (festival offers and the like).
      // isActive remains the primary enable/disable flag.
      availableFrom: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      availableUntil: {
        type: DataTypes.DATE,
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
      modelName: 'CinemaProduct',
      tableName: 'cinema_products',
      underscored: true,
      timestamps: true,
    }
  );

  // ---------------------------------------------------------------------------
  // MULTI-TENANT INTEGRITY GAP (schema.md, "Legacy and deferred notes")
  //
  // The database does NOT enforce that the linked product's chain_id matches the
  // cinema's chain_id. Nothing in the FK graph stops chain A's cinema from being
  // pointed at chain B's product, which would leak catalog data across tenants.
  // This hook is the only thing standing in the way - do not remove it without
  // adding an equivalent guard in the service layer.
  //
  // It costs two indexed PK lookups per write, and only runs when one of the two
  // FKs actually changed.
  // ---------------------------------------------------------------------------
  CinemaProduct.addHook('beforeSave', async (cinemaProduct, options) => {
    if (!cinemaProduct.isNewRecord &&
        !cinemaProduct.changed('cinemaId') &&
        !cinemaProduct.changed('productId')) {
      return;
    }

    const { Cinema, Product } = sequelize.models;
    const [cinema, product] = await Promise.all([
      Cinema.findByPk(cinemaProduct.cinemaId, {
        attributes: ['id', 'chainId'],
        transaction: options.transaction,
      }),
      Product.findByPk(cinemaProduct.productId, {
        attributes: ['id', 'chainId'],
        transaction: options.transaction,
      }),
    ]);

    // Missing rows are left to the foreign keys to reject.
    if (!cinema || !product) return;

    if (cinema.chainId !== product.chainId) {
      // ConflictError, not ValidationError: both ids are well-formed and both
      // rows exist. What fails is their relationship to stored state, so the
      // client gets a 409 rather than a 500.
      throw new ConflictError(
        'A cinema can only be linked to a product belonging to the same chain',
        {
          cinemaId: cinema.id,
          cinemaChainId: cinema.chainId,
          productId: product.id,
          productChainId: product.chainId,
        }
      );
    }
  });

  return CinemaProduct;
};
