'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RazorpayWebhookEvent extends Model {
    static associate(models) {
      // Optional: an event for an unrecognised Razorpay order has no internal
      // order to point at, and is still recorded.
      RazorpayWebhookEvent.belongsTo(models.Order, {
        foreignKey: 'orderId',
        as: 'order',
      });
    }
  }

  RazorpayWebhookEvent.init(
    {
      eventId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'x-razorpay-event-id header; unique per Razorpay event',
      },
      event: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      razorpayOrderId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      razorpayPaymentId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      orderId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      outcome: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'RazorpayWebhookEvent',
      tableName: 'razorpay_webhook_events',
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ['razorpay_order_id'] }],
    }
  );

  return RazorpayWebhookEvent;
};
