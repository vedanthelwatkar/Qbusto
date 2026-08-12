'use strict';

const { Model } = require('sequelize');

const NOTIFICATION_STATUSES = ['pending', 'success', 'failed'];

module.exports = (sequelize, DataTypes) => {
  class Order extends Model {
    static associate(models) {
      Order.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      Order.belongsTo(models.Screen, { foreignKey: 'screenId', as: 'screen' });
      Order.belongsTo(models.OrderStatus, { foreignKey: 'statusId', as: 'status' });
      Order.belongsTo(models.PaymentStatus, {
        foreignKey: 'paymentStatusId',
        as: 'paymentStatus',
      });

      Order.hasMany(models.OrderItem, { foreignKey: 'orderId', as: 'items' });
      Order.hasMany(models.OrderStatusLog, { foreignKey: 'orderId', as: 'statusLogs' });
      Order.hasMany(models.PaymentStatusLog, { foreignKey: 'orderId', as: 'paymentStatusLogs' });
      Order.hasMany(models.PosTransaction, { foreignKey: 'orderId', as: 'posTransactions' });

      Order.hasOne(models.OrderPosContext, { foreignKey: 'orderId', as: 'posContext' });
      Order.hasOne(models.IdempotencyKey, { foreignKey: 'orderId', as: 'idempotencyKey' });
    }
  }

  Order.init(
    {
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Nullable: counter and kiosk orders may not be screen-specific.
      screenId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      seatNumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      statusId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      source: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
          isIn: [['qr', 'seat_qr', 'kiosk', 'counter']],
        },
      },
      customerMobile: {
        type: DataTypes.STRING(15),
        allowNull: true,
      },
      customerEmail: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      // Provider-neutral display snapshots.
      filmTitle: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      showTime: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      discount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      paymentStatusId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // smsStatus and whatsappStatus are independent. NULL means the channel was
      // not applicable or not enabled for this order.
      smsStatus: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
          isIn: [NOTIFICATION_STATUSES],
        },
      },
      whatsappStatus: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
          isIn: [NOTIFICATION_STATUSES],
        },
      },
      razorpayOrderId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      razorpayPaymentId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      razorpaySignature: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      notes: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Order',
      tableName: 'orders',
      underscored: true,
      timestamps: true,
    }
  );

  return Order;
};
