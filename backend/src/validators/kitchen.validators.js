'use strict';

/**
 * Request schemas for /api/kitchen.
 *
 * The status lists here are narrower than the order API's on purpose. A KDS
 * caller can neither filter by nor move to a status outside the kitchen's
 * remit, so `initiated`, `rejected` and every payment status are rejected at
 * the edge rather than being caught later by the service.
 *
 * That is belt and braces, not the actual guard: kitchen.service applies the
 * eligibility rule to every read and every write regardless of what the
 * validator let through. Validation shapes the request; the service decides
 * what the request is allowed to see.
 */

const Joi = require('joi');

const { idParam, optionalText, paginationQuery } = require('./common.validators');
const { id } = require('./common.validators');
const fulfilmentService = require('../services/fulfilment.service');

/** The statuses a board may be narrowed to - the kitchen's own queues. */
const FILTERABLE_STATUSES = [
  ...fulfilmentService.KDS_ACTIVE_STATUSES,
  ...fulfilmentService.KDS_COMPLETED_STATUSES,
];

/**
 * Sortable fields, as a whitelist. `placedAt` is the API name for created_at;
 * the service maps it to the column.
 */
const SORTABLE_FIELDS = ['placedAt', 'showTime', 'id'];

const list = {
  query: paginationQuery.keys({
    /**
     * Which queues to return.
     *
     * `active` is the board: work the kitchen still owes. `completed` is the
     * handed-over history a screen shows in a collapsed lane. `all` exists so
     * one poll can refresh both without a second request.
     */
    scope: Joi.string().valid('active', 'completed', 'all').default('active'),
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('placedAt'),
    // Oldest first. A kitchen works a queue, so the opposite default to the
    // staff order list is the correct one here.
    order: Joi.string().lowercase().valid('asc', 'desc').default('asc'),
    cinemaId: id,
    screenId: id,
    status: Joi.string().valid(...FILTERABLE_STATUSES),
  }),
};

const getById = { params: idParam };

/**
 * A kitchen status change.
 *
 * `status` is limited to the three forward moves a cook makes. Whether the
 * move is legal *from the order's current status* is not expressible here -
 * that needs the row - and lives in fulfilment.service's transition graph.
 */
const updateStatus = {
  params: idParam,
  body: Joi.object({
    status: Joi.string()
      .valid(...fulfilmentService.KDS_ALLOWED_TARGETS)
      .required(),
    reason: optionalText(500),
  }),
};

module.exports = { list, getById, updateStatus, FILTERABLE_STATUSES, SORTABLE_FIELDS };
