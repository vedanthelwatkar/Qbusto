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

  /**
   * Webhook signing secret, set in the Razorpay Dashboard when the webhook is
   * created. It is NOT the API key secret — Razorpay generates a separate
   * value per webhook, and signatures verify against this one.
   *
   * Optional so development and test can boot without it; the webhook route
   * then refuses every request rather than accepting unverified ones. In
   * production it is required, because a deployment that silently stopped
   * verifying signatures would accept forged payment notifications.
   */
  RAZORPAY_WEBHOOK_SECRET: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(MIN_PRODUCTION_SECRET_LENGTH).required().messages({
        'any.required':
          'RAZORPAY_WEBHOOK_SECRET is required in production: without it payment webhooks cannot be verified and would have to be rejected.',
      }),
    }),
}).unknown(true);

const { value, error } = envSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: false,
});

if (error) {
  const details = error.details.map((detail) => `  - ${detail.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

/**
 * A production deployment running on Razorpay test keys is the worst kind of
 * misconfiguration: the checkout works, the webhook verifies, orders are
 * marked paid, food goes out — and no real money was ever taken. Nothing
 * downstream can detect it, because every signal looks healthy. Refusing to
 * boot is the only place it can be caught.
 */
/**
 * The Joi rule above cannot catch an EMPTY secret in production: `.allow('')`
 * on the base schema puts '' in the valids list, and Joi checks valids before
 * `.min(32)` or `.required()` in the conditional branch — so
 * `RAZORPAY_WEBHOOK_SECRET=` passes validation. Verified against joi directly.
 *
 * The consequence is the worst kind of silent failure: production boots with
 * `webhooksEnabled: false`, every Razorpay delivery is answered 400, and a
 * payment whose browser callback is lost can never be recovered. Nothing in
 * the running system looks wrong.
 */
if (value.NODE_ENV === 'production' && !value.RAZORPAY_WEBHOOK_SECRET) {
  throw new Error(
    'Invalid environment configuration:\n' +
      '  - RAZORPAY_WEBHOOK_SECRET is empty but NODE_ENV is production. ' +
      'Webhook deliveries would all be rejected and lost payments could not be recovered.'
  );
}

if (value.NODE_ENV === 'production' && String(value.RAZORPAY_KEY_ID).startsWith('rzp_test_')) {
  throw new Error(
    'Invalid environment configuration:\n' +
      '  - RAZORPAY_KEY_ID is a test-mode key (rzp_test_*) but NODE_ENV is production. ' +
      'Payments would be simulated and no money collected. Use the live key, or do not run as production.'
  );
}

/**
 * The mirror image of the check above, and a real footgun: a developer who
 * copies a production .env to run something locally would be taking REAL
 * money from REAL cards on their laptop. A warning rather than a throw,
 * because production-key debugging is occasionally legitimate — but it must
 * never happen without someone noticing.
 */
if (value.NODE_ENV !== 'production' && String(value.RAZORPAY_KEY_ID).startsWith('rzp_live_')) {
  console.warn(
    `[config] RAZORPAY_KEY_ID is a LIVE key but NODE_ENV is "${value.NODE_ENV}". ` +
      'Payments made against this instance will charge real cards.'
  );
}

/**
 * Razorpay configured but webhooks not. The app still runs and customers can
 * still pay, but the backend can only learn of a payment from the customer's
 * browser — so a closed tab or a dropped connection leaves the order pending
 * with no way to recover it. That is precisely the failure the webhook exists
 * to close, and it is silent, so it is called out at startup.
 */
if (value.RAZORPAY_KEY_ID && !value.RAZORPAY_WEBHOOK_SECRET) {
  console.warn(
    '[config] RAZORPAY_KEY_ID is set but RAZORPAY_WEBHOOK_SECRET is not. ' +
      'Webhook deliveries will be refused, so a payment whose browser callback ' +
      'is lost cannot be recovered automatically.'
  );
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

  razorpay: {
    /**
     * Server-side only. Never reaches the Consumer: the browser is given
     * `razorpayKeyId` by payment-init and nothing else, and this value is what
     * proves a webhook actually came from Razorpay.
     */
    webhookSecret: value.RAZORPAY_WEBHOOK_SECRET || '',
    webhooksEnabled: Boolean(value.RAZORPAY_WEBHOOK_SECRET),
  },
};

module.exports = Object.freeze(env);
