'use strict';

/**
 * Request schemas for the /api/offers endpoints.
 *
 * An offer is a cinema-scoped coupon, validated and applied entirely within
 * QBusto - see backend/src/services/coupon.service.js for the customer-facing
 * validation logic this data drives, and offer.service.js's header note for
 * why Cashfree has no role in this at all.
 *
 * `discountType` is free text but has a DEFINED meaning coupon.service reads
 * directly: 'percentage' (case-insensitive) treats `discAmount` as a percent
 * of the cart, capped by `maxDiscAmount`; anything else, including 'flat',
 * treats it as a flat rupee amount. Normalised to lower case here (like
 * `status`), so every new write is stored consistently - every reader that
 * compares it (coupon.service.js, OffersPage.tsx, OfferFormModal.tsx) still
 * compares case-insensitively too, as defence in depth for rows written
 * before this normalisation existed. `status` remains free text/informational
 * - not yet read by any calculation, kept open for the operator's own
 * vocabulary rather than a fixed enum.
 *
 * `paymentModes`/`offerCategory` existed only to mirror Cashfree's own offer
 * vocabulary from an abandoned design (see the `create-offers` migration's
 * header note) and were never read anywhere; the columns were dropped by
 * `20260825000700-drop-unused-offer-fields.js`.
 */

const Joi = require('joi');

const { id, idParam, optionalText, money, paginationQuery } = require('./common.validators');

const SORTABLE_FIELDS = ['id', 'cinemaId', 'code', 'status', 'validFrom', 'createdAt'];

const code = Joi.string().trim().min(1).max(50);
const name = Joi.string().trim().min(1).max(150);
const discountType = Joi.string().trim().lowercase().min(1).max(30);
const status = Joi.string().trim().lowercase().max(20);

/**
 * validUntil may not fall before validFrom. Mirrors banner.validators'
 * endDate/startDate pattern for the same reason: an update supplying only
 * one end of the window still has to be checked against the stored value of
 * the other, which is why the service re-checks this on update rather than
 * relying on this schema-level check alone.
 */
const validUntil = Joi.date()
  .iso()
  .allow(null)
  .custom((value, helpers) => {
    const { validFrom } = helpers.state.ancestors[0];
    if (!validFrom || !value) return value;

    return new Date(value) < new Date(validFrom) ? helpers.error('any.invalid') : value;
  })
  .messages({ 'any.invalid': "'validUntil' cannot be earlier than 'validFrom'" });

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    cinemaId: id,
    status,
    code,
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    cinemaId: id.required(),
    code: code.required(),
    name: name.required(),
    discountType: discountType.required(),
    description: optionalText(500),
    tnc: optionalText(2000),
    status: status.default('active'),
    discAmount: money.required(),
    maxDiscAmount: money.allow(null),
    minTxnAmount: money.allow(null),
    maxTxnAmount: money.allow(null),
    maxTxnLimit: Joi.number().integer().min(0).allow(null),
    validFrom: Joi.date().iso().allow(null),
    validUntil,
  }),
};

const update = {
  params: idParam,
  // cinemaId is absent on purpose, matching banner.validators: an offer
  // belongs to the cinema it was created for.
  body: Joi.object({
    code,
    name,
    discountType,
    description: optionalText(500),
    tnc: optionalText(2000),
    status,
    discAmount: money,
    maxDiscAmount: money.allow(null),
    minTxnAmount: money.allow(null),
    maxTxnAmount: money.allow(null),
    maxTxnLimit: Joi.number().integer().min(0).allow(null),
    validFrom: Joi.date().iso().allow(null),
    validUntil,
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
