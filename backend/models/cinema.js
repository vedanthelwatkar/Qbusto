'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Cinema extends Model {
    static associate(models) {
      Cinema.belongsTo(models.Chain, { foreignKey: 'chainId', as: 'chain' });

      Cinema.hasMany(models.Screen, { foreignKey: 'cinemaId', as: 'screens' });
      Cinema.hasMany(models.User, { foreignKey: 'cinemaId', as: 'users' });
      Cinema.hasMany(models.Banner, { foreignKey: 'cinemaId', as: 'banners' });
      Cinema.hasMany(models.CinemaCategory, { foreignKey: 'cinemaId', as: 'cinemaCategories' });
      Cinema.hasMany(models.CinemaProduct, { foreignKey: 'cinemaId', as: 'cinemaProducts' });
      Cinema.hasMany(models.ProductPricing, { foreignKey: 'cinemaId', as: 'productPricings' });
      Cinema.hasMany(models.Order, { foreignKey: 'cinemaId', as: 'orders' });
      Cinema.hasMany(models.PosIntegration, { foreignKey: 'cinemaId', as: 'posIntegrations' });
      // Sessions carry the cinema's CODE, not its id - see models/session.js.
      Cinema.hasMany(models.Session, {
        foreignKey: 'cinemaCode',
        sourceKey: 'code',
        as: 'sessions',
      });
      Cinema.hasMany(models.PaymentGatewayConfig, {
        foreignKey: 'cinemaId',
        as: 'paymentGatewayConfigs',
      });
      Cinema.hasMany(models.Offer, { foreignKey: 'cinemaId', as: 'offers' });

      Cinema.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Cinema.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  Cinema.init(
    {
      chainId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // QBusto-owned short cinema identifier used in QR URLs and display.
      // Not the external POS cinema id (that lives on pos_integrations).
      code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      location: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      gstNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      fssaiNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      /**
       * The Consumer screensaver artwork for this cinema.
       *
       * Either an application upload path (`/uploads/cinemas/<file>`) or an
       * external URL, in one column - the same convention as
       * `chains.logoImageUrl` and `banners.imageUrl`.
       *
       * Nullable at the column even though creating a cinema requires it: the
       * cinemas that predate the field have none, and the Consumer falls back
       * to its text hero rather than breaking.
       */
      screensaverUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      activeSince: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      smsEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      whatsappEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Cinema',
      tableName: 'cinemas',
      underscored: true,
      timestamps: true,
    }
  );

  return Cinema;
};
