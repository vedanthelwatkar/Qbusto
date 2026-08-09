'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PaymentStatusLog extends Model {
    static associate(models) {
      PaymentStatusLog.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
      PaymentStatusLog.belongsTo(models.PaymentStatus, {
        foreignKey: 'previousStatusId',
        as: 'previousStatus',
      });
      PaymentStatusLog.belongsTo(models.PaymentStatus, {
        foreignKey: 'newStatusId',
        as: 'newStatus',
      });
      PaymentStatusLog.belongsTo(models.User, {
        foreignKey: 'changedByUserId',
        as: 'changedByUser',
      });
    }
  }

  PaymentStatusLog.init(
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
      razorpayPaymentId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PaymentStatusLog',
      tableName: 'payment_status_logs',
      underscored: true,
      // Append-only: created_at only, no updated_at column.
      timestamps: true,
      updatedAt: false,
    }
  );

  return PaymentStatusLog;
};
