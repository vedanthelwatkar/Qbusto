'use strict';

const { Model } = require('sequelize');

/**
 * One screening. THE source of show data for the whole platform.
 *
 * There is no `film` table any more, and no `shows` table either. Everything
 * the application knows about what is playing - which film, which auditorium,
 * when it starts, when it ends, whether it is selling - is on this row. A POS
 * adapter normalizes a provider's schedule into these ten columns and nothing
 * downstream ever speaks the provider's vocabulary again.
 *
 * WHY THE TITLE IS A COLUMN RATHER THAN A JOIN
 *
 * `Film_strName` used to live in a separate `film` table reached by
 * `Film_strCode`. That join bought one string and cost a table, a foreign key
 * and a `required: true` include that silently DROPPED any screening whose
 * film row was missing. The title is now denormalized onto the session, which
 * is also the only shape a POS feed can populate without a second sync.
 *
 * `Film_strCode` is kept - it is the provider's identifier for the film and is
 * what a POS reconciliation matches on - but nothing resolves it to a row any
 * more.
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
 * by `Screen_bytNum` and `Screen_strName`, so resolving a session to a QBusto
 * screen is a name lookup, not a join - see `consumer.service.resolveScreenId`
 * and the screens grain conflict in .claude/rules/client-tables.md. Both
 * columns are exposed as-is.
 *
 * TIME
 *
 * `startsAt`/`endsAt` are cinema-local (IST) wall clock, as the source system
 * records them. No getters: the connection sets `useUTC: false` (see
 * config/config.js), so tedious already parses these offset-less `datetime`
 * values as process-local, and the process is pinned to IST by APP_TIMEZONE.
 * A getter here would be a second conversion.
 *
 * `timestamps` is off: the table has no created_at/updated_at pair, only the
 * source system's own `Session_dtmStamp`.
 */
module.exports = (sequelize, DataTypes) => {
  class Session extends Model {
    static associate(models) {
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
      /**
       * The title a customer reads. Nullable because a provider feed may not
       * carry one; every caller must cope with null rather than assume a
       * string.
       */
      filmTitle: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'Film_strName',
      },
      // The provider's film identifier. Kept for POS reconciliation; it no
      // longer resolves to a row anywhere.
      filmCode: {
        type: DataTypes.STRING(20),
        allowNull: false,
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
      /**
       * Provider lifecycle flag, left as the raw value.
       *
       * The client defines O = Open, C = Closed, I = Inactive, and only Open
       * is offered to a customer (see SESSION_STATUS_OPEN in
       * consumer.service). The live data also contains 'Y', which the client
       * has not defined; it is not interpreted here, and because it is not
       * 'O' it is never offered. See docs/schema-explained.md.
       */
      status: {
        type: DataTypes.STRING(1),
        allowNull: false,
        field: 'Session_strStatus',
      },
      // The source system's own row stamp. Not a QBusto audit column.
      stampedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'Session_dtmStamp',
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
