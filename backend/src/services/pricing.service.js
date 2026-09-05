'use strict';

/**
 * Product pricing - ONE ROW PER (CINEMA, PRODUCT), SEVEN DAY PRICES.
 *
 * A row holds `mondayPrice` ... `sundayPrice`. A NULL day price means the
 * product is not sold that day; it does not mean free, and it is a state the
 * live data genuinely uses. Which day applies is the QBusto BUSINESS day
 * (06:00 -> 06:00, utils/businessDay.js), so an order at 01:00 on Monday pays
 * Sunday's price.
 *
 * This replaced one row per (cinema, product, day_of_week) with a
 * `day_of_week` 0 row meaning "every day"
 * (migration 20260905000100-product-pricing-weekly). The discount columns
 * survived that change but are now shared by the whole week rather than being
 * per-day - a deliberate reduction, checked against the live data first, and
 * recorded in the migration's header.
 *
 * A price row ties a cinema to a product, and the database does not check that
 * the two belong to the same chain. For a non-owner both lookups are scoped to
 * their own chain, so a mismatch cannot arise; an owner is scoped to nothing,
 * so the two chains are compared explicitly. This mirrors the guard the
 * cinema_products and cinema_categories model hooks apply for the same gap.
 *
 * (cinema_id, product_id) is unique - UQ_product_pricing_cinema_product - so a
 * duplicate is left to the database and surfaces as a 409. Both columns are
 * therefore fixed at creation: changing one identifies a different row, not an
 * edit of this one.
 *
 * The rule that a discount amount is meaningless without a discountType lives
 * in the frozen ProductPricing beforeSave hook and is deliberately not repeated
 * here. It raises ValidationError, which reaches the client as a 400.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 *
 * Shared pricing, availability, and money utility functions are exported for
 * reuse by both staff and consumer order flows to ensure consistent calculations.
 */

const { models } = require('../config/database');
const {
  businessDayOfWeek,
  secondsIntoDay,
  timeToSeconds,
  isWithinDailyWindow,
} = require('../utils/businessDay');
const { NotFoundError, ConflictError } = require('../utils/errors');
const { ROLES, ORDER_SOURCES } = require('../constants');
const cache = require('./cache.service');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'productId',
  'mondayPrice',
  'tuesdayPrice',
  'wednesdayPrice',
  'thursdayPrice',
  'fridayPrice',
  'saturdayPrice',
  'sundayPrice',
  'mondayDiscountType',
  'mondayDiscountValue',
  'mondayDiscountOnQr',
  'mondayDiscountOnKiosk',
  'mondayDiscountOnSeatQr',
  'mondayDiscountOnCounter',
  'tuesdayDiscountType',
  'tuesdayDiscountValue',
  'tuesdayDiscountOnQr',
  'tuesdayDiscountOnKiosk',
  'tuesdayDiscountOnSeatQr',
  'tuesdayDiscountOnCounter',
  'wednesdayDiscountType',
  'wednesdayDiscountValue',
  'wednesdayDiscountOnQr',
  'wednesdayDiscountOnKiosk',
  'wednesdayDiscountOnSeatQr',
  'wednesdayDiscountOnCounter',
  'thursdayDiscountType',
  'thursdayDiscountValue',
  'thursdayDiscountOnQr',
  'thursdayDiscountOnKiosk',
  'thursdayDiscountOnSeatQr',
  'thursdayDiscountOnCounter',
  'fridayDiscountType',
  'fridayDiscountValue',
  'fridayDiscountOnQr',
  'fridayDiscountOnKiosk',
  'fridayDiscountOnSeatQr',
  'fridayDiscountOnCounter',
  'saturdayDiscountType',
  'saturdayDiscountValue',
  'saturdayDiscountOnQr',
  'saturdayDiscountOnKiosk',
  'saturdayDiscountOnSeatQr',
  'saturdayDiscountOnCounter',
  'sundayDiscountType',
  'sundayDiscountValue',
  'sundayDiscountOnQr',
  'sundayDiscountOnKiosk',
  'sundayDiscountOnSeatQr',
  'sundayDiscountOnCounter',
  'isActive',
  'createdAt',
  'updatedAt',
];

// Shared constants and utility functions
const EVERY_DAY = 0;

/**
 * The channel-specific discount SUFFIX for each order source. Combined with a
 * day's field prefix (e.g. `wednesdayDiscountOn`) by `unitDiscountPaise` to
 * reach that day's channel override - `wednesdayDiscountOnQr`, and so on.
 */
const SOURCE_DISCOUNT_SUFFIX = Object.freeze({
  [ORDER_SOURCES.QR]: 'Qr',
  [ORDER_SOURCES.SEAT_QR]: 'SeatQr',
  [ORDER_SOURCES.KIOSK]: 'Kiosk',
  [ORDER_SOURCES.COUNTER]: 'Counter',
});

/**
 * Coerce anything into one of the four real order sources.
 *
 * Every catalogue read now takes `source` from the query string, and that
 * value reaches TWO places where an unbounded string would be a problem: the
 * discount column lookup, and - more importantly - the Redis cache key. An
 * un-normalised source would let one unauthenticated caller mint unlimited
 * distinct cache entries just by varying the parameter, so the value is
 * squeezed down to a member of a fixed set of four here, at the boundary,
 * rather than being trusted anywhere downstream.
 *
 * Unknown, missing or malformed falls back to QR - the lobby rate, and the
 * value the catalogue used unconditionally before it varied by source at all.
 */
function normaliseSource(source) {
  if (typeof source !== 'string') return ORDER_SOURCES.QR;

  const candidate = source.trim().toLowerCase();

  // Object.hasOwn, not a truthiness test on the lookup: `__proto__` and
  // `constructor` resolve through the prototype chain and would otherwise be
  // accepted as valid sources - reaching the cache key, and reaching
  // unitDiscountPaise's column lookup, as strings no pricing row has.
  // Object.freeze does not close this; only an own-property check does.
  return Object.hasOwn(SOURCE_DISCOUNT_SUFFIX, candidate) ? candidate : ORDER_SOURCES.QR;
}

/**
 * The source a request is ENTITLED to, given the evidence it actually carries.
 *
 * `source` is client-declared: it arrives in the QR's query string and nothing
 * authenticates it, so on its own it is a claim, not a fact. It is also not
 * cosmetic - it selects the discount column above, so a claim that goes
 * unchecked is a claim on a price.
 *
 * `seat_qr` is the one source whose claim the request itself can substantiate,
 * because a seat QR is by definition a QR that carries a seat. A request
 * claiming the seat rate while naming no seat is not a seat order in any
 * meaningful sense - there is nowhere to deliver it - so it is served the
 * lobby rate instead. This is the same shape as `screenId`, which is likewise
 * never taken from the client and is resolved server-side from the evidence
 * (screen name + row) the request carries; see consumer.service.resolveScreenId.
 *
 * The downgrade direction is deliberately the conservative one. A genuine seat
 * scan always re-supplies its seat, so a legitimate customer is unaffected;
 * getting it wrong costs them the lobby rate rather than handing out a
 * discount that was never earned. The Consumer already reasons this way about
 * a STALE stored source (see context.store.loadFromStorageOrDefault) - this
 * moves the same rule to the server, where it cannot be edited out of a URL.
 *
 * `kiosk` and `counter` describe a provisioned DEVICE, and a request carries
 * no evidence of what device sent it, so neither can be checked here. That is
 * a known and deliberately bounded gap rather than an oversight: see
 * .claude/rules/coupons.md and the note on this function's limits in
 * consumer.service.createOrder.
 */
function deriveSource(claimed, { hasSeat = false } = {}) {
  const source = normaliseSource(claimed);

  if (source === ORDER_SOURCES.SEAT_QR && !hasSeat) return ORDER_SOURCES.QR;

  return source;
}

/** '250.00' | 250 -> 25000. */
function toPaise(value) {
  return Math.round(Number(value) * 100);
}

/** 25000 -> '250.00', the exact string a DECIMAL(10,2) column wants. */
function toDecimalString(paise) {
  return (paise / 100).toFixed(2);
}

/**
 * The ISO day number whose prices and availability apply at `date`.
 *
 * This is the QBusto BUSINESS day (06:00 -> 06:00), not the calendar day, so
 * an order at 01:00 on Monday is priced as Sunday - which is what the customer
 * in a Sunday late show expects, and what the counter staff would say. The
 * calculation lives in utils/businessDay.js; this is the name the pricing,
 * catalogue and order paths already call, kept so there is exactly one
 * definition of "which day is it" in the application.
 */
function isoDayOfWeek(date = new Date()) {
  return businessDayOfWeek(date);
}

/**
 * The model attribute holding each ISO weekday's price.
 *
 * Indexed 1-7 to match `businessDayOfWeek`. Frozen and looked up with an
 * own-property check wherever it is used, for the same reason
 * SOURCE_DISCOUNT_COLUMN is: a day number that arrived from outside must never
 * resolve to an inherited key.
 */
const DAY_PRICE_COLUMN = Object.freeze({
  1: 'mondayPrice',
  2: 'tuesdayPrice',
  3: 'wednesdayPrice',
  4: 'thursdayPrice',
  5: 'fridayPrice',
  6: 'saturdayPrice',
  7: 'sundayPrice',
});

/**
 * The same seven columns as the DATABASE spells them.
 *
 * Needed because two catalogue queries are raw SQL rather than the ORM. The
 * value is interpolated into those statements, which is safe precisely because
 * it comes from this frozen map keyed by an integer day - never from a
 * request. Anything reaching those queries with a day outside 1-7 gets
 * `undefined` and a SQL error, not an injection.
 */
const DAY_PRICE_SQL_COLUMN = Object.freeze({
  1: 'monday_price',
  2: 'tuesday_price',
  3: 'wednesday_price',
  4: 'thursday_price',
  5: 'friday_price',
  6: 'saturday_price',
  7: 'sunday_price',
});

/** Every weekday price column, Monday first. Handy for attribute lists. */
const DAY_PRICE_COLUMNS = Object.freeze([1, 2, 3, 4, 5, 6, 7].map((day) => DAY_PRICE_COLUMN[day]));

/**
 * Each day's discount field names, keyed the same way DAY_PRICE_COLUMN is.
 *
 * A day's discount is INDEPENDENT of every other day's - a Wednesday-only
 * discount must never apply on Thursday. These are the model-attribute names
 * (camelCase); see discountForDay for how a caller reaches them safely.
 */
const DAY_DISCOUNT_FIELDS = Object.freeze({
  1: {
    type: 'mondayDiscountType',
    value: 'mondayDiscountValue',
    onQr: 'mondayDiscountOnQr',
    onKiosk: 'mondayDiscountOnKiosk',
    onSeatQr: 'mondayDiscountOnSeatQr',
    onCounter: 'mondayDiscountOnCounter',
  },
  2: {
    type: 'tuesdayDiscountType',
    value: 'tuesdayDiscountValue',
    onQr: 'tuesdayDiscountOnQr',
    onKiosk: 'tuesdayDiscountOnKiosk',
    onSeatQr: 'tuesdayDiscountOnSeatQr',
    onCounter: 'tuesdayDiscountOnCounter',
  },
  3: {
    type: 'wednesdayDiscountType',
    value: 'wednesdayDiscountValue',
    onQr: 'wednesdayDiscountOnQr',
    onKiosk: 'wednesdayDiscountOnKiosk',
    onSeatQr: 'wednesdayDiscountOnSeatQr',
    onCounter: 'wednesdayDiscountOnCounter',
  },
  4: {
    type: 'thursdayDiscountType',
    value: 'thursdayDiscountValue',
    onQr: 'thursdayDiscountOnQr',
    onKiosk: 'thursdayDiscountOnKiosk',
    onSeatQr: 'thursdayDiscountOnSeatQr',
    onCounter: 'thursdayDiscountOnCounter',
  },
  5: {
    type: 'fridayDiscountType',
    value: 'fridayDiscountValue',
    onQr: 'fridayDiscountOnQr',
    onKiosk: 'fridayDiscountOnKiosk',
    onSeatQr: 'fridayDiscountOnSeatQr',
    onCounter: 'fridayDiscountOnCounter',
  },
  6: {
    type: 'saturdayDiscountType',
    value: 'saturdayDiscountValue',
    onQr: 'saturdayDiscountOnQr',
    onKiosk: 'saturdayDiscountOnKiosk',
    onSeatQr: 'saturdayDiscountOnSeatQr',
    onCounter: 'saturdayDiscountOnCounter',
  },
  7: {
    type: 'sundayDiscountType',
    value: 'sundayDiscountValue',
    onQr: 'sundayDiscountOnQr',
    onKiosk: 'sundayDiscountOnKiosk',
    onSeatQr: 'sundayDiscountOnSeatQr',
    onCounter: 'sundayDiscountOnCounter',
  },
});

/**
 * One day's discount configuration, or null if that day carries none.
 *
 * @returns {{type: string, value: string|null, onQr: string|null,
 *   onKiosk: string|null, onSeatQr: string|null, onCounter: string|null}|null}
 */
/**
 * Every day-discount attribute name, flattened - for Sequelize `attributes`
 * lists that need the whole week's discount columns without spelling out all
 * 42 of them by hand.
 */
const DAY_DISCOUNT_COLUMNS = Object.freeze(
  Object.values(DAY_DISCOUNT_FIELDS).flatMap((fields) => Object.values(fields))
);

function discountForDay(pricing, day) {
  if (!pricing) return null;

  const fields = Object.hasOwn(DAY_DISCOUNT_FIELDS, day) ? DAY_DISCOUNT_FIELDS[day] : undefined;
  if (!fields) return null;

  const type = pricing[fields.type];
  if (!type) return null;

  return {
    type,
    value: pricing[fields.value],
    onQr: pricing[fields.onQr],
    onKiosk: pricing[fields.onKiosk],
    onSeatQr: pricing[fields.onSeatQr],
    onCounter: pricing[fields.onCounter],
  };
}

/**
 * What a product costs on one business day, before any discount.
 *
 * @returns {string|null} The DECIMAL as the driver returns it, or null when
 *   that day carries no price - which means the product is NOT SELLABLE that
 *   day, not that it is free.
 */
function priceForDay(pricing, day) {
  if (!pricing) return null;

  const column = Object.hasOwn(DAY_PRICE_COLUMN, day) ? DAY_PRICE_COLUMN[day] : undefined;
  if (!column) return null;

  const value = pricing[column];

  return value === undefined ? null : value;
}

/** A Date as the 'HH:MM:SS' string a TIME column is compared against. */
function timeOfDay(date) {
  const pad = (part) => String(part).padStart(2, '0');
  return [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
}

/**
 * Render whatever the driver hands back for a TIME column as 'HH:MM:SS'.
 *
 * LOCAL getters, deliberately, and they must stay in step with `timeOfDay`
 * above - the two strings are compared directly in `unavailableReason`.
 *
 * A SQL `time` has no date and no offset; tedious still materialises it as a
 * JS Date, and which components carry the stored digits depends on the
 * connection's `useUTC`. QBusto sets `useUTC: false` (config/config.js, the
 * IST storage pair), so the value arrives in LOCAL components: a column
 * holding 00:00:00 reads back as local midnight. Reading it with getUTC*
 * under that setting returns 18:30:00 instead - and an availability window of
 * 00:00-23:00 becomes 18:30-17:30, which excludes almost the whole day.
 *
 * That is not hypothetical: it made every product with availability hours
 * vanish from the consumer catalogue (cinema 8 showed zero products while
 * cinemas without availability-hours rows were unaffected, because
 * `unavailableReason` short-circuits when there are none).
 */
function formatStoredTime(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;

  const pad = (part) => String(part).padStart(2, '0');
  return [pad(value.getHours()), pad(value.getMinutes()), pad(value.getSeconds())].join(':');
}

/**
 * Whether a cinema product is orderable at `now`.
 * @returns {string|null} A reason it is unavailable, or null when it is.
 */
function unavailableReason(cinemaProduct, now) {
  if (!cinemaProduct.isActive) {
    return 'is not currently carried at this cinema';
  }

  if (cinemaProduct.availableFrom && now < new Date(cinemaProduct.availableFrom)) {
    return 'is not available at this cinema yet';
  }

  if (cinemaProduct.availableUntil && now > new Date(cinemaProduct.availableUntil)) {
    return 'is no longer available at this cinema';
  }

  const hours = cinemaProduct.availabilityHours || [];

  if (hours.length === 0) return null;

  /*
   * WHICH day's windows apply is the business day's decision (06:00 -> 06:00),
   * so a window filed under Sunday still governs Monday 01:00.
   *
   * HOW FAR INTO the window we are is a plain wrap-aware comparison - see
   * isWithinDailyWindow, which explains why the 06:00 offset cancels out of it
   * and must not be applied twice. What that buys is a window running past
   * midnight (22:00 -> 02:00), which the previous string comparison could
   * never match and which a 06:00 business day makes ordinary.
   */
  const day = isoDayOfWeek(now);
  const nowSeconds = secondsIntoDay(now);

  const open = hours.some((hour) => {
    if (hour.dayOfWeek !== EVERY_DAY && hour.dayOfWeek !== day) return false;

    const start = timeToSeconds(formatStoredTime(hour.startTime));
    const end = timeToSeconds(formatStoredTime(hour.endTime));

    return isWithinDailyWindow(nowSeconds, start, end);
  });

  return open ? null : 'is not available at this time of day';
}

/**
 * The pricing row that applies to a product at a cinema on a given day.
 *
 * There is now at most ONE row per (cinema, product) - the week lives in its
 * seven columns - so this no longer chooses between rows. What it still does,
 * and what callers depend on, is answer "is this product priced today at all":
 * a row whose column for `day` is NULL means the product is not sold that day,
 * and returning null here keeps every caller's existing "no pricing" branch
 * doing the right thing.
 */
function selectPricing(pricings, day) {
  const rows = Array.isArray(pricings) ? pricings : [pricings];
  const pricing = rows.find(Boolean) || null;

  if (!pricing) return null;

  return priceForDay(pricing, day) === null ? null : pricing;
}

/**
 * The per-unit discount in paise for one price row on one channel.
 * Clamped to the unit price to prevent negative totals.
 */
function unitDiscountPaise(pricing, source, unitPricePaise, day) {
  const discount = discountForDay(pricing, day);
  if (!discount) return 0;

  // Own-property check for the same reason as normaliseSource: an inherited
  // key must never resolve to a column name. Every caller normalises first;
  // this is the second lock on the same door.
  const suffix =
    typeof source === 'string' && Object.hasOwn(SOURCE_DISCOUNT_SUFFIX, source)
      ? SOURCE_DISCOUNT_SUFFIX[source]
      : undefined;
  const channelKey = suffix ? `on${suffix}` : undefined;
  const channelValue = channelKey ? discount[channelKey] : null;
  const raw = channelValue !== null && channelValue !== undefined ? channelValue : discount.value;

  if (raw === null || raw === undefined) return 0;

  const amount =
    discount.type === 'P' ? Math.round((unitPricePaise * Number(raw)) / 100) : toPaise(raw);

  return Math.min(Math.max(amount, 0), unitPricePaise);
}

// CRUD functions for pricing management

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
async function listPricings(actor, { page, limit, sort, order, cinemaId, productId, isActive }) {
  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (productId) where.productId = productId;
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

// Catalogue writes drop the read-through cache - see services/cache.service.js.
// Wrapped at the export boundary rather than inside each function, so every
// invalidation point in this file is visible in one place.
module.exports = {
  normaliseSource,
  deriveSource,
  listPricings,
  getPricing,
  createPricing: cache.invalidatingAfter(createPricing),
  updatePricing: cache.invalidatingAfter(updatePricing),
  deactivatePricing: cache.invalidatingAfter(deactivatePricing),
  serializePricing,
  PUBLIC_ATTRIBUTES,
  toPaise,
  toDecimalString,
  isoDayOfWeek,
  priceForDay,
  DAY_PRICE_COLUMN,
  DAY_PRICE_COLUMNS,
  DAY_PRICE_SQL_COLUMN,
  timeOfDay,
  formatStoredTime,
  unavailableReason,
  selectPricing,
  discountForDay,
  DAY_DISCOUNT_FIELDS,
  DAY_DISCOUNT_COLUMNS,
  unitDiscountPaise,
  EVERY_DAY,
  SOURCE_DISCOUNT_SUFFIX,
};
