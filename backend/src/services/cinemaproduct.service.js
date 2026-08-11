'use strict';

/**
 * Cinema products - the link that says a product is carried at a cinema.
 *
 * This is the parent of product_availability_hours, so it is what makes a
 * window addressable: a client resolves (cinemaId, productId) -> id here and
 * then hangs availability off that id.
 *
 * The legacy system kept this link and its pricing in one table
 * (DAE_ItemCinemaPrice). QBusto splits them: the link, its display order and
 * its date-range availability live here, while per-day prices are normalised
 * into product_pricing. That is why this row carries no price columns.
 *
 * A link ties a cinema to a product, and the database does not check that the
 * two belong to the same chain. For a non-owner both lookups are scoped to
 * their own chain, so a mismatch cannot arise; an owner is scoped to nothing, so
 * the two chains are compared explicitly. The CinemaProduct beforeSave hook
 * enforces the same rule at the model layer and is deliberately left in place -
 * this check produces the better error, the hook is the backstop for any write
 * that does not pass through here.
 *
 * (cinema_id, product_id) is unique - UQ_cinema_products - so a duplicate is
 * left to the database and surfaces as a 409. Those two columns are therefore
 * fixed at creation.
 *
 * Deletion is soft: is_active is set to 0 and the row stays. Deactivating a
 * link does not touch its availability hours - the windows remain readable and
 * editable, matching the chain/cinema lifecycle rule elsewhere in the schema.
 *
 * No transactions: every operation here is a single-row write.
 */

const { models } = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'productId',
  'sequence',
  'availableFrom',
  'availableUntil',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializeCinemaProduct(cinemaProduct) {
  if (!cinemaProduct) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = cinemaProduct[attribute];
  }

  return result;
}

/**
 * Join to the owning cinema, filtered to the actor's chain.
 *
 * cinema_products has no chain_id of its own, so scope is applied through the
 * cinema exactly as it is for screens, banners and pricing.
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
 * A date range that ends before it starts describes a product that is never
 * available, which is silently broken rather than obviously wrong.
 *
 * The legacy table had no `FromDate` at all - only `ToDate` - so it cannot
 * answer this, and the frozen schema carries no CHECK. Equal bounds are
 * rejected too: an empty instant is the same defect written differently.
 *
 * Applied to the *effective* range so a partial update that moves one bound
 * past the other stored one is caught.
 *
 * @throws {ValidationError} 400 naming `availableUntil`.
 */
function assertDateRange(availableFrom, availableUntil) {
  if (!availableFrom || !availableUntil) return;

  if (new Date(availableUntil) <= new Date(availableFrom)) {
    throw new ValidationError('Validation failed', [
      { field: 'availableUntil', message: "'availableUntil' must be later than 'availableFrom'" },
    ]);
  }
}

/**
 * Resolve the cinema and product a link is being created for, and confirm they
 * belong to the same chain and are both live.
 *
 * A deactivated parent rejects a new child, matching the rule screens apply to
 * a deactivated cinema. Existing links under a parent that is later deactivated
 * are left alone.
 *
 * @throws {NotFoundError} 404 when either does not exist or is out of scope.
 * @throws {ConflictError} 409 when the two sit in different chains, or either
 *   one is deactivated.
 */
async function assertCinemaAndProductAgree(actor, cinemaId, productId) {
  const scope = actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };

  const [cinema, product] = await Promise.all([
    models.Cinema.findOne({
      where: { id: cinemaId, ...scope },
      attributes: ['id', 'chainId', 'isActive'],
    }),
    models.Product.findOne({
      where: { id: productId, ...scope },
      attributes: ['id', 'chainId', 'isActive'],
    }),
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

  if (!cinema.isActive) {
    throw new ConflictError('Cannot add a product to a deactivated cinema', {
      cinemaId: cinema.id,
    });
  }

  if (!product.isActive) {
    throw new ConflictError('Cannot add a deactivated product to a cinema', {
      productId: product.id,
    });
  }
}

/**
 * Load a link for modification, with the tenant join applied.
 */
async function findForUpdate(actor, cinemaProductId) {
  const cinemaProduct = await models.CinemaProduct.findOne({
    where: { id: cinemaProductId },
    include: [cinemaScope(actor)],
  });

  if (!cinemaProduct) throw new NotFoundError('Cinema product');

  return cinemaProduct;
}

/**
 * Paginated, filtered link list.
 *
 * Filtering by both cinemaId and productId is how a client answers
 * (cinemaId, productId) -> cinemaProductId: the pair is unique, so the page
 * holds one row or none.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{cinemaProducts: object[], total: number}>}
 */
async function listCinemaProducts(
  actor,
  { page, limit, sort, order, cinemaId, productId, isActive }
) {
  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (productId) where.productId = productId;
  if (isActive !== undefined) where.isActive = isActive;

  const { rows, count } = await models.CinemaProduct.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    // Carries the tenant filter; a cinemaId from another chain narrows an
    // already-scoped set rather than escaping it.
    include: [cinemaScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { cinemaProducts: rows.map(serializeCinemaProduct), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or its cinema is outside
 *   the actor's chain.
 */
async function getCinemaProduct(actor, cinemaProductId) {
  const cinemaProduct = await models.CinemaProduct.findOne({
    where: { id: cinemaProductId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
  });

  if (!cinemaProduct) throw new NotFoundError('Cinema product');

  return serializeCinemaProduct(cinemaProduct);
}

/**
 * A duplicate (cinema, product) is left to UQ_cinema_products, which the error
 * handler turns into a 409 - checking first would only add a query and still
 * lose a race.
 */
async function createCinemaProduct(actor, payload) {
  const { cinemaId, productId, ...attributes } = payload;

  await assertCinemaAndProductAgree(actor, cinemaId, productId);
  assertDateRange(attributes.availableFrom, attributes.availableUntil);

  const cinemaProduct = await models.CinemaProduct.create({
    ...attributes,
    cinemaId,
    productId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeCinemaProduct(cinemaProduct);
}

async function updateCinemaProduct(actor, cinemaProductId, payload) {
  const cinemaProduct = await findForUpdate(actor, cinemaProductId);

  // Checked against the range the row would end up with, so moving one bound
  // past the other stored one is caught rather than saved.
  assertDateRange(
    'availableFrom' in payload ? payload.availableFrom : cinemaProduct.availableFrom,
    'availableUntil' in payload ? payload.availableUntil : cinemaProduct.availableUntil
  );

  await cinemaProduct.update({ ...payload, updatedBy: actor.id });

  return serializeCinemaProduct(cinemaProduct);
}

/**
 * Soft delete: is_active becomes 0. The row stays, and so do its availability
 * hours - withdrawing a product from a cinema should not discard the schedule
 * it had there.
 *
 * Idempotent.
 */
async function deactivateCinemaProduct(actor, cinemaProductId) {
  const cinemaProduct = await findForUpdate(actor, cinemaProductId);

  if (cinemaProduct.isActive) {
    await cinemaProduct.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeCinemaProduct(cinemaProduct);
}

module.exports = {
  listCinemaProducts,
  getCinemaProduct,
  createCinemaProduct,
  updateCinemaProduct,
  deactivateCinemaProduct,
  serializeCinemaProduct,
  PUBLIC_ATTRIBUTES,
};
