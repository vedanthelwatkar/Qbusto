'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Banner extends Model {
    static associate(models) {
      Banner.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      Banner.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Banner.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Banner.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      imageUrl: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      // 'H' = Header, 'I' = Inner. V1 uses Header banners only.
      type: {
        type: DataTypes.CHAR(1),
        allowNull: false,
        validate: {
          isIn: [['H', 'I']],
        },
      },
      // Active banners are retrieved ordered by sequence.
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      startDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endDate: {
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
      modelName: 'Banner',
      tableName: 'banners',
      underscored: true,
      timestamps: true,
    }
  );

  return Banner;
};
