'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OrderStatus extends Model {
    static associate(models) {
      OrderStatus.hasMany(models.Order, { foreignKey: 'statusId', as: 'orders' });

      OrderStatus.hasMany(models.OrderStatusLog, {
        foreignKey: 'previousStatusId',
        as: 'logsAsPrevious',
      });
      OrderStatus.hasMany(models.OrderStatusLog, {
        foreignKey: 'newStatusId',
        as: 'logsAsNew',
      });
    }
  }

  OrderStatus.init(
    {
      // Application logic depends on `code`, never on the numeric id.
      code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'OrderStatus',
      tableName: 'order_statuses',
      underscored: true,
      timestamps: true,
    }
  );

  return OrderStatus;
};
