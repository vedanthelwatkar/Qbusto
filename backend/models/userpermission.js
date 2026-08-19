'use strict';

const { Model } = require('sequelize');

const MODULE_NAMES = [
  'Dashboard',
  'Orders',
  'Products',
  'Categories',
  'Pricing',
  'Banners',
  'Users',
  'Reports',
  'POS Integrations',
  'Settings',
];

module.exports = (sequelize, DataTypes) => {
  class UserPermission extends Model {
    static associate(models) {
      UserPermission.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });

      UserPermission.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      UserPermission.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  }

  UserPermission.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      moduleName: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
          isIn: [MODULE_NAMES],
        },
      },
      canRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      canEdit: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      canDelete: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      modelName: 'UserPermission',
      tableName: 'user_permissions',
      underscored: true,
      timestamps: true,
    }
  );

  UserPermission.MODULE_NAMES = MODULE_NAMES;

  return UserPermission;
};
