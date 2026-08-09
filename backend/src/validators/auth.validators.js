'use strict';

/**
 * Request schemas for the /api/auth endpoints.
 *
 * The change-password body uses snake_case (`current_password`, `new_password`)
 * because that is the agreed client contract for this endpoint. Everywhere else
 * the API speaks camelCase, matching the model attributes.
 */

const Joi = require('joi');

const { password } = require('./common.validators');

const login = {
  body: Joi.object({
    username: Joi.string().trim().max(50).required(),
    // Deliberately not `password` from common.validators: an existing account
    // whose password predates the current rules must still be able to log in.
    // Strength is enforced when a password is set, not when it is checked.
    password: Joi.string().max(72).required(),
  }),
};

const changePassword = {
  body: Joi.object({
    current_password: Joi.string().max(72).required(),
    new_password: password.required(),
  }),
};

module.exports = { login, changePassword };
