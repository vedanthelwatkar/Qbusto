'use strict';

/**
 * Read-through caching for the public catalogue.
 *
 * WHAT IS CACHED, AND WHY ONLY THIS
 *
 * The consumer catalogue endpoints only. They are public (no actor, so no
 * tenancy dimension to get wrong), read-mostly, and hammered: every kiosk and
 * every phone that scans a QR asks the same handful of questions about the
 * same cinema, and each answer costs several joins plus in-process
 * availability filtering.
 *
 * Deliberately NOT cached:
 *
 *   - Anything authenticated. A staff response varies by actor (tenantScope),
 *     and a key that omitted the actor would serve one chain's data to
 *     another. The upside does not come close to justifying that risk.
 *   - Orders, payments and coupons. Money and a state machine; a stale read
 *     is a wrong charge or a double redemption.
 *   - The kitchen board. It exists to be current.
 *   - `getSessions`. Its result is defined relative to `now` (a window three
 *     hours either side) and it must only ever offer Open sessions - caching
 *     it would keep offering a screening after it closed.
 *   - Product SEARCH queries. Caller-supplied free text is unbounded
 *     cardinality with a near-zero hit rate: it would fill Redis with entries
 *     nothing ever reads again.
 *
 * INVALIDATION
 *
 * One global generation counter, stamped into every key. Any catalogue write
 * bumps it, which orphans every existing entry at once; the orphans are never
 * read again and fall out on their own TTL.
 *
 * A single global counter rather than one per cinema is chosen on purpose.
 * Products, categories and banners are chain-level rows that many cinemas
 * carry, so "which cinemas does this write affect?" is itself a query, and
 * getting it wrong leaves a stale entry serving indefinitely. Bumping
 * everything is one O(1) command, and the trade is right: staff writes are
 * occasional, catalogue reads are constant.
 *
 * KNOWN, BOUNDED STALENESS
 *
 *   - A response is at most CACHE_TTL_SECONDS old. That matters most for
 *     availability windows, which are evaluated against the clock - see the
 *     note on CACHE_TTL_SECONDS in config/env.js.
 *   - If Redis is unreachable at the moment of a write, the generation bump is
 *     lost, and entries written before the outage can be served again once it
 *     recovers - for at most one TTL. Accepted rather than solved: the fix
 *     would be to make a staff write fail because a cache is down, which
 *     inverts the dependency this module exists to avoid.
 */

const crypto = require('crypto');

const env = require('../config/env');
const redis = require('../config/redis');

/** Namespaced so a shared Redis cannot collide with another application. */
const PREFIX = 'qbusto:catalogue';

/** Bumped by every catalogue write; stamped into every value key. */
const GENERATION_KEY = `${PREFIX}:generation`;

/**
 * Stable identity for a set of parameters.
 *
 * Keys are sorted before hashing so that `{a, b}` and `{b, a}` - the same
 * query written two ways - resolve to the same entry instead of two.
 * Truncated because a collision needs the same resource AND the same cinema
 * AND the same generation; 16 hex characters is far past what that requires.
 */
function fingerprint(params) {
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

/** Current generation, or 0 when unset/unreachable - both mean "start fresh". */
async function currentGeneration() {
  const raw = await redis.getRaw(GENERATION_KEY);
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildKey(generation, resource, cinemaId, params) {
  return `${PREFIX}:g${generation}:${resource}:${cinemaId}:${fingerprint(params)}`;
}

/**
 * Read-through: serve from cache, else run `produce` and store what it returns.
 *
 * Only a RESOLVED value is stored. A thrown NotFoundError - an unknown or
 * deactivated cinema - is passed straight through and never cached, so
 * activating a cinema takes effect immediately instead of after a TTL, and a
 * transient database failure cannot be frozen into a cached error.
 *
 * `undefined` is likewise not stored: it is indistinguishable from a miss once
 * it has been through JSON, so caching it would guarantee a miss every time.
 */
async function wrap(resource, cinemaId, params, produce) {
  if (!redis.isEnabled()) return produce();

  const generation = await currentGeneration();
  const key = buildKey(generation, resource, cinemaId, params);

  const hit = await redis.get(key);
  if (hit !== null) return hit;

  const value = await produce();
  if (value !== undefined) await redis.set(key, value, env.redis.ttlSeconds);

  return value;
}

/**
 * Drop every cached catalogue response.
 *
 * Call after any write that could change what the consumer catalogue returns.
 * Awaiting it is optional and usually pointless - see the wrappers in the
 * write services, which deliberately do not let this delay a response.
 */
async function invalidateCatalogue() {
  if (!redis.isEnabled()) return;
  await redis.increment(GENERATION_KEY);
}

/**
 * Wrap a write so the catalogue cache is dropped once it succeeds.
 *
 * Applied at each write service's export boundary rather than inside its
 * functions, which keeps the business logic free of cache bookkeeping and puts
 * every invalidation point in one visible list per file.
 *
 * Only AFTER the write resolves: a create that fails validation has changed
 * nothing, and flushing on the way in would throw away a warm cache for
 * requests that never happened.
 *
 * The bump is AWAITED on purpose. Fire-and-forget would let the HTTP response
 * beat the INCR, so a dashboard that saves and immediately refetches could be
 * answered from the generation it just invalidated - exactly the "I saved it
 * and it still shows the old value" bug. One INCR is sub-millisecond, and when
 * Redis is unreachable it gives up after REDIS_TIMEOUT_MS rather than hanging.
 */
function invalidatingAfter(fn) {
  return async (...args) => {
    const result = await fn(...args);
    await invalidateCatalogue();
    return result;
  };
}

module.exports = {
  wrap,
  invalidateCatalogue,
  invalidatingAfter,
  // Exported for tests and diagnostics, not for callers to build keys with.
  buildKey,
  fingerprint,
  GENERATION_KEY,
};
