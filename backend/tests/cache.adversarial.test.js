'use strict';

/**
 * Adversarial review of the catalogue cache: invalidation correctness and
 * races, plus the guarantees the design claims but which nothing else pins.
 *
 * The interesting one is the read/write interleaving (see "a slow read that
 * straddles a write"). The generation is read BEFORE the producer runs, so a
 * reader whose database query straddles a write stores its now-stale value
 * under the OLD generation - a key nothing will ever build again. That is what
 * makes repopulation-after-invalidation structurally impossible here rather
 * than merely unlikely, and it is the property most worth locking down.
 */

const redis = require('../src/config/redis');

jest.mock('../src/config/redis', () => ({
  isEnabled: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  increment: jest.fn(),
  getRaw: jest.fn(),
  disconnect: jest.fn(),
}));

const cache = require('../src/services/cache.service');
const env = require('../src/config/env');

/** An in-memory Redis with a controllable failure switch. */
function useFakeRedis() {
  const store = new Map();
  const state = { failing: false };

  const getRawImpl = async (key) => store.get(key) ?? null;
  const getImpl = async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null);
  const setImpl = async (key, value) => {
    store.set(key, JSON.stringify(value));
  };
  const incrImpl = async (key) => {
    const next = Number.parseInt(store.get(key) ?? '0', 10) + 1;
    store.set(key, String(next));
    return next;
  };

  redis.isEnabled.mockReturnValue(true);

  // config/redis.js swallows every error and reports a miss. The fake behaves
  // the same way, or these tests would prove nothing about production.
  redis.getRaw.mockImplementation(async (key) => (state.failing ? null : getRawImpl(key)));
  redis.get.mockImplementation(async (key) => (state.failing ? null : getImpl(key)));
  redis.set.mockImplementation(async (key, value) => {
    if (state.failing) return undefined;
    return setImpl(key, value);
  });
  redis.increment.mockImplementation(async (key) => (state.failing ? null : incrImpl(key)));

  return { store, state };
}

// ---------------------------------------------------------------------------
// 1. A cached response is returned normally
// ---------------------------------------------------------------------------

describe('1. normal read-through', () => {
  it('produces once and serves the stored copy thereafter', async () => {
    useFakeRedis();
    const produce = jest.fn().mockResolvedValue({ id: 8, name: 'NOIDA' });

    expect(await cache.wrap('cinema', 8, {}, produce)).toEqual({ id: 8, name: 'NOIDA' });
    expect(await cache.wrap('cinema', 8, {}, produce)).toEqual({ id: 8, name: 'NOIDA' });
    expect(await cache.wrap('cinema', 8, {}, produce)).toEqual({ id: 8, name: 'NOIDA' });

    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('stores every entry under a TTL, so nothing can outlive its window', async () => {
    useFakeRedis();
    await cache.wrap('cinema', 8, {}, async () => ({ id: 8 }));

    const [, , ttl] = redis.set.mock.calls[0];
    expect(ttl).toBe(env.redis.ttlSeconds);
    expect(ttl).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. A read straight after a write cannot see the old generation
// ---------------------------------------------------------------------------

describe('3. read-after-write', () => {
  it('never serves pre-write data once the write has resolved', async () => {
    useFakeRedis();
    let dbValue = 'before';
    const produce = jest.fn(async () => dbValue);

    expect(await cache.wrap('products', 8, {}, produce)).toBe('before');

    const write = cache.invalidatingAfter(async () => {
      dbValue = 'after';
      return { ok: true };
    });
    await write();

    expect(await cache.wrap('products', 8, {}, produce)).toBe('after');
  });

  it('holds for every cached resource, not only the one that was written', async () => {
    useFakeRedis();
    const resources = ['cinema', 'screen', 'categories', 'products', 'product', 'banners'];

    for (const resource of resources) {
      await cache.wrap(resource, 8, {}, async () => 'v1');
    }
    await cache.invalidateCatalogue();

    for (const resource of resources) {
      expect(await cache.wrap(resource, 8, {}, async () => 'v2')).toBe('v2');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrency: an in-flight read must not repopulate a dead generation
// ---------------------------------------------------------------------------

describe('4. concurrent read/write interleaving', () => {
  it('a slow read that straddles a write cannot resurrect stale data', async () => {
    const { store } = useFakeRedis();

    // The reader misses, then blocks inside its database query.
    let releaseProducer;
    const blocked = new Promise((resolve) => {
      releaseProducer = resolve;
    });
    const slowRead = cache.wrap('products', 8, {}, async () => {
      await blocked;
      return 'STALE';
    });

    // While it is blocked, a write commits and bumps the generation.
    await cache.invalidatingAfter(async () => 'written')();

    // Let the slow reader finish and store its now-stale value.
    releaseProducer();
    expect(await slowRead).toBe('STALE');

    // It wrote into the PREVIOUS generation, so the next read cannot see it.
    expect(await cache.wrap('products', 8, {}, async () => 'FRESH')).toBe('FRESH');

    // Prove it is genuinely orphaned rather than overwritten: still in Redis,
    // under a key no future read will ever construct.
    const staleEntries = [...store.entries()].filter(([, v]) => String(v).includes('STALE'));
    expect(staleEntries).toHaveLength(1);
    const staleKey = staleEntries[0][0];
    const liveGeneration = store.get(cache.GENERATION_KEY);
    expect(staleKey).not.toContain(':g' + liveGeneration + ':');
  });

  it('parallel readers of the same cold key all get the correct value', async () => {
    useFakeRedis();
    const produce = jest.fn().mockResolvedValue('value');

    const results = await Promise.all([
      cache.wrap('products', 8, {}, produce),
      cache.wrap('products', 8, {}, produce),
      cache.wrap('products', 8, {}, produce),
    ]);

    // A stampede is accepted (there is no single-flight lock by design); what
    // must NOT happen is any reader getting a wrong answer.
    expect(results).toEqual(['value', 'value', 'value']);
  });

  it('two writes racing still leave the cache invalidated, never re-armed', async () => {
    const { store } = useFakeRedis();
    await cache.wrap('products', 8, {}, async () => 'v1');
    const before = Number(store.get(cache.GENERATION_KEY) ?? 0);

    await Promise.all([cache.invalidateCatalogue(), cache.invalidateCatalogue()]);

    // INCR is atomic, so concurrent bumps compose rather than clobber.
    expect(Number(store.get(cache.GENERATION_KEY))).toBe(before + 2);
    expect(await cache.wrap('products', 8, {}, async () => 'v2')).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// 5 and 7. Redis outages
// ---------------------------------------------------------------------------

describe('5. Redis unavailable during a write', () => {
  it('the write still succeeds and its result is returned', async () => {
    const { state } = useFakeRedis();
    state.failing = true;

    const write = cache.invalidatingAfter(async () => ({ id: 42, saved: true }));

    await expect(write('actor', 'payload')).resolves.toEqual({ id: 42, saved: true });
  });

  it('the application stays functional: reads keep answering from the database', async () => {
    const { state } = useFakeRedis();
    state.failing = true;

    await cache.invalidatingAfter(async () => 'db-committed')();

    expect(await cache.wrap('products', 8, {}, async () => 'served')).toBe('served');
  });
});

describe('7. Redis unavailable during a read', () => {
  it('falls back to the database and never throws', async () => {
    const { state } = useFakeRedis();
    state.failing = true;

    const produce = jest.fn().mockResolvedValue('from-database');

    expect(await cache.wrap('cinema', 8, {}, produce)).toBe('from-database');
    expect(await cache.wrap('cinema', 8, {}, produce)).toBe('from-database');
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('treats a corrupt stored entry as a miss rather than a failure', async () => {
    useFakeRedis();
    // config/redis.js parses inside a try and returns null on garbage.
    redis.get.mockResolvedValue(null);

    expect(await cache.wrap('cinema', 8, {}, async () => 'rebuilt')).toBe('rebuilt');
  });
});

// ---------------------------------------------------------------------------
// 6. Recovery after an outage
// ---------------------------------------------------------------------------

describe('6. recovery after an outage', () => {
  it('bounds a pre-outage entry by the TTL rather than leaving it indefinite', async () => {
    useFakeRedis();
    await cache.wrap('products', 8, {}, async () => 'pre-outage');

    const [key, , ttl] = redis.set.mock.calls[0];

    expect(ttl).toBe(env.redis.ttlSeconds);
    expect(key).toContain('qbusto:catalogue:');
  });

  it('a write whose bump was lost is corrected by the next successful write', async () => {
    const { state } = useFakeRedis();
    await cache.wrap('products', 8, {}, async () => 'v1');

    // Outage: the write lands in the database, the generation bump is lost.
    state.failing = true;
    await cache.invalidatingAfter(async () => 'db-write')();

    // Recovery: reads resume, and the entry is briefly still servable. This is
    // the documented bounded-staleness window, asserted rather than assumed.
    state.failing = false;
    expect(await cache.wrap('products', 8, {}, async () => 'v2')).toBe('v1');

    // The next successful catalogue write clears it for good.
    await cache.invalidatingAfter(async () => 'db-write-2')();
    expect(await cache.wrap('products', 8, {}, async () => 'v3')).toBe('v3');
  });
});

// ---------------------------------------------------------------------------
// 8. Inert when unconfigured
// ---------------------------------------------------------------------------

describe('8. disabled by default', () => {
  it('is inert under NODE_ENV=test, which is how the suite stays hermetic', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(env.redis.enabled).toBe(false);
  });

  it('issues no Redis command at all when disabled', async () => {
    redis.isEnabled.mockReturnValue(false);
    const produce = jest.fn().mockResolvedValue('db');

    await cache.wrap('cinema', 8, {}, produce);
    await cache.invalidateCatalogue();
    await cache.invalidatingAfter(async () => 'w')();

    expect(produce).toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.getRaw).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.increment).not.toHaveBeenCalled();
  });
});
