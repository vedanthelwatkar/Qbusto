'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Screen extends Model {
    static associate(models) {
      Screen.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      Screen.hasMany(models.Order, { foreignKey: 'screenId', as: 'orders' });
      Screen.hasMany(models.ScreenPosMapping, { foreignKey: 'screenId', as: 'posMappings' });
      Screen.hasMany(models.Show, { foreignKey: 'screenId', as: 'shows' });

      Screen.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Screen.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Screen.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Freeform: "Screen 1", "IMAX", "Gold Class", ...
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      /**
       * Seat class this row of the auditorium belongs to, e.g. "Platinum" or
       * "Recliner". Free text: cinemas name their own seating tiers.
       *
       * Supplied by the client's data. Nullable, because the rows that predate
       * it do not carry one.
       */
      category: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      /**
       * Seat-row label, e.g. "A". Two characters, so "AA" is possible.
       *
       * Matches the row half of the seat string an order stores: the Consumer
       * joins row and seat into `orders.seat_number` as e.g. "A5".
       */
      seatRow: {
        type: DataTypes.STRING(2),
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
      modelName: 'Screen',
      tableName: 'screens',
      underscored: true,
      timestamps: true,
    }
  );

  return Screen;
};
