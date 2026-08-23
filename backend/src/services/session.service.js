'use strict';

/**
 * Sessions - the client's screening schedule.
 *
 * Reads the client's `session` table. As with `film`, the table belongs to the
 * source system and is not modified here; this service presents the columns
 * QBusto needs under QBusto's own names.
 *
 * READ-ONLY, deliberately, for the same reason as film.service: the schedule
 * is synced from the source system, so a write made here would not survive it.
 *
 * TENANT SCOPE
 *
 * A session carries the cinema's `code`, not `cinemas.id`, so scope is applied
 * by resolving the actor's chain to the set of cinema codes it may see. That is
 * chain-level, matching order.service and every other Dashboard surface.
 *
 * SCREENS
 *
 * The source system names the auditorium (`screenName`) rather than
 * referencing `screens.id`. No attempt is made to resolve one to the other
 * here: `screens` currently holds several rows per auditorium, so the mapping
 * is ambiguous and guessing it would put a wrong id on an order. The name is
 * returned as the source system supplies it.
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
  'screenNumber',
  'screenName',
  'startsAt',
  'endsAt',
  'seatsTotal',
  'seatsAvailable',
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

  result.filmTitle = session.film ? session.film.title : null;
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

/** Film title for display. Not required: a session may name an unknown film. */
const FILM_INCLUDE = {
  association: 'film',
  attributes: ['code', 'title'],
  required: false,
};

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
    include: [cinemaScope(actor), FILM_INCLUDE],
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
 * part of the lookup. It is resolved from the caller's scope.
 *
 * @throws {NotFoundError} When it does not exist, or its cinema is outside the
 *   actor's chain.
 */
async function getSession(actor, sessionId) {
  const session = await models.Session.findOne({
    where: { sessionId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor), FILM_INCLUDE],
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
