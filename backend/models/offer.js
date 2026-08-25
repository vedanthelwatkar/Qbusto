'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Offer extends Model {
    static associate(models) {
      Offer.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      Offer.hasMany(models.Order, { foreignKey: 'offerId', as: 'orders' });

      Offer.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Offer.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Offer.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // What a customer types into "Apply coupon" in the Consumer app.
      // Unique per cinema (see the migration's index), not globally.
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      // Free text, but with a DEFINED meaning - see coupon.service's header
      // note: 'percentage' (case-insensitive) drives percent-of-cart math,
      // anything else (including 'flat') is a flat rupee amount.
      discountType: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      tnc: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active',
      },
      discAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      maxDiscAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      minTxnAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      maxTxnAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      // A redemption COUNT, not an amount.
      maxTxnLimit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      validFrom: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      validUntil: {
        type: DataTypes.DATE,
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
      modelName: 'Offer',
      tableName: 'offers',
      underscored: true,
      timestamps: true,
    }
  );

  return Offer;
};
