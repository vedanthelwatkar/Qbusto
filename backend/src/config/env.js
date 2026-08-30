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
   * Optional so development, test and CI can boot with no payment provider at
   * all; the payment endpoints then refuse rather than half-working.
   *
   * NOTE, and it is the important difference from the previous provider: there
   * is no separate webhook secret. Cashfree signs webhooks with the SAME
   * secret key used to authenticate API calls, so CASHFREE_SECRET_KEY is both
   * the API credential and the webhook verification key. One value fewer to
   * configure, and one fewer way to end up with a deployment that can take
   * payments but cannot verify the notifications about them.
   *
   * The names mirror the Cashfree Dashboard's own labels ("App ID", "Secret
   * Key") so that copying a credential across does not require translating
   * what it is called.
   */
  CASHFREE_APP_ID: Joi.string().allow('').optional(),
  CASHFREE_SECRET_KEY: Joi.string().allow('').optional(),

  /**
   * Which Cashfree environment to talk to. This is an explicit setting rather
   * than something inferred from NODE_ENV, because the two are genuinely
   * independent: a staging deployment runs NODE_ENV=production against the
   * Cashfree sandbox, and that is a legitimate combination a developer must be
   * able to express. The startup guards below cover the dangerous pairings.
   *
   * Both vocabularies are accepted because both are in circulation: Cashfree's
   * API documentation says "sandbox"/"production" while its dashboard and SDK
   * environment enum say TEST/PROD. Refusing one of them would be a startup
   * failure over a synonym.
   */
  CASHFREE_ENVIRONMENT: Joi.string()
    .valid('test', 'sandbox', 'prod', 'production')
    .default('test'),

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

/**
 * The Joi rules above cannot catch an EMPTY credential: `.allow('')` puts ''
 * in the valids list and Joi checks valids before any conditional `.required()`
 * would apply, so `CASHFREE_SECRET_KEY=` passes validation. Verified against
 * joi directly for the previous provider, and the same trap applies here.
 *
 * The consequence is the worst kind of silent failure. Because Cashfree signs
 * webhooks with the client secret, an empty secret in production means the
 * app boots, refuses every webhook delivery as unverifiable, and a payment
 * whose browser callback is lost can never be recovered — with nothing in the
 * running system looking wrong.
 */
const cashfreeConfigured = Boolean(value.CASHFREE_APP_ID && value.CASHFREE_SECRET_KEY);

/** `prod` and `production` both mean live money. Everything else is sandbox. */
const cashfreeIsProduction =
  value.CASHFREE_ENVIRONMENT === 'prod' || value.CASHFREE_ENVIRONMENT === 'production';

if (value.NODE_ENV === 'production' && !cashfreeConfigured) {
  throw new Error(
    'Invalid environment configuration:\n' +
      '  - CASHFREE_APP_ID and CASHFREE_SECRET_KEY must both be set when NODE_ENV is production. ' +
      'Without them no payment can be taken, and webhook deliveries could not be verified even if one were.'
  );
}

/**
 * A production deployment pointed at the Cashfree SANDBOX is the worst kind of
 * misconfiguration: checkout works, the webhook verifies, orders are marked
 * paid, food goes out — and no real money was ever taken. Nothing downstream
 * can detect it, because every signal looks healthy. Refusing to boot is the
 * only place it can be caught.
 */
if (value.NODE_ENV === 'production' && !cashfreeIsProduction) {
  throw new Error(
    'Invalid environment configuration:\n' +
      `  - CASHFREE_ENVIRONMENT is "${value.CASHFREE_ENVIRONMENT}" but NODE_ENV is production. ` +
      'Payments would be simulated and no money collected. Set it to "prod", or do not run as production.'
  );
}

/**
 * The mirror image of the check above, and a real footgun: a developer who
 * copies a production .env to run something locally would be taking REAL money
 * from REAL cards on their laptop. A warning rather than a throw, because
 * debugging against production is occasionally legitimate — but it must never
 * happen without someone noticing.
 */
if (value.NODE_ENV !== 'production' && cashfreeIsProduction) {
  console.warn(
    `[config] CASHFREE_ENVIRONMENT is "${value.CASHFREE_ENVIRONMENT}" but NODE_ENV is "${value.NODE_ENV}". ` +
      'Payments made against this instance will charge real cards.'
  );
}

/**
 * Half-configured. One credential without the other cannot authenticate a
 * single call, and failing at the first payment rather than at boot makes it
 * look like a provider outage instead of a deployment mistake.
 */
if (Boolean(value.CASHFREE_APP_ID) !== Boolean(value.CASHFREE_SECRET_KEY)) {
  console.warn(
    '[config] Only one of CASHFREE_APP_ID / CASHFREE_SECRET_KEY is set. ' +
      'Payments are disabled until both are configured.'
  );
}

/**
 * Short secrets are warned about rather than rejected. The empty case above is
 * the one that silently breaks settlement; refusing to boot on a legitimate
 * but unusually short provider-issued credential would be a false alarm that
 * costs an outage.
 */
if (
  value.NODE_ENV === 'production' &&
  value.CASHFREE_SECRET_KEY &&
  value.CASHFREE_SECRET_KEY.length < MIN_PRODUCTION_SECRET_LENGTH
) {
  console.warn(
    `[config] CASHFREE_SECRET_KEY is ${value.CASHFREE_SECRET_KEY.length} characters, ` +
      `which is shorter than the ${MIN_PRODUCTION_SECRET_LENGTH} expected of a production credential. ` +
      'Confirm it was copied in full.'
  );
}

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

  cashfree: {
    appId: value.CASHFREE_APP_ID || '',

    /**
     * Server-side only, and it never reaches the Consumer. The browser is given
     * a short-lived `paymentSessionId` by payment-init and nothing else.
     *
     * This value does double duty: it authenticates our API calls AND is the
     * key Cashfree signs webhooks with, so it is what proves a delivery
     * actually came from Cashfree.
     */
    secretKey: value.CASHFREE_SECRET_KEY || '',

    /** Both credentials present. Payment endpoints refuse when false. */
    configured: cashfreeConfigured,

    /**
     * Webhook verification needs only the client secret, so it is available on
     * exactly the same condition as everything else. There is no separate
     * enable flag because there is no separate secret to be missing.
     */
    webhooksEnabled: cashfreeConfigured,

    /** Which Cashfree environment to talk to - independent of NODE_ENV. */
    isProduction: cashfreeIsProduction,
    environment: value.CASHFREE_ENVIRONMENT,

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
