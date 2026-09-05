'use strict';

/**
 * Sessions - the screening schedule, and the platform's only source of show
 * data.
 *
 * Reads the `session` table. The table's shape is the client's and its column
 * names are the source system's; this service presents them under QBusto's
 * own vocabulary, which the model's field mappings supply.
 *
 * READ-ONLY, deliberately. The schedule is synchronized from the POS (see
 * services/showSync.service.js), so a write made from the Dashboard would not
 * survive the next sync.
 *
 * NO FILM JOIN. The title is a column on the session row now; there is no
 * `film` table to join to and nothing to be `required: true` about, which
 * means a screening can no longer be dropped from a listing because its film
 * row happened to be missing.
 *
 * TENANT SCOPE
 *
 * A session carries the cinema's `code`, not `cinemas.id`, so scope is applied
 * by joining to the cinema and filtering on its chain. That is chain-level,
 * matching order.service and every other Dashboard surface.
 *
 * SCREENS
 *
 * The source system names the auditorium (`screenName`) rather than
 * referencing `screens.id`. No attempt is made to resolve one to the other
 * here: `screens` holds several rows per auditorium for some cinemas, so the
 * mapping needs the customer's seat row as well - see
 * consumer.service.resolveScreenId. The name is returned as supplied.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError } = require('../utils/errors');
const { ROLES } = require('../constants');
const { sqlDateTimeLiteral } = require('../utils/sqlDate');

const PUBLIC_ATTRIBUTES = [
  'cinemaCode',
  'sessionId',
  'filmCode',
  'filmTitle',
  'screenNumber',
  'screenName',
  'startsAt',
  'endsAt',
  'status',
];

/**
 * The list is read as a schedule, so each row carries the names it is read by.
 * Without them the table is codes.
 */
function serializeSession(session) {
  if (!session) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = session[attribute];
  }

  result.cinemaName = session.cinema ? session.cinema.name : null;
  result.cinemaId = session.cinema ? session.cinema.id : null;

  return result;
}

/** Join to the owning cinema, filtered to the actor's chain. */
function cinemaScope(actor) {
  return {
    association: 'cinema',
    attributes: ['id', 'code', 'chainId', 'name'],
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

/**
 * Resolve a cinema id filter to the code the session table stores.
 *
 * @throws {NotFoundError} When the cinema does not exist or is out of scope.
 */
async function cinemaCodeFor(actor, cinemaId) {
  const where = { id: cinemaId };
  if (actor.role !== ROLES.OWNER) where.chainId = actor.chainId;

  const cinema = await models.Cinema.findOne({ where, attributes: ['code'] });

  if (!cinema) throw new NotFoundError('Cinema');

  return cinema.code;
}

/**
 * Paginated, filtered session list.
 *
 * Defaults to `startsAt` order, which is how a schedule is read.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{sessions: object[], total: number}>}
 */
async function listSessions(actor, { page, limit, sort, order, cinemaId, filmCode, from, to }) {
  const where = {};

  if (cinemaId) where.cinemaCode = await cinemaCodeFor(actor, cinemaId);
  if (filmCode) where.filmCode = filmCode;

  if (from || to) {
    // Formatted, because the source system's column is `datetime`.
    where.startsAt = {};
    if (from) where.startsAt[Op.gte] = sqlDateTimeLiteral(new Date(from));
    if (to) where.startsAt[Op.lte] = sqlDateTimeLiteral(new Date(to));
  }

  const { rows, count } = await models.Session.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return { sessions: rows.map(serializeSession), total: count };
}

/**
 * One session, addressed by the source system's session id.
 *
 * `sessionId` is unique per cinema rather than globally, so the cinema code is
 * part of the key. It is resolved from the caller's scope.
 *
 * @throws {NotFoundError} When it does not exist, or its cinema is outside the
 *   actor's chain.
 */
async function getSession(actor, sessionId) {
  const session = await models.Session.findOne({
    where: { sessionId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
  });

  if (!session) throw new NotFoundError('Session');

  return serializeSession(session);
}

module.exports = {
  listSessions,
  getSession,
  serializeSession,
  PUBLIC_ATTRIBUTES,
};
