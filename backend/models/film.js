'use strict';

const { Model } = require('sequelize');

/**
 * A film, as the client's database holds it.
 *
 * This maps the client's `film` table (renamed from `Film` for naming
 * consistency in 20260823001000). The table itself is untouched: its columns
 * are the source system's, and they keep their names because the client syncs
 * against them.
 *
 * What this model does is give the application its own vocabulary for those
 * columns - `code`, `title`, `certification` - so services and API responses
 * read normally without the provider's `Film_str…` prefixes leaking upwards.
 * Only the columns QBusto actually needs are declared; the other 30-odd
 * columns stay in the table, unread.
 *
 * The primary key is `Film_strCode`, a varchar the source system assigns. It
 * is NOT an integer id of ours, and there is deliberately no second `films`
 * table: this is the one canonical film table.
 *
 * `timestamps` is off because the table has no created_at/updated_at pair -
 * the source system tracks its own `Film_dtmStamp` instead.
 */
module.exports = (sequelize, DataTypes) => {
  class Film extends Model {
    static associate(models) {
      Film.hasMany(models.Session, {
        foreignKey: 'filmCode',
        sourceKey: 'code',
        as: 'sessions',
      });
    }
  }

  Film.init(
    {
      code: {
        type: DataTypes.STRING(20),
        primaryKey: true,
        allowNull: false,
        field: 'Film_strCode',
      },
      title: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'Film_strTitle',
      },
      // Censor rating as displayed, e.g. "UA".
      certification: {
        type: DataTypes.STRING(10),
        allowNull: true,
        field: 'Film_strCensor',
      },
      durationMinutes: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        field: 'Film_intDuration',
      },
      // Poster art supplied by the source system.
      imageUrl: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'Film_strURLforGraphic',
      },
      /**
       * Provider lifecycle flag rather than a boolean of ours. Left as the raw
       * value: the source system owns its vocabulary, and guessing which codes
       * mean "active" would be inventing a rule the client has not stated.
       */
      status: {
        type: DataTypes.STRING(1),
        allowNull: true,
        field: 'Film_strStatus',
      },
      nowShowingFlag: {
        type: DataTypes.STRING(1),
        allowNull: true,
        field: 'Film_strNowShowingFlag',
      },
      openingDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'Film_dtmOpeningDate',
      },
    },
    {
      sequelize,
      modelName: 'Film',
      tableName: 'film',
      timestamps: false,
    }
  );

  return Film;
};
