'use strict';

/**
 * Request schemas for the /api/orders endpoints.
 *
 * Nothing here accepts a price, a discount or a total. Those are calculated by
 * the service from product_pricing, and validate() runs with
 * `stripUnknown: true`, so a client that sends `unitPrice` has it discarded
 * before the service ever sees the body rather than having it rejected - the
 * result is the same and the rule is stated in one place.
 *
 * Status transitions are not expressed here either. Whether a move is legal
 * depends on the status the order is currently in, which needs the row loaded,
 * so the transition graph lives in services/order.service.
 */

const Joi = require('joi');

const { id, idParam, optionalText, paginationQuery } = require('./common.validators');
const { ORDER_STATUS_CODES, PAYMENT_STATUS_CODES, ORDER_SOURCE_NAMES } = require('../constants');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['id', 'cinemaId', 'total', 'createdAt', 'updatedAt', 'deliveredAt'];

/**
 * An order line. `productId` and `quantity` are the only things a client
 * chooses - everything else on order_items is a snapshot the server takes.
 *
 * The quantity ceiling is not in the schema, which checks only `quantity > 0`.
 * It is here because subtotal is a DECIMAL(10,2): without an upper bound a
 * single line can overflow the column, which surfaces as an opaque database
 * error rather than a validation message. 999 of one item is far past any real
 * cinema order.
 */
const orderItem = Joi.object({
  productId: id.required(),
  quantity: Joi.number().integer().min(1).max(999).required(),
});

/**
 * A reason attached to a status change, stored on the log row.
 *
 * Free text rather than a code list: order_status_logs.reason is a varchar and
 * the schema defines no reason taxonomy, so inventing one here would be a
 * business rule the rest of the system does not know about.
 */
const reason = optionalText(500);

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    // Newest first. Orders are an operational queue rather than a catalogue,
    // so the useful default is the opposite of the shared one.
    order: Joi.string().lowercase().valid('asc', 'desc').default('desc'),
    cinemaId: id,
    screenId: id,
    status: Joi.string().valid(...ORDER_STATUS_CODES),
    paymentStatus: Joi.string().valid(...PAYMENT_STATUS_CODES),
    source: Joi.string().valid(...ORDER_SOURCE_NAMES),
    createdFrom: Joi.date().iso(),
    // Bounds the created_at window. Checked against createdFrom here rather
    // than in the service because both are always present together or not at
    // all - there is no stored value to compare against.
    createdTo: Joi.date().iso().greater(Joi.ref('createdFrom')),
  }),
};

const getById = { params: idParam };

/**
 * Statuses are not accepted on creation. A new order always starts at
 * `initiated` / `pending`, so letting a client name a status would let it
 * declare an unpaid order paid.
 */
const create = {
  body: Joi.object({
    cinemaId: id.required(),
    screenId: id.allow(null).default(null),
    seatNumber: optionalText(20).default(null),
    source: Joi.string()
      .valid(...ORDER_SOURCE_NAMES)
      .allow(null)
      .default(null),
    customerMobile: optionalText(15).default(null),
    // Format-checked, unlike the other free-text fields, because it is a
    // delivery address for notifications rather than something a human reads.
    // `.empty('')` maps a blank to the same null the other fields use.
    customerEmail: Joi.string()
      .trim()
      .lowercase()
      .email({ tlds: false })
      .max(200)
      .allow(null)
      .empty('')
      .default(null),
    // Display snapshots. Provider-neutral: nothing here is resolved against a
    // POS, which is a later phase.
    filmTitle: optionalText(200).default(null),
    showTime: Joi.date().iso().allow(null).default(null),
    notes: optionalText(500).default(null),
    items: Joi.array().items(orderItem).min(1).max(50).required(),
  }),
};

const updateStatus = {
  params: idParam,
  body: Joi.object({
    status: Joi.string()
      .valid(...ORDER_STATUS_CODES)
      .required(),
    reason,
  }),
};

const updatePaymentStatus = {
  params: idParam,
  // razorpayPaymentId is deliberately absent even though payment_status_logs
  // has a column for it: writing one would be asserting a gateway result this
  // phase has no way to verify. It belongs with the Razorpay integration.
  body: Joi.object({
    paymentStatus: Joi.string()
      .valid(...PAYMENT_STATUS_CODES)
      .required(),
    reason,
  }),
};

/**
 * The status master tables are small fixed lists - six and four rows - so they
 * are returned whole rather than paginated. `isActive` is still a filter
 * because a status can be retired without being deleted.
 */
const listStatuses = {
  query: Joi.object({
    isActive: Joi.boolean(),
  }),
};

module.exports = {
  list,
  getById,
  create,
  updateStatus,
  updatePaymentStatus,
  listStatuses,
  SORTABLE_FIELDS,
};
