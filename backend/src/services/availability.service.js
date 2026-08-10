'use strict';

/**
 * Product availability hours.
 *
 * The parent is a cinema_product, not a product: a window says "this product is
 * orderable at this cinema between these times", so the same product can be
 * available at different hours in different cinemas.
 *
 * That puts the tenant boundary two joins away - hour -> cinema_product ->
 * cinema.chain_id - so every query carries a nested inner join rather than a
 * plain where clause. A row whose cinema is in another chain drops out of the
 * result set and is reported as 404.
 *
 * Deletion is hard. product_availability_hours has no is_active column, so
 * there is nothing to soft delete; removing a window is how a window is
 * withdrawn.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaProductId',
  'dayOfWeek',
  'startTime',
  'endTime',
  'createdAt',
  'updatedAt',
];

/** 0 means "every day" rather than a day of its own. */
const EVERY_DAY = 0;

/** Columns that hold a time of day and need formatting on the way out. */
const TIME_ATTRIBUTES = ['startTime', 'endTime'];

/**
 * Render a TIME column as 'HH:MM:SS'.
 *
 * The driver hands back a TIME as a Date pinned to 1970-01-01 with the time in
 * UTC, so serialising it untouched would emit '1970-01-01T09:00:00.000Z' - a
 * value this module's own validator rejects, leaving a client unable to send
 * back what it just read. UTC accessors are the right ones precisely because
 * the date half is a placeholder, not a real instant.
 *
 * Passes strings through unchanged, so a value that arrives already formatted
 * is left alone.
 */
function formatTime(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;

  const pad = (part) => String(part).padStart(2, '0');

  return [pad(value.getUTCHours()), pad(value.getUTCMinutes()), pad(value.getUTCSeconds())].join(
    ':'
  );
}

function serializeAvailabilityHour(hour) {
  if (!hour) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = TIME_ATTRIBUTES.includes(attribute)
      ? formatTime(hour[attribute])
      : hour[attribute];
  }

  return result;
}

/**
 * Join to the owning cinema_product and on to its cinema, filtered to the
 * actor's chain.
 *
 * `required: true` on both levels makes them inner joins, so an hour belonging
 * to another chain's cinema disappears from the result set rather than coming
 * back with a null parent. Owners get the same shape with no filter.
 */
function cinemaProductScope(actor) {
  return {
    association: 'cinemaProduct',
    attributes: ['id', 'cinemaId', 'productId'],
    required: true,
    include: [
      {
        association: 'cinema',
        attributes: ['id', 'chainId'],
        required: true,
        where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
      },
    ],
  };
}

/**
 * Resolve the cinema_product a window is being attached to.
 *
 * Scoped through the cinema, so one in another chain is a 404 and not a 403.
 *
 * @throws {NotFoundError} 404 when it does not exist or is out of scope.
 */
async function findCinemaProductInScope(actor, cinemaProductId) {
  const cinemaProduct = await models.CinemaProduct.findOne({
    where: { id: cinemaProductId },
    attributes: ['id', 'cinemaId', 'productId'],
    include: [
      {
        association: 'cinema',
        attributes: ['id', 'chainId'],
        required: true,
        where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
      },
    ],
  });

  if (!cinemaProduct) throw new NotFoundError('Cinema product');

  return cinemaProduct;
}

/**
 * Two windows for the same cinema_product may not overlap in time.
 *
 * `dayOfWeek` 0 means every day, so it is not just compared for equality: a
 * window on day 0 is checked against every day, and a window on a specific day
 * is checked against that day *and* day 0. Without this an "all days" window
 * and a Monday window could silently cover the same hour.
 *
 * Times are TIME columns compared against normalised 'HH:MM:SS' strings. Two
 * ranges overlap when each starts before the other ends; touching ranges
 * (09:00-12:00 and 12:00-15:00) do not overlap, which is why the comparisons
 * are strict.
 *
 * @throws {ConflictError} 409 naming the window that clashes.
 */
async function assertNoOverlap(cinemaProductId, { dayOfWeek, startTime, endTime }, excludeId) {
  const where = {
    cinemaProductId,
    startTime: { [Op.lt]: endTime },
    endTime: { [Op.gt]: startTime },
  };

  // An every-day window is checked against every existing day, so no day filter
  // is applied at all in that case.
  if (dayOfWeek !== EVERY_DAY) {
    where.dayOfWeek = { [Op.in]: [EVERY_DAY, dayOfWeek] };
  }

  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const clash = await models.ProductAvailabilityHour.findOne({
    where,
    attributes: ['id', 'dayOfWeek', 'startTime', 'endTime'],
  });

  if (clash) {
    throw new ConflictError('This availability window overlaps an existing one', {
      conflictingId: clash.id,
      dayOfWeek: clash.dayOfWeek,
      startTime: formatTime(clash.startTime),
      endTime: formatTime(clash.endTime),
    });
  }
}

/**
 * Load a window for modification, with the tenant join applied.
 */
async function findForUpdate(actor, hourId) {
  const hour = await models.ProductAvailabilityHour.findOne({
    where: { id: hourId },
    include: [cinemaProductScope(actor)],
  });

  if (!hour) throw new NotFoundError('Availability hour');

  return hour;
}

/**
 * Paginated, filtered availability list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{availabilityHours: object[], total: number}>}
 */
async function listAvailabilityHours(
  actor,
  { page, limit, sort, order, cinemaProductId, dayOfWeek }
) {
  const where = {};

  if (cinemaProductId) where.cinemaProductId = cinemaProductId;
  if (dayOfWeek !== undefined) where.dayOfWeek = dayOfWeek;

  const { rows, count } = await models.ProductAvailabilityHour.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    // Carries the tenant filter. A cinemaProductId from another chain narrows an
    // already-scoped set to nothing rather than escaping it.
    include: [cinemaProductScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { availabilityHours: rows.map(serializeAvailabilityHour), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or its cinema is outside
 *   the actor's chain.
 */
async function getAvailabilityHour(actor, hourId) {
  const hour = await models.ProductAvailabilityHour.findOne({
    where: { id: hourId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaProductScope(actor)],
  });

  if (!hour) throw new NotFoundError('Availability hour');

  return serializeAvailabilityHour(hour);
}

async function createAvailabilityHour(actor, payload) {
  const { cinemaProductId, ...attributes } = payload;

  await findCinemaProductInScope(actor, cinemaProductId);
  await assertNoOverlap(cinemaProductId, attributes);

  const hour = await models.ProductAvailabilityHour.create({
    ...attributes,
    cinemaProductId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeAvailabilityHour(hour);
}

async function updateAvailabilityHour(actor, hourId, payload) {
  const hour = await findForUpdate(actor, hourId);

  // The whole range is always supplied, so it can be checked as a unit against
  // every sibling window except this one.
  await assertNoOverlap(hour.cinemaProductId, payload, hour.id);

  await hour.update({ ...payload, updatedBy: actor.id });

  return serializeAvailabilityHour(hour);
}

/**
 * Hard delete. There is no is_active column on product_availability_hours, and
 * nothing references a window, so the row is removed outright.
 */
async function deleteAvailabilityHour(actor, hourId) {
  const hour = await findForUpdate(actor, hourId);
  const deleted = serializeAvailabilityHour(hour);

  await hour.destroy();

  return deleted;
}

module.exports = {
  listAvailabilityHours,
  getAvailabilityHour,
  createAvailabilityHour,
  updateAvailabilityHour,
  deleteAvailabilityHour,
  serializeAvailabilityHour,
  PUBLIC_ATTRIBUTES,
};
