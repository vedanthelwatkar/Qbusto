'use strict';

/**
 * Product pricing.
 *
 * A price row ties a cinema to a product, and the database does not check that
 * the two belong to the same chain. For a non-owner both lookups are scoped to
 * their own chain, so a mismatch cannot arise; an owner is scoped to nothing,
 * so the two chains are compared explicitly. This mirrors the guard the
 * cinema_products and cinema_categories model hooks apply for the same gap.
 *
 * (cinema_id, product_id, day_of_week) is unique - UQ_product_pricing - so a
 * duplicate is left to the database and surfaces as a 409. Those three columns
 * are therefore fixed at creation: changing one identifies a different row, not
 * an edit of this one.
 *
 * The rule that a discount amount is meaningless without a discountType lives
 * in the frozen ProductPricing beforeSave hook and is deliberately not repeated
 * here. It raises ValidationError, which reaches the client as a 400.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 */

const { models } = require('../config/database');
const { NotFoundError, ConflictError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'productId',
  'dayOfWeek',
  'basePrice',
  'discountType',
  'discountValue',
  'discountOnQr',
  'discountOnKiosk',
  'discountOnSeatQr',
  'discountOnCounter',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializePricing(pricing) {
  if (!pricing) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = pricing[attribute];
  }

  return result;
}

/**
 * Join to the owning cinema, filtered to the actor's chain.
 *
 * product_pricing has no chain_id of its own, so scope is applied through the
 * cinema exactly as it is for screens and banners.
 */
function cinemaScope(actor) {
  return {
    association: 'cinema',
    attributes: ['id', 'chainId'],
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

/**
 * Resolve the cinema and product a price is being written for, and confirm they
 * belong to the same chain.
 *
 * @throws {NotFoundError} 404 when either does not exist or is out of scope.
 * @throws {ConflictError} 409 when the two sit in different chains.
 */
async function assertCinemaAndProductAgree(actor, cinemaId, productId) {
  const scope = actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };

  const [cinema, product] = await Promise.all([
    models.Cinema.findOne({ where: { id: cinemaId, ...scope }, attributes: ['id', 'chainId'] }),
    models.Product.findOne({ where: { id: productId, ...scope }, attributes: ['id', 'chainId'] }),
  ]);

  if (!cinema) throw new NotFoundError('Cinema');
  if (!product) throw new NotFoundError('Product');

  if (cinema.chainId !== product.chainId) {
    throw new ConflictError('The cinema and product belong to different chains', {
      cinemaId: cinema.id,
      cinemaChainId: cinema.chainId,
      productId: product.id,
      productChainId: product.chainId,
    });
  }
}

/**
 * Load a price row for modification, with the tenant join applied.
 */
async function findForUpdate(actor, pricingId) {
  const pricing = await models.ProductPricing.findOne({
    where: { id: pricingId },
    include: [cinemaScope(actor)],
  });

  if (!pricing) throw new NotFoundError('Product pricing');

  return pricing;
}

/**
 * Paginated, filtered pricing list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{pricings: object[], total: number}>}
 */
async function listPricings(
  actor,
  { page, limit, sort, order, cinemaId, productId, dayOfWeek, isActive }
) {
  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (productId) where.productId = productId;
  if (dayOfWeek !== undefined) where.dayOfWeek = dayOfWeek;
  if (isActive !== undefined) where.isActive = isActive;

  const { rows, count } = await models.ProductPricing.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    // Carries the tenant filter; a cinemaId from another chain narrows an
    // already-scoped set rather than escaping it.
    include: [cinemaScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { pricings: rows.map(serializePricing), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or its cinema is outside
 *   the actor's chain.
 */
async function getPricing(actor, pricingId) {
  const pricing = await models.ProductPricing.findOne({
    where: { id: pricingId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
  });

  if (!pricing) throw new NotFoundError('Product pricing');

  return serializePricing(pricing);
}

/**
 * A duplicate (cinema, product, day) is left to UQ_product_pricing, which the
 * error handler turns into a 409 - checking first would only add a query and
 * still lose a race.
 */
async function createPricing(actor, payload) {
  const { cinemaId, productId, ...attributes } = payload;

  await assertCinemaAndProductAgree(actor, cinemaId, productId);

  const pricing = await models.ProductPricing.create({
    ...attributes,
    cinemaId,
    productId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializePricing(pricing);
}

async function updatePricing(actor, pricingId, payload) {
  const pricing = await findForUpdate(actor, pricingId);

  // The beforeSave hook reads the whole instance, so clearing discountType
  // while leaving an amount behind is caught here as a 400, not silently saved.
  await pricing.update({ ...payload, updatedBy: actor.id });

  return serializePricing(pricing);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - historical
 * orders are priced from it.
 *
 * Idempotent.
 */
async function deactivatePricing(actor, pricingId) {
  const pricing = await findForUpdate(actor, pricingId);

  if (pricing.isActive) {
    await pricing.update({ isActive: false, updatedBy: actor.id });
  }

  return serializePricing(pricing);
}

module.exports = {
  listPricings,
  getPricing,
  createPricing,
  updatePricing,
  deactivatePricing,
  serializePricing,
  PUBLIC_ATTRIBUTES,
};
