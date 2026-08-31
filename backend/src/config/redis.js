'use strict';

/**
 * The Redis connection, and the rule that a cache may never break a request.
 *
 * OPTIONAL BY DESIGN. `REDIS_URL` unset means caching is off and every helper
 * here becomes a no-op - the application behaves exactly as it did before
 * caching existed. That is what lets the test suite (which opens no database
 * and no Redis) run untouched, and it is what lets a deployment turn caching
 * off without a code change.
 *
 * FAIL-SOFT. A cache is an optimisation, never a source of truth. Every error
 * from Redis - refused connection, timeout, a bad reply - is swallowed and
 * reported as a miss, so the caller falls through to the database and answers
 * the request correctly but a little slower. The alternative, letting a dead
 * cache 500 the catalogue, would make the system LESS reliable than having no
 * cache at all.
 *
 * The error log is rate-limited to one line a minute: a Redis that is down
 * fails on every single request, and an unthrottled log would bury every other
 * line in the file within seconds.
 */

const Redis = require('ioredis');

const env = require('./env');
const logger = require('./logger');

/** One line a minute is enough to notice; more is noise that hides the rest. */
const ERROR_LOG_INTERVAL_MS = 60_000;

let client = null;
let lastErrorLoggedAt = 0;

/** True when the cache is configured AND allowed to run in this environment. */
function isEnabled() {
  return env.redis.enabled;
}

/**
 * Log at most one Redis failure per interval, at warn - not error.
 *
 * A failed cache read is a degraded optimisation, not a failed request. Paging
 * someone at 3am because the catalogue got slower is the wrong severity.
 */
function reportFailure(operation, error) {
  const now = Date.now();
  if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;

  lastErrorLoggedAt = now;
  logger.warn('Redis unavailable; serving from the database', {
    operation,
    error: error.message,
  });
}

/**
 * The shared client, created on first use.
 *
 * `lazyConnect` keeps the socket closed until something actually asks for it,
 * so merely importing this module - which every service does - never opens a
 * connection. `maxRetriesPerRequest: 1` and a short timeout matter more here
 * than durability: a command that hangs holds the HTTP request open behind it,
 * and waiting three seconds for a cache is worse than missing it.
 */
function getClient() {
  if (!isEnabled()) return null;
  if (client) return client;

  client = new Redis(env.redis.url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: env.redis.timeoutMs,
    commandTimeout: env.redis.timeoutMs,
    // Without a ceiling the backoff grows unbounded and a recovered Redis can
    // sit unused for minutes after it comes back.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    enableOfflineQueue: false,
  });

  // An 'error' listener is REQUIRED: an ioredis client with no error handler
  // emits an unhandled 'error' event, which crashes the process. The whole
  // point of this module is that Redis being down cannot take the API with it.
  client.on('error', (error) => reportFailure('connection', error));

  client.connect().catch((error) => reportFailure('connect', error));

  return client;
}

/** A cache read. Returns null on a miss, on a parse failure, or on any error. */
async function get(key) {
  const redis = getClient();
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (error) {
    // A corrupt entry is treated as a miss rather than thrown: the shape a key
    // holds can change across a deploy, and one stale value must not 500 a
    // page until someone flushes it by hand.
    reportFailure('get', error);
    return null;
  }
}

/** A cache write. Best-effort - a failure to store is not a failure to serve. */
async function set(key, value, ttlSeconds) {
  const redis = getClient();
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    reportFailure('set', error);
  }
}

/**
 * Bump a counter and return its new value, for generation-stamped keys.
 *
 * Returns null on failure, which callers treat as "cannot invalidate" - see
 * cache.service for why that degrades safely.
 */
async function increment(key) {
  const redis = getClient();
  if (!redis) return null;

  try {
    return await redis.incr(key);
  } catch (error) {
    reportFailure('incr', error);
    return null;
  }
}

/** Read a counter. Null on miss or failure, so callers can tell them apart. */
async function getRaw(key) {
  const redis = getClient();
  if (!redis) return null;

  try {
    return await redis.get(key);
  } catch (error) {
    reportFailure('getRaw', error);
    return null;
  }
}

/**
 * Close the connection on shutdown.
 *
 * `quit` waits for in-flight commands; if Redis is already unreachable that
 * wait would hang the process on exit, so a failure falls back to a hard
 * disconnect.
 */
async function disconnect() {
  if (!client) return;

  try {
    await client.quit();
  } catch {
    client.disconnect();
  } finally {
    client = null;
  }
}

module.exports = {
  isEnabled,
  get,
  set,
  increment,
  getRaw,
  disconnect,
};
