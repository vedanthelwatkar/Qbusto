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

const path = require('path');

const Joi = require('joi');

/**
 * The directory containing `backend`, `shared` and the frontends.
 *
 * `shared/openapi.json` is already resolved from here by
 * scripts/generate-openapi.js; uploaded images use the same anchor so that
 * `shared/` is one shared location rather than two conventions.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const MIN_PRODUCTION_SECRET_LENGTH = 32;

const envSchema = Joi.object({
  // ---- App ----
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  API_BASE_URL: Joi.string().uri({ allowRelative: true }).optional(),

  /**
   * The timezone the business runs in - NOT a display preference.
   *
   * The client's `session`/`film` tables store `datetime` with no offset, and
   * those values are cinema-local wall clock. Every piece of code that reads or
   * compares them works in PROCESS-LOCAL time to match: utils/sqlDate formats
   * the bounds of the session window, and models/session re-reads the driver's
   * UTC-labelled values as local. That is correct only while the process's own
   * timezone IS the cinema's.
   *
   * On a Windows host in India it silently is. In a container or on a cloud VM
   * it silently is NOT - both default to UTC - and every one of those
   * comparisons shifts by 5.5 hours with nothing failing loudly. Pinning it
   * here removes the dependency on how the host happens to be configured.
   *
   * SINCE THE IST-STORAGE CHANGE THIS IS ALSO LOAD-BEARING FOR READS.
   * config/config.js sets `useUTC: false`, which means "parse an offset-less
   * column as PROCESS-local". That only yields IST while the process is on
   * IST, so the guard below is what stands between a UTC container and every
   * timestamp in the database being misread by 5.5 hours.
   */
  APP_TIMEZONE: Joi.string().default('Asia/Kolkata'),

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

  // ---- Cache (Redis) ----
  /**
   * Unset means NO CACHING - the application runs exactly as it did before
   * caching existed. That is deliberate: it keeps the cache an optional
   * deployment concern rather than a hard dependency, and it is what lets the
   * test suite run without a Redis server.
   */
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),

  /**
   * How long a cached catalogue response stays servable.
   *
   * Short on purpose. A product's availability window is evaluated against the
   * clock (pricing.service.unavailableReason), so a response cached at 13:59
   * for a product that stops selling at 14:00 stays wrong until it expires.
   * The TTL is therefore the worst-case staleness on an availability boundary,
   * and 60s keeps that under a minute while still absorbing the bulk of the
   * repeat traffic a kiosk generates.
   */
  CACHE_TTL_SECONDS: Joi.number().integer().positive().max(3600).default(60),

  /** A slow cache is worse than no cache - it holds the request open. */
  REDIS_TIMEOUT_MS: Joi.number().integer().positive().max(5000).default(1000),

  // ---- Docs ----
  SWAGGER_ENABLED: Joi.boolean().default(true),

  /**
   * ---- Uploaded image storage ----
   *
   * Root directory for uploaded images. The default puts them in the shared
   * directory that already holds openapi.json, so the platform has one shared
   * storage location rather than a copy per application. Relative values are
   * resolved against the repository root - the same anchor the OpenAPI
   * generator uses - which keeps the default working whatever directory the
   * service is started from.
   *
   * PRODUCTION sets an absolute path outside the source tree, so redeploying
   * cannot delete uploaded images. An absolute value is used as given.
   *
   * The database stores `/uploads/<entity>/<file>`, never a path from here, so
   * this value can differ between servers without touching a single row.
   */
  FILE_STORAGE_PATH: Joi.string().default('shared/uploads'),

  /** Largest accepted upload, in megabytes. */
  MAX_UPLOAD_SIZE_MB: Joi.number().integer().positive().max(50).default(5),

  /**
   * ---- Cashfree payments (not required to boot) ----
   *
   * There are deliberately NO credential variables here.
   *
   * Cashfree credentials - app id, secret key and environment - live ONLY in
   * `payment_gateway_config`, per cinema, with the secret encrypted at rest by
   * CREDENTIALS_ENCRYPTION_KEY. A cinema with no active row simply cannot take
   * payments: `cashfree.resolveCredentials` throws and payment-init answers
   * 503. There is no deployment-wide fallback to inherit, which is the point -
   * a global credential silently standing in for a cinema nobody finished
   * configuring is how money ends up in the wrong merchant account.
   *
   * The settings below are transport and call-shape only. None of them can
   * authenticate anything on their own.
   */

  /**
   * Where Cashfree should POST payment notifications. Optional: the webhook
   * URL is normally registered once in the Cashfree Dashboard, and this only
   * overrides it per order, which is what makes a developer tunnel work
   * without touching the shared dashboard configuration.
   */
  CASHFREE_NOTIFY_URL: Joi.string().uri().allow('').optional(),

  /** Where the hosted checkout returns the customer. Optional; see below. */
  CASHFREE_RETURN_URL: Joi.string().uri().allow('').optional(),

  /**
   * Used when an order carries no usable mobile number.
   *
   * orders.customer_mobile is nullable, but Cashfree rejects an order create
   * without a 10-digit customer_phone. This is contact metadata on the
   * provider's side, never something QBusto authenticates against, so a
   * placeholder is preferable to refusing a payment for an order that is
   * otherwise perfectly valid.
   */
  CASHFREE_FALLBACK_CUSTOMER_PHONE: Joi.string()
    .pattern(/^\d{10}$/)
    .default('9999999999'),

  /**
   * How long any single Cashfree call may take.
   *
   * The binding constraint is payment-init, which a customer is standing at a
   * kiosk waiting on, so the budget is the customer's patience rather than the
   * provider's worst case. Erring long is the wrong trade: a timeout costs
   * only a missed chance to reconcile, which the next attempt retries, whereas
   * a stalled payment-init strands someone mid-purchase.
   */
  CASHFREE_TIMEOUT_MS: Joi.number().integer().positive().max(30000).default(4000),

  /**
   * Encrypts/decrypts `payment_gateway_config.gateway_secret_encrypted` - the
   * per-cinema Cashfree secret key. 64 hex characters (32 bytes, for
   * AES-256-GCM - see src/utils/credentials.js).
   *
   * Deliberately kept OUTSIDE the database entirely: the whole point of
   * encrypting the column is that a database leak alone (a backup, an
   * unrelated SQL injection elsewhere) must not hand over a working payment
   * gateway credential. If this key lived next to the ciphertext it protects,
   * encryption would be theatre.
   *
   * Optional at the Joi level so a deployment that has not yet configured any
   * per-cinema gateway can still boot; the guard below makes it required in
   * production, and src/utils/credentials.js throws clearly if an encrypt/
   * decrypt is attempted without it.
   */
  CREDENTIALS_ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .allow('')
    .optional()
    .messages({
      'string.pattern.base':
        'CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256)',
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

/*
 * There are no Cashfree boot guards, because there is no longer anything at
 * boot to guard.
 *
 * This module previously refused to start when NODE_ENV=production carried no
 * global credentials or pointed at the Cashfree sandbox - the "checkout works,
 * orders are marked paid, food goes out, no real money was taken" case, which
 * nothing downstream can detect.
 *
 * Credentials and environment are now per cinema, in payment_gateway_config,
 * and rows change while the process is running. A boot-time check could only
 * ever have inspected values this process no longer holds, so keeping one
 * would have meant asserting something it cannot actually see. The equivalent
 * failure is instead a per-cinema one: a cinema configured for `test` takes no
 * real money, and that is visible in its Dashboard payment settings and in the
 * `environment` column, not in this file.
 */

// console.warn rather than the logger: the logger depends on this module.
if (value.NODE_ENV === 'development' && value.JWT_SECRET.length < MIN_PRODUCTION_SECRET_LENGTH) {
  console.warn(
    `[config] JWT_SECRET is ${value.JWT_SECRET.length} characters. ` +
      `At least ${MIN_PRODUCTION_SECRET_LENGTH} is required before deploying to production.`
  );
}

/**
 * Without this key, no per-cinema `payment_gateway_config` row can ever be
 * decrypted - every cinema with one configured would have payments silently
 * unavailable, which in production must be caught at boot, not discovered by
 * a customer standing at a kiosk.
 */
if (value.NODE_ENV === 'production' && !value.CREDENTIALS_ENCRYPTION_KEY) {
  throw new Error(
    'Invalid environment configuration:\n' +
      '  - CREDENTIALS_ENCRYPTION_KEY must be set when NODE_ENV is production. ' +
      'Without it, no per-cinema payment_gateway_config row can be decrypted.'
  );
}

/**
 * Apply the business timezone to the process itself.
 *
 * Done here, in the module every entry point loads first, so it is in effect
 * before any Date is constructed. Node reads TZ lazily and caches it, so an
 * assignment this early is honoured; one made after the first date operation
 * would not be.
 *
 * Then verified rather than assumed: if the runtime does not actually end up
 * on the intended offset - an unrecognised zone name, or a Node build without
 * full ICU, both of which fall back to UTC silently - that must fail at boot.
 * The alternative is a service that looks perfectly healthy while every
 * session window and show time is 5.5 hours out.
 */
process.env.TZ = value.APP_TIMEZONE;

/**
 * Compared as WALL CLOCK, not as a zone name.
 *
 * Names are not canonical: ICU resolves 'Asia/Kolkata' to its legacy alias
 * 'Asia/Calcutta' on some builds, and a string comparison would reject that -
 * an identical zone, refused on a spelling. What actually has to hold is that
 * the process's own local time IS the business's local time, so that is what
 * is asserted.
 */
function wallClockIn(timeZone, instant) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(instant);
}

const bootInstant = new Date();
let intendedWallClock;

try {
  intendedWallClock = wallClockIn(value.APP_TIMEZONE, bootInstant);
} catch {
  throw new Error(
    'Invalid environment configuration:\n' +
      `  - APP_TIMEZONE is "${value.APP_TIMEZONE}", which this runtime does not recognise as a timezone. ` +
      'Use an IANA name such as Asia/Kolkata.'
  );
}

const processWallClock = wallClockIn(undefined, bootInstant);

if (processWallClock !== intendedWallClock) {
  throw new Error(
    'Invalid environment configuration:\n' +
      `  - APP_TIMEZONE is "${value.APP_TIMEZONE}" (${intendedWallClock}) but the process is running at ` +
      `${processWallClock}. Show times and the session window are computed in ` +
      'process-local time, so every one of them would be shifted. Check that Node ' +
      'has full ICU and that APP_TIMEZONE is applied before startup.'
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

  /** The business timezone, already applied to process.env.TZ above. */
  timeZone: value.APP_TIMEZONE,

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

  redis: {
    url: value.REDIS_URL || '',

    /**
     * Caching runs only when a URL is configured AND we are not under test.
     *
     * The test guard is not belt-and-braces - it is what keeps the suite
     * hermetic. A developer with REDIS_URL in their .env would otherwise have
     * their tests silently reading a shared cache, which turns an ordering
     * bug into an unreproducible one.
     */
    enabled: Boolean(value.REDIS_URL) && value.NODE_ENV !== 'test',

    ttlSeconds: value.CACHE_TTL_SECONDS,
    timeoutMs: value.REDIS_TIMEOUT_MS,
  },

  cashfree: {
    /*
     * No appId, secretKey, configured or environment. Those come from the
     * cinema's own payment_gateway_config row and nowhere else - see the
     * schema note above. Everything here is transport and call shape.
     */
    notifyUrl: value.CASHFREE_NOTIFY_URL || '',
    returnUrl: value.CASHFREE_RETURN_URL || '',
    fallbackCustomerPhone: value.CASHFREE_FALLBACK_CUSTOMER_PHONE,
    timeoutMs: value.CASHFREE_TIMEOUT_MS,

    /** Orders are created in INR only. */
    currency: 'INR',
  },

  security: {
    /**
     * 32-byte AES-256 key, hex-encoded, for src/utils/credentials.js. Empty
     * string rather than undefined when unset, matching every other optional
     * secret in this module - callers check truthiness, not `typeof`.
     */
    credentialsEncryptionKey: value.CREDENTIALS_ENCRYPTION_KEY || '',
  },

  uploads: {
    /**
     * Absolute from here on. Everything downstream joins onto this, so
     * resolving once means no other module has to care whether the configured
     * value was relative or where the process was started from.
     *
     * path.resolve returns an absolute FILE_STORAGE_PATH unchanged, so a
     * production server pointing at a location off the deployment disk is not
     * affected by the repository-relative default.
     */
    storagePath: path.resolve(REPO_ROOT, value.FILE_STORAGE_PATH),
    maxBytes: value.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    maxSizeMb: value.MAX_UPLOAD_SIZE_MB,
  },
};

module.exports = Object.freeze(env);
