'use strict';

/**
 * Banners.
 *
 * One row carries one image, so a cinema shows several banners by holding
 * several rows; `sequence` decides the order they appear in and is unique
 * within a cinema.
 *
 * A banner has no chain_id of its own, so tenant scope is applied through its
 * cinema exactly as it is for screens. An out-of-scope id is reported as 404.
 *
 * `cinema_id` is fixed at creation: moving a banner would sidestep the target
 * cinema's sequence rule.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'imageUrl',
  'type',
  'sequence',
  'startDate',
  'endDate',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializeBanner(banner) {
  if (!banner) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = banner[attribute];
  }

  return result;
}

/** Join to the owning cinema, filtered to the actor's chain. */
function cinemaScope(actor) {
  return {
    association: 'cinema',
    attributes: ['id', 'chainId'],
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

/**
 * Resolve the cinema a banner is being created for.
 *
 * Scoped, so a cinema in another chain is a 404 and not a 403. A deactivated
 * cinema is a 409: it exists and is visible to the actor, and the request
 * conflicts with its current state. Create only - deactivating a cinema leaves
 * its existing banners alone, matching how screens behave.
 *
 * @throws {NotFoundError} 404 when the cinema does not exist or is out of scope.
 * @throws {ConflictError} 409 when the cinema is deactivated.
 */
async function findCinemaInScope(actor, cinemaId) {
  const where = { id: cinemaId };
  if (actor.role !== ROLES.OWNER) where.chainId = actor.chainId;

  const cinema = await models.Cinema.findOne({
    where,
    attributes: ['id', 'chainId', 'isActive'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  if (!cinema.isActive) {
    throw new ConflictError('Cannot add a banner to a deactivated cinema', {
      cinemaId: cinema.id,
    });
  }

  return cinema;
}

/**
 * `sequence` is unique within a cinema, so the display order is never
 * ambiguous.
 *
 * Enforced here rather than by the database: the frozen schema carries no
 * unique index on (cinema_id, sequence). See category.service for the race this
 * leaves and why it is acceptable.
 *
 * Deactivated banners are counted, so a sequence freed by a soft delete stays
 * reserved - reactivating the old banner must not produce two rows fighting for
 * the same slot.
 *
 * @throws {ConflictError} 409 when the sequence is taken in that cinema.
 */
async function assertSequenceAvailable(cinemaId, sequence, excludeId) {
  const where = { cinemaId, sequence };
  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const existing = await models.Banner.findOne({ where, attributes: ['id'] });

  if (existing) {
    throw new ConflictError('A banner with this sequence already exists in this cinema', {
      cinemaId,
      sequence,
    });
  }
}

/**
 * endDate may not fall before startDate.
 *
 * The request schema already compares the two when both are in the same body.
 * This covers the case it cannot see: a partial update that supplies only one
 * of them, which has to be compared against the stored value of the other.
 *
 * @throws {ValidationError} 400 when the resulting window runs backwards.
 */
function assertDateOrder(startDate, endDate) {
  if (!startDate || !endDate) return;

  if (new Date(endDate) < new Date(startDate)) {
    throw new ValidationError('Banner end date cannot be earlier than its start date', [
      { field: 'endDate', message: "'endDate' cannot be earlier than 'startDate'" },
    ]);
  }
}

/**
 * Load a banner for modification, with the tenant join applied.
 */
async function findForUpdate(actor, bannerId) {
  const banner = await models.Banner.findOne({
    where: { id: bannerId },
    include: [cinemaScope(actor)],
  });

  if (!banner) throw new NotFoundError('Banner');

  return banner;
}

/**
 * Paginated, filtered banner list.
 *
 * Defaults to `sequence` order, which is the order they are displayed in.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{banners: object[], total: number}>}
 */
async function listBanners(actor, { page, limit, sort, order, cinemaId, type, isActive }) {
  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (type) where.type = type;
  if (isActive !== undefined) where.isActive = isActive;

  const { rows, count } = await models.Banner.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { banners: rows.map(serializeBanner), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or its cinema is outside
 *   the actor's chain.
 */
async function getBanner(actor, bannerId) {
  const banner = await models.Banner.findOne({
    where: { id: bannerId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
  });

  if (!banner) throw new NotFoundError('Banner');

  return serializeBanner(banner);
}

async function createBanner(actor, payload) {
  const { cinemaId, ...attributes } = payload;

  await findCinemaInScope(actor, cinemaId);
  await assertSequenceAvailable(cinemaId, attributes.sequence);

  const banner = await models.Banner.create({
    ...attributes,
    cinemaId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeBanner(banner);
}

async function updateBanner(actor, bannerId, payload) {
  const banner = await findForUpdate(actor, bannerId);

  if (payload.sequence !== undefined && payload.sequence !== banner.sequence) {
    await assertSequenceAvailable(banner.cinemaId, payload.sequence, banner.id);
  }

  // Merged with what is stored, so supplying only one end of the window is
  // still checked against the other.
  assertDateOrder(
    payload.startDate !== undefined ? payload.startDate : banner.startDate,
    payload.endDate !== undefined ? payload.endDate : banner.endDate
  );

  await banner.update({ ...payload, updatedBy: actor.id });

  return serializeBanner(banner);
}

/**
 * Soft delete: is_active becomes 0. The row stays, so its sequence stays
 * reserved and the banner can be brought back.
 *
 * Idempotent.
 */
async function deactivateBanner(actor, bannerId) {
  const banner = await findForUpdate(actor, bannerId);

  if (banner.isActive) {
    await banner.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeBanner(banner);
}

module.exports = {
  listBanners,
  getBanner,
  createBanner,
  updateBanner,
  deactivateBanner,
  serializeBanner,
  PUBLIC_ATTRIBUTES,
};
