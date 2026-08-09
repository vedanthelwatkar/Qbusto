'use strict';

/**
 * Environment loading and validation.
 *
 * Every other module reads configuration from here, never from process.env
 * directly, so that defaults live in exactly one place and a misconfigured
 * environment fails loudly at boot instead of surfacing as a confusing runtime
 * error later.
 *
 * Note: the Sequelize CLI reads backend/config/config.js, not this file. That
 * file stays the source of truth for CLI connection settings; see
 * src/config/database.js for how the two relate.
 */

require('dotenv').config();

const Joi = require('joi');

const MIN_PRODUCTION_SECRET_LENGTH = 32;

const envSchema = Joi.object({
  // ---- App ----
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  API_BASE_URL: Joi.string().uri({ allowRelative: true }).optional(),

  // ---- Database ----
  // Consumed by config/config.js; validated here so a missing value is caught
  // at boot rather than on the first query.
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(1433),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_ENCRYPT: Joi.boolean().default(true),
  DB_TRUST_SERVER_CERTIFICATE: Joi.boolean().default(true),

  // ---- Auth ----
  // Length is enforced only in production: a weak secret must never ship, but
  // failing a developer's boot over it just gets the check worked around.
  // Shorter secrets produce a startup warning in other environments.
  JWT_SECRET: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .min(MIN_PRODUCTION_SECRET_LENGTH)
        .messages({
          'string.min': `JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
        }),
    }),
  JWT_EXPIRES_IN: Joi.string().default('1d'),
  JWT_ISSUER: Joi.string().default('qbusto'),

  // ---- CORS ----
  CORS_ALLOWED_ORIGINS: Joi.string().allow('').default(''),
  CORS_ALLOW_CREDENTIALS: Joi.boolean().default(false),

  // ---- Logging ----
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'debug')
    .default(Joi.ref('NODE_ENV', { adjust: (env) => (env === 'production' ? 'info' : 'debug') })),
  LOG_DIR: Joi.string().default('logs'),

  // ---- Rate limiting ----
  RATE_LIMIT_WINDOW_MS: Joi.number()
    .integer()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(300),

  // ---- Docs ----
  SWAGGER_ENABLED: Joi.boolean().default(true),

  // ---- Razorpay (Phase 2; not required to boot) ----
  RAZORPAY_KEY_ID: Joi.string().allow('').optional(),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').optional(),
}).unknown(true);

const { value, error } = envSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: false,
});

if (error) {
  const details = error.details.map((detail) => `  - ${detail.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

// console.warn rather than the logger: the logger depends on this module.
if (value.NODE_ENV === 'development' && value.JWT_SECRET.length < MIN_PRODUCTION_SECRET_LENGTH) {
  console.warn(
    `[config] JWT_SECRET is ${value.JWT_SECRET.length} characters. ` +
      `At least ${MIN_PRODUCTION_SECRET_LENGTH} is required before deploying to production.`
  );
}

// Connection settings are intentionally absent: config/config.js owns those and
// is shared with the Sequelize CLI. They are validated above so a missing value
// fails at boot, but nothing in src/ should read them from here.
const env = {
  nodeEnv: value.NODE_ENV,
  isProduction: value.NODE_ENV === 'production',
  isTest: value.NODE_ENV === 'test',

  port: value.PORT,
  apiBaseUrl: value.API_BASE_URL || `http://localhost:${value.PORT}`,

  jwt: {
    secret: value.JWT_SECRET,
    expiresIn: value.JWT_EXPIRES_IN,
    issuer: value.JWT_ISSUER,
  },

  cors: {
    allowedOrigins: value.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    allowCredentials: value.CORS_ALLOW_CREDENTIALS,
  },

  log: {
    level: value.LOG_LEVEL,
    dir: value.LOG_DIR,
  },

  rateLimit: {
    windowMs: value.RATE_LIMIT_WINDOW_MS,
    max: value.RATE_LIMIT_MAX,
  },

  swagger: {
    enabled: value.SWAGGER_ENABLED,
  },
};

module.exports = Object.freeze(env);
