'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class IdempotencyKey extends Model {
    static associate(models) {
      IdempotencyKey.belongsTo(models.Order, {
        foreignKey: 'orderId',
        as: 'order',
      });
    }
  }

  IdempotencyKey.init(
    {
      key: {
        type: DataTypes.STRING(36),
        allowNull: false,
        unique: true,
        comment: 'UUID v4 from Idempotency-Key header',
      },
      orderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'IdempotencyKey',
      tableName: 'idempotency_keys',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ['key'],
        },
      ],
    }
  );

  return IdempotencyKey;
};
