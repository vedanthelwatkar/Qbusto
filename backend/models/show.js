'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Show extends Model {
    static associate(models) {
      Show.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });
      // Optional: a show may exist before its external screen is mapped.
      Show.belongsTo(models.Screen, { foreignKey: 'screenId', as: 'screen' });
      Show.belongsTo(models.PosIntegration, {
        foreignKey: 'posIntegrationId',
        as: 'posIntegration',
      });
    }
  }

  Show.init(
    {
      // Denormalized from pos_integrations so the window query and tenant scoping
      // do not need a join.
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Null until the external screen is mapped in screen_pos_mappings.
      screenId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      posIntegrationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Provider session/show identifier. With posIntegrationId this forms the
      // natural key that POS sync upserts on, and that order_pos_context already
      // stores per order.
      externalSessionId: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      // As returned by the POS, before mapping to screenId.
      externalScreenId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      externalFilmId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      // Display snapshot. Width matches orders.filmTitle.
      filmTitle: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      // UTC instant. The POS supplies cinema-local wall clock; conversion happens
      // centrally in the sync service (Phase B5), never in a provider adapter.
      showTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // Provider-neutral lifecycle, mirroring CK_shows_status. Deliberately not
      // isActive: these rows mirror external state rather than being
      // staff-managed master data.
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'scheduled',
        validate: {
          isIn: [['scheduled', 'cancelled']],
        },
      },
      // Last time the POS confirmed this show exists.
      lastSyncedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // No createdBy/updatedBy: machine-written by the POS sync, not authored by
      // a user. Matches OrderPosContext and PosTransaction.
    },
    {
      sequelize,
      modelName: 'Show',
      tableName: 'shows',
      underscored: true,
      timestamps: true,
    }
  );

  return Show;
};
