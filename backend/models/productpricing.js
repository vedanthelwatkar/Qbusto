'use strict';

const { Model } = require('sequelize');

const { ValidationError } = require('../src/utils/errors');

const CHANNEL_DISCOUNT_FIELDS = [
  'discountOnQr',
  'discountOnKiosk',
  'discountOnSeatQr',
  'discountOnCounter',
];

module.exports = (sequelize, DataTypes) => {
  class ProductPricing extends Model {
    static associate(models) {
      ProductPricing.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      ProductPricing.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });

      ProductPricing.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      ProductPricing.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  ProductPricing.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // 0 = default/all days, 1 = Monday ... 7 = Sunday
      dayOfWeek: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
      },
      basePrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      // 'P' = Percentage, 'F' = Flat Amount. Governs every discountOn* value.
      discountType: {
        type: DataTypes.CHAR(1),
        allowNull: true,
        validate: {
          isIn: [['P', 'F']],
        },
      },
      discountValue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      discountOnQr: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      discountOnKiosk: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      discountOnSeatQr: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      discountOnCounter: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
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
      modelName: 'ProductPricing',
      tableName: 'product_pricing',
      underscored: true,
      timestamps: true,
    }
  );

  // ---------------------------------------------------------------------------
  // schema.md: "The channel discount columns should be non-NULL only when
  // discount_type is set, and the application layer should validate that
  // relationship." The DB cannot express this, so it is enforced here.
  //
  // Without discountType a value like discountOnQr = 10 is meaningless - there
  // is no way to tell 10% from Rs.10 - so the write is rejected rather than
  // silently persisted and misread at checkout.
  // ---------------------------------------------------------------------------
  ProductPricing.addHook('beforeSave', (pricing) => {
    if (pricing.discountType) return;

    const orphaned = CHANNEL_DISCOUNT_FIELDS.concat('discountValue').filter(
      (field) => pricing[field] !== null && pricing[field] !== undefined
    );

    if (orphaned.length > 0) {
      // ValidationError: the payload contradicts itself, independently of
      // anything stored, so this is a 400.
      throw new ValidationError(
        "discountType must be set ('P' or 'F') when any discount amount is provided",
        orphaned.map((field) => ({
          field,
          message: `'${field}' requires 'discountType' to be set`,
        }))
      );
    }
  });

  return ProductPricing;
};
