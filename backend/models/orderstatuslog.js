'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OrderStatusLog extends Model {
    static associate(models) {
      OrderStatusLog.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
      OrderStatusLog.belongsTo(models.OrderStatus, {
        foreignKey: 'previousStatusId',
        as: 'previousStatus',
      });
      OrderStatusLog.belongsTo(models.OrderStatus, {
        foreignKey: 'newStatusId',
        as: 'newStatus',
      });
      OrderStatusLog.belongsTo(models.User, {
        foreignKey: 'changedByUserId',
        as: 'changedByUser',
      });
    }
  }

  OrderStatusLog.init(
    {
      orderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Nullable on the first entry for an order.
      previousStatusId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      newStatusId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      changedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'OrderStatusLog',
      tableName: 'order_status_logs',
      underscored: true,
      // Append-only: created_at only, no updated_at column.
      timestamps: true,
      updatedAt: false,
    }
  );

  return OrderStatusLog;
};
