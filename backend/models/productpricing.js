'use strict';

const { Model } = require('sequelize');

const { ValidationError } = require('../src/utils/errors');

/** Monday first, matching `businessDayOfWeek` (1 = Monday ... 7 = Sunday). */
const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** The four channel-specific discount suffixes, per day. */
const CHANNEL_SUFFIXES = ['Qr', 'Kiosk', 'SeatQr', 'Counter'];

module.exports = (sequelize, DataTypes) => {
  return buildModel(sequelize, DataTypes);
};

module.exports.DAYS = DAYS;
module.exports.CHANNEL_SUFFIXES = CHANNEL_SUFFIXES;

function buildModel(sequelize, DataTypes) {
  class ProductPricing extends Model {
    static associate(models) {
      ProductPricing.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      ProductPricing.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });

      ProductPricing.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      ProductPricing.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  const priceColumn = (money = { validate: { min: 0 } }) => ({
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    ...money,
  });

  const attributes = {
    cinemaId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  };

  /*
   * THE WEEK, AS SEVEN PRICES AND SEVEN INDEPENDENT DISCOUNTS.
   *
   * One row per (cinema, product) holds all seven days. Until 20260905000100
   * this was one ROW per day plus a `day_of_week` 0 row meaning "every day",
   * which made setting a weekend price a second trip through the form.
   *
   * NULL PRICE IS MEANINGFUL: it is "not priced on that day", and a product
   * with no price for today is not sellable today. Cinema 8 sells product 151
   * on Friday, Saturday and Sunday only - so these are nullable on purpose and
   * must not be given a default.
   *
   * EACH DAY HAS ITS OWN DISCOUNT, independently of every other day. A single
   * shared discount was tried first and rejected once live data was checked:
   * cinema 1 / product 14 had a Wednesday-only flat discount that did NOT
   * apply the other six days, so "one discount for the whole row" cannot
   * represent it - a Wednesday discount would leak onto Thursday. The columns
   * below are named `{day}DiscountType`, `{day}DiscountValue` and
   * `{day}DiscountOn{Channel}`, mechanically for each of the seven days, the
   * same shape the old single shared discount used, just seven times. This is
   * repetition, not a new abstraction - it mirrors exactly how the seven price
   * columns already work.
   *
   * Which day applies - for both price and discount - is decided by the
   * BUSINESS day (06:00 -> 06:00), not the calendar day: see
   * utils/businessDay.js. An order placed at 01:00 on Monday is priced, and
   * discounted, as Sunday.
   */
  for (const day of DAYS) {
    attributes[`${day}Price`] = priceColumn();

    // 'P' = Percentage, 'F' = Flat Amount. Governs every discountOn* value
    // for THIS day only.
    attributes[`${day}DiscountType`] = {
      type: DataTypes.CHAR(1),
      allowNull: true,
      validate: { isIn: [['P', 'F']] },
    };
    attributes[`${day}DiscountValue`] = priceColumn();

    for (const channel of CHANNEL_SUFFIXES) {
      attributes[`${day}DiscountOn${channel}`] = priceColumn();
    }
  }

  attributes.isActive = {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  };
  attributes.createdBy = { type: DataTypes.INTEGER, allowNull: true };
  attributes.updatedBy = { type: DataTypes.INTEGER, allowNull: true };

  ProductPricing.init(attributes, {
    sequelize,
    modelName: 'ProductPricing',
    tableName: 'product_pricing',
    underscored: true,
    timestamps: true,
  });

  // ---------------------------------------------------------------------------
  // schema.md: "The channel discount columns should be non-NULL only when
  // discount_type is set, and the application layer should validate that
  // relationship." The DB cannot express this, so it is enforced here - once
  // per day, since each day's discount now stands on its own.
  //
  // Without a day's discountType, a value like {day}DiscountOnQr = 10 is
  // meaningless - there is no way to tell 10% from Rs.10 - so the write is
  // rejected rather than silently persisted and misread at checkout.
  // ---------------------------------------------------------------------------
  ProductPricing.addHook('beforeSave', (pricing) => {
    const problems = [];

    for (const day of DAYS) {
      const typeField = `${day}DiscountType`;
      if (pricing[typeField]) continue;

      const dependentFields = [`${day}DiscountValue`, ...CHANNEL_SUFFIXES.map((c) => `${day}DiscountOn${c}`)];
      const orphaned = dependentFields.filter(
        (field) => pricing[field] !== null && pricing[field] !== undefined
      );

      for (const field of orphaned) {
        problems.push({ field, message: `'${field}' requires '${typeField}' to be set` });
      }
    }

    if (problems.length > 0) {
      // ValidationError: the payload contradicts itself, independently of
      // anything stored, so this is a 400.
      throw new ValidationError(
        "a day's discount amount requires that day's discountType ('P' or 'F') to be set",
        problems
      );
    }
  });

  return ProductPricing;
}
