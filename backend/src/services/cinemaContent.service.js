'use strict';

/**
 * A cinema's "About Cinema" / "Terms & Conditions" footer content.
 *
 * ONE ROW PER CINEMA, OPTIONAL
 *
 * Most cinemas will have none until a staff user fills it in from the
 * Dashboard - `getContent` returns an empty shape rather than 404ing, since
 * "nothing configured yet" is a normal state, not a missing resource. Tenancy
 * still applies: the CINEMA must be in the actor's scope, whether or not a
 * content row exists for it yet.
 *
 * `tncPoints` IS JSON-ENCODED IN THE DATABASE
 *
 * See the migration's header note for why. This module is the only place
 * that knows the column holds `JSON.stringify(string[])` - `serialize()`
 * parses it out on the way to a caller, `toColumnValue()` re-encodes it on
 * the way in. A row written before this existed, or corrupted by hand, comes
 * back as `[]` rather than throwing.
 */

const { models } = require('../config/database');
const { NotFoundError } = require('../utils/errors');
const { ROLES } = require('../constants');
const cache = require('./cache.service');

/** Extra `where` clause confining non-owners to their own chain - see cinema.service. */
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}

function parseTncPoints(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((point) => typeof point === 'string') : [];
  } catch {
    return [];
  }
}

function serialize(content) {
  if (!content) {
    return { cinemaId: null, contactNo: null, mailId: null, tncPoints: [], iconUrl: null };
  }

  return {
    cinemaId: content.cinemaId,
    contactNo: content.contactNo,
    mailId: content.mailId,
    tncPoints: parseTncPoints(content.tncPoints),
    iconUrl: content.iconUrl ?? null,
  };
}

/**
 * @throws {NotFoundError} When the cinema does not exist, or is outside the
 *   actor's chain.
 */
async function findCinemaInScope(actor, cinemaId) {
  const cinema = await models.Cinema.findOne({
    where: { id: cinemaId, ...tenantScope(actor) },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  return cinema;
}

/** Dashboard: staff-facing read, tenant-scoped, 404 when the cinema is out of scope. */
async function getContent(actor, cinemaId) {
  await findCinemaInScope(actor, cinemaId);

  const content = await models.CinemaContent.findOne({ where: { cinemaId } });

  return { ...serialize(content), cinemaId };
}

/**
 * Creates the row on first save, updates it thereafter - the Dashboard never
 * has to know which case it is in.
 */
async function upsertContent(actor, cinemaId, payload) {
  await findCinemaInScope(actor, cinemaId);

  const attributes = {
    contactNo: payload.contactNo ?? null,
    mailId: payload.mailId ?? null,
    tncPoints: JSON.stringify(payload.tncPoints ?? []),
    iconUrl: payload.iconUrl ?? null,
    updatedBy: actor.id,
  };

  const existing = await models.CinemaContent.findOne({ where: { cinemaId } });

  const content = existing
    ? await existing.update(attributes)
    : await models.CinemaContent.create({ ...attributes, cinemaId, createdBy: actor.id });

  return { ...serialize(content), cinemaId };
}

/**
 * Consumer: public, unauthenticated read for an ACTIVE cinema only - mirrors
 * consumer.service.getCinema's own `isActive: true` filter. No row yet is not
 * an error; the footer simply has nothing to show.
 */
async function getPublicContent(cinemaId) {
  const cinema = await models.Cinema.findOne({
    where: { id: cinemaId, isActive: true },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const content = await models.CinemaContent.findOne({ where: { cinemaId } });

  return serialize(content);
}

module.exports = {
  getContent,
  upsertContent: cache.invalidatingAfter(upsertContent),
  getPublicContent,
  parseTncPoints,
};
