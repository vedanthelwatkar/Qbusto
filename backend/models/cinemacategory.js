'use strict';

const { Model } = require('sequelize');

const { ConflictError } = require('../src/utils/errors');

module.exports = (sequelize, DataTypes) => {
  class CinemaCategory extends Model {
    static associate(models) {
      CinemaCategory.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      CinemaCategory.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });

      CinemaCategory.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      CinemaCategory.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  CinemaCategory.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      modelName: 'CinemaCategory',
      tableName: 'cinema_categories',
      underscored: true,
      timestamps: true,
    }
  );

  // ---------------------------------------------------------------------------
  // MULTI-TENANT INTEGRITY GAP (schema.md, "Legacy and deferred notes")
  //
  // The database does NOT enforce that the linked category's chain_id matches
  // the cinema's chain_id. Nothing in the FK graph stops chain A's cinema from
  // being pointed at chain B's category, which would leak catalog data across
  // tenants. This hook is the only thing standing in the way - do not remove it
  // without adding an equivalent guard in the service layer.
  //
  // It costs two indexed PK lookups per write, and only runs when one of the two
  // FKs actually changed.
  // ---------------------------------------------------------------------------
  CinemaCategory.addHook('beforeSave', async (cinemaCategory, options) => {
    if (!cinemaCategory.isNewRecord &&
        !cinemaCategory.changed('cinemaId') &&
        !cinemaCategory.changed('categoryId')) {
      return;
    }

    const { Cinema, Category } = sequelize.models;
    const [cinema, category] = await Promise.all([
      Cinema.findByPk(cinemaCategory.cinemaId, {
        attributes: ['id', 'chainId'],
        transaction: options.transaction,
      }),
      Category.findByPk(cinemaCategory.categoryId, {
        attributes: ['id', 'chainId'],
        transaction: options.transaction,
      }),
    ]);

    // Missing rows are left to the foreign keys to reject.
    if (!cinema || !category) return;

    if (cinema.chainId !== category.chainId) {
      // ConflictError, not ValidationError: both ids are well-formed and both
      // rows exist. What fails is their relationship to stored state, so the
      // client gets a 409 rather than a 500.
      throw new ConflictError(
        'A cinema can only be linked to a category belonging to the same chain',
        {
          cinemaId: cinema.id,
          cinemaChainId: cinema.chainId,
          categoryId: category.id,
          categoryChainId: category.chainId,
        }
      );
    }
  });

  return CinemaCategory;
};
