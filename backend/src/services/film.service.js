'use strict';

/**
 * Films.
 *
 * Reads the client's `film` table. The table is the source system's and is not
 * modified here - this service only presents the columns QBusto needs under
 * QBusto's own names, which the model's field mappings supply.
 *
 * READ-ONLY, deliberately.
 *
 * The source system owns this catalogue and syncs it. Creating, editing or
 * deactivating a film from the Dashboard would write into a table the client's
 * sync will overwrite, and the table carries no is_active flag of ours to
 * deactivate with - only the provider's own `Film_strStatus`. Until the client
 * says otherwise, exposing writes here would be offering an action that does
 * not survive the next sync.
 *
 * The primary key is `code`, a varchar the source system assigns, not an
 * integer of ours.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError } = require('../utils/errors');

const PUBLIC_ATTRIBUTES = [
  'code',
  'title',
  'certification',
  'durationMinutes',
  'imageUrl',
  'status',
  'nowShowingFlag',
  'openingDate',
];

function serializeFilm(film) {
  if (!film) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = film[attribute];
  }

  return result;
}

/**
 * Paginated, searchable film list.
 *
 * Defaults to title order, which is how staff look for one.
 *
 * @param {object} _actor Unused: the film catalogue is not tenant-scoped.
 *   Accepted so the signature matches every other service.
 * @param {object} query Validated query params.
 * @returns {Promise<{films: object[], total: number}>}
 */
async function listFilms(_actor, { page, limit, sort, order, search, nowShowingFlag }) {
  const where = {};

  if (search) where.title = { [Op.like]: `%${search}%` };
  /**
   * Exact match on the provider's raw flag, not an interpretation of it.
   *
   * The client's data contains only 'N' across all 69 rows - no 'Y' has ever
   * been observed - so there is no basis in the data (or in any client
   * documentation) for treating 'Y' as "now showing" and anything else as not.
   * A prior version of this filter assumed that vocabulary and consequently
   * matched zero rows. Until the client defines the flag's values, the caller
   * gets an exact match on whatever value they pass and nothing is guessed.
   */
  if (nowShowingFlag !== undefined) where.nowShowingFlag = nowShowingFlag;

  const { rows, count } = await models.Film.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { films: rows.map(serializeFilm), total: count };
}

/**
 * @param {string} filmCode The source system's film code.
 * @throws {NotFoundError} When the code does not exist.
 */
async function getFilm(_actor, filmCode) {
  const film = await models.Film.findByPk(filmCode, { attributes: PUBLIC_ATTRIBUTES });

  if (!film) throw new NotFoundError('Film');

  return serializeFilm(film);
}

module.exports = {
  listFilms,
  getFilm,
  serializeFilm,
  PUBLIC_ATTRIBUTES,
};
