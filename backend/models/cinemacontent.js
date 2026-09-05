'use strict';

const { Model } = require('sequelize');

/**
 * One row per cinema: the "About Cinema" / "Terms & Conditions" content shown
 * at the bottom of the Consumer app. See the migration's header note for why
 * `tncPoints` is a JSON-encoded string here rather than a child table -
 * parsing/serializing it is `cinemaContent.service.js`'s job, not this
 * model's; the column stays a plain string so a bad/legacy value can never
 * throw from inside a model hook.
 */
module.exports = (sequelize, DataTypes) => {
  class CinemaContent extends Model {
    static associate(models) {
      CinemaContent.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      CinemaContent.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      CinemaContent.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  CinemaContent.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      contactNo: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      mailId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      tncPoints: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      iconUrl: {
        type: DataTypes.TEXT,
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
      modelName: 'CinemaContent',
      tableName: 'cinema_content',
      underscored: true,
      timestamps: true,
    }
  );

  return CinemaContent;
};
