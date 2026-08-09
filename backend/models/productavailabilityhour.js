'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductAvailabilityHour extends Model {
    static associate(models) {
      ProductAvailabilityHour.belongsTo(models.CinemaProduct, {
        foreignKey: 'cinemaProductId',
        as: 'cinemaProduct',
      });

      ProductAvailabilityHour.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      ProductAvailabilityHour.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  ProductAvailabilityHour.init(
    {
      cinemaProductId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // 0 = all days, 1 = Monday ... 7 = Sunday
      dayOfWeek: {
        type: DataTypes.TINYINT,
        allowNull: false,
        validate: {
          min: 0,
          max: 7,
        },
      },
      // startTime < endTime is deliberately NOT enforced: an overnight window
      // (22:00 -> 02:00) is a legitimate row that application logic interprets.
      startTime: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      endTime: {
        type: DataTypes.TIME,
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
      modelName: 'ProductAvailabilityHour',
      tableName: 'product_availability_hours',
      underscored: true,
      timestamps: true,
    }
  );

  return ProductAvailabilityHour;
};
