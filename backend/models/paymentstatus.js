'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PaymentStatus extends Model {
    static associate(models) {
      PaymentStatus.hasMany(models.Order, { foreignKey: 'paymentStatusId', as: 'orders' });

      PaymentStatus.hasMany(models.PaymentStatusLog, {
        foreignKey: 'previousStatusId',
        as: 'logsAsPrevious',
      });
      PaymentStatus.hasMany(models.PaymentStatusLog, {
        foreignKey: 'newStatusId',
        as: 'logsAsNew',
      });
    }
  }

  PaymentStatus.init(
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
      modelName: 'PaymentStatus',
      tableName: 'payment_statuses',
      underscored: true,
      timestamps: true,
    }
  );

  return PaymentStatus;
};
