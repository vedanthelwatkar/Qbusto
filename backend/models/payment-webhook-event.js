'use strict';

const { Model } = require('sequelize');

/**
 * The durable record of every payment webhook delivery.
 *
 * Provider-neutral by design: the columns name a "gateway", not a specific
 * provider, so a future change of gateway needs no migration here. The table
 * was renamed from `razorpay_webhook_events` in
 * 20260825000100-rename-payment-columns-provider-neutral.
 */
module.exports = (sequelize, DataTypes) => {
  class PaymentWebhookEvent extends Model {
    static associate(models) {
      // Optional: an event for an unrecognised gateway order has no internal
      // order to point at, and is still recorded.
      PaymentWebhookEvent.belongsTo(models.Order, {
        foreignKey: 'orderId',
        as: 'order',
      });
    }
  }

  PaymentWebhookEvent.init(
    {
      eventId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Dedup key: "<event type>:<gateway payment id>". Unique per logical event.',
      },
      event: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      gatewayOrderId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      gatewayPaymentId: {
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
      modelName: 'PaymentWebhookEvent',
      tableName: 'payment_webhook_events',
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ['gateway_order_id'] }],
    }
  );

  return PaymentWebhookEvent;
};
