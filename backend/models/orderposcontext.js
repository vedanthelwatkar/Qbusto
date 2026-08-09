'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OrderPosContext extends Model {
    static associate(models) {
      OrderPosContext.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
      OrderPosContext.belongsTo(models.PosIntegration, {
        foreignKey: 'posIntegrationId',
        as: 'posIntegration',
      });
    }
  }

  OrderPosContext.init(
    {
      // Exactly one POS context per order.
      orderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      posIntegrationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      externalSessionId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      externalFilmId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      externalScreenId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      // Implements the client's POS_BookingId requirement: the committed external
      // POS booking/order id, without duplicating it onto orders.
      externalBookingId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'OrderPosContext',
      tableName: 'order_pos_context',
      underscored: true,
      // Immutable after creation: created_at only, no updated_at column.
      timestamps: true,
      updatedAt: false,
    }
  );

  return OrderPosContext;
};
