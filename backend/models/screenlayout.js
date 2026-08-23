'use strict';

const { Model } = require('sequelize');

/**
 * The client's seat map: one row per physical seat.
 *
 * Mapped exactly as the client built it, including the fact that it identifies
 * a screen by `screen_name` text rather than by `screens.id`. That is their
 * structure and it is left alone; resolving the name to an id is the reader's
 * job, not something to be corrected by redesigning the table.
 *
 * Currently empty. Nothing in the application reads it yet - QBusto neither
 * sells nor allocates seats - but the model exists so the table is reachable
 * and is covered by schema verification rather than sitting outside the
 * application's view of the database.
 */
module.exports = (sequelize, DataTypes) => {
  class ScreenLayout extends Model {
    static associate(models) {
      ScreenLayout.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      ScreenLayout.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      ScreenLayout.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  ScreenLayout.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // The screen this seat belongs to, by name. Not a foreign key.
      screenName: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      // Seat class, e.g. "Platinum". Matches screens.category.
      category: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      // Row label, e.g. "A".
      seatRow: {
        type: DataTypes.STRING(2),
        allowNull: false,
      },
      // Seat number within the row, e.g. "5". Stored as text, as the client
      // has it - seat numbering is not always purely numeric.
      seatNo: {
        type: DataTypes.STRING(3),
        allowNull: false,
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
      modelName: 'ScreenLayout',
      tableName: 'screen_layout',
      underscored: true,
      timestamps: true,
    }
  );

  return ScreenLayout;
};
