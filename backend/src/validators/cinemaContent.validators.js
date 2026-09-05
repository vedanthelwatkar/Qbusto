'use strict';

/**
 * Request schemas for /api/cinemas/{id}/content.
 *
 * `tncPoints` is capped at 40 points / 500 characters each - generous
 * headroom over the eight-point reference design, not a claim about a
 * "correct" length. Empty strings are dropped rather than rejected, so a
 * staff user who leaves a blank row in the Dashboard's add/remove list does
 * not get a 400 for it.
 */

const Joi = require('joi');

const { idParam, optionalText } = require('./common.validators');

const MAX_POINTS = 40;
const MAX_POINT_LENGTH = 500;

const getById = { params: idParam };

const upsert = {
  params: idParam,
  body: Joi.object({
    contactNo: optionalText(20),
    mailId: Joi.string()
      .trim()
      .lowercase()
      .email()
      .max(255)
      .allow(null, '')
      .custom((value) => (value === '' ? null : value)),
    tncPoints: Joi.array()
      .items(Joi.string().trim().max(MAX_POINT_LENGTH).allow(''))
      .max(MAX_POINTS)
      .default([])
      // Blank entries are noise from the Dashboard's list editor, not content.
      .custom((points) => points.filter((point) => point.length > 0)),
    iconUrl: Joi.string()
      .trim()
      .max(1024)
      .allow(null, '')
      .custom((value) => (value === '' ? null : value)),
  }),
};

module.exports = { getById, upsert };
