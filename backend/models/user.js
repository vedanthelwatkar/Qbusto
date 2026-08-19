'use strict';

const bcrypt = require('bcrypt');
const { Model } = require('sequelize');

const SALT_ROUNDS = 10;

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Chain, { foreignKey: 'chainId', as: 'chain' });
      User.belongsTo(models.Cinema, { foreignKey: 'cinemaId', as: 'cinema' });

      User.hasMany(models.UserPermission, { foreignKey: 'userId', as: 'permissions' });
      User.hasMany(models.OrderStatusLog, { foreignKey: 'changedByUserId', as: 'orderStatusLogs' });
      User.hasMany(models.PaymentStatusLog, {
        foreignKey: 'changedByUserId',
        as: 'paymentStatusLogs',
      });
    }

    /** Compare a plaintext password against the stored hash. */
    verifyPassword(plainPassword) {
      if (!plainPassword || !this.passwordHash) return Promise.resolve(false);
      return bcrypt.compare(plainPassword, this.passwordHash);
    }
  }

  User.init(
    {
      chainId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Nullable for owner and chain_admin roles, which are not cinema-scoped.
      cinemaId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      role: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          isIn: [['owner', 'chain_admin', 'cinema_admin', 'kitchen_staff', 'cinema_accountant']],
        },
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Write-only convenience field. Set `password` to a plaintext value and the
      // hook below hashes it into passwordHash; it is never stored or selected.
      password: {
        type: DataTypes.VIRTUAL,
        allowNull: true,
      },
      firstName: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      lastName: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      mobile: {
        type: DataTypes.STRING(15),
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
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
    }
  );

  // ---------------------------------------------------------------------------
  // Hash `password` -> `passwordHash` so callers never pre-hash.
  //
  // This runs on beforeValidate rather than beforeCreate/beforeUpdate on purpose:
  // Sequelize validates before those hooks fire, so passwordHash's allowNull:false
  // would reject a create that supplies only `password`. beforeValidate covers
  // both create and update.
  // ---------------------------------------------------------------------------
  User.addHook('beforeValidate', async (user) => {
    const plainPassword = user.password;
    if (!plainPassword) return;

    user.passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    user.set('password', null);
  });

  return User;
};
