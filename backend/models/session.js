'use strict';

const { Model } = require('sequelize');

/**
 * One screening, as the client's database holds it.
 *
 * Maps the client's `session` table (renamed from `Session` for naming
 * consistency in 20260823001000). As with `film`, the table is untouched and
 * the provider's column names stay; this model only gives the application its
 * own vocabulary for the columns it reads.
 *
 * KEYS
 *
 * The primary key is composite: `(Code, Session_lngSessionId)`. `Code` is the
 * cinema's own code, which is why the association to Cinema targets
 * `cinemas.code` rather than `cinemas.id`.
 *
 * SCREEN
 *
 * There is no `screens.id` here. The source system identifies the auditorium
 * by `Screen_bytNum` and `Screen_strName`, so resolving a session to a
 * QBusto screen is a lookup, not a join through a foreign key - and it is
 * currently ambiguous, because `screens` holds several rows per auditorium.
 * Both columns are exposed as-is and no resolution is attempted here.
 *
 * `timestamps` is off: the table has no created_at/updated_at pair, only the
 * source system's own `Session_dtmStamp`.
 */
module.exports = (sequelize, DataTypes) => {
  class Session extends Model {
    static associate(models) {
      Session.belongsTo(models.Film, {
        foreignKey: 'filmCode',
        targetKey: 'code',
        as: 'film',
      });

      Session.belongsTo(models.Cinema, {
        foreignKey: 'cinemaCode',
        targetKey: 'code',
        as: 'cinema',
      });
    }
  }

  Session.init(
    {
      // The cinema's code. Half of the primary key, and the foreign key into
      // cinemas.code.
      cinemaCode: {
        type: DataTypes.STRING(10),
        primaryKey: true,
        allowNull: false,
        field: 'Code',
      },
      // The source system's session identifier. The other half of the key.
      sessionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        field: 'Session_lngSessionId',
      },
      filmCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'Film_strCode',
      },
      // Auditorium as the source system names it. Not screens.id.
      screenNumber: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'Screen_bytNum',
      },
      screenName: {
        type: DataTypes.STRING(25),
        allowNull: true,
        field: 'Screen_strName',
      },
      /**
       * Cinema-local (IST) wall clock, as the source system records it.
       *
       * No getter: the connection sets `useUTC: false` (see config/config.js),
       * so tedious already parses these offset-less `datetime` values as
       * process-local, and the process is pinned to IST by APP_TIMEZONE. An
       * earlier version corrected the value here because the connection then
       * parsed it as UTC; with that fixed at the driver, the correction would
       * be a second conversion.
       */
      startsAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'Session_dtmRealShow',
      },
      endsAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'Session_dtmFinishShow',
      },
      seatsAvailable: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'Session_intSeatsAvail',
      },
      seatsTotal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'Session_intSeatsTotal',
      },
      // Provider lifecycle flag, left as the raw value for the same reason as
      // Film.status.
      status: {
        type: DataTypes.STRING(1),
        allowNull: false,
        field: 'Session_strStatus',
      },
    },
    {
      sequelize,
      modelName: 'Session',
      tableName: 'session',
      timestamps: false,
    }
  );

  return Session;
};
