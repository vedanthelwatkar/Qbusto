'use strict';

/**
 * The caching layer's two promises:
 *
 *   1. With no REDIS_URL it is completely inert - every call reaches the
 *      producer, nothing is stored, and no connection is opened. This is what
 *      the whole test suite depends on, and what a deployment relies on to
 *      turn caching off without a code change.
 *   2. With Redis available it is a read-through cache whose entries stop
 *      being reachable the moment a catalogue write bumps the generation.
 *
 * Redis is faked rather than run for real: these assert THIS module's logic -
 * key construction, generation stamping, what is and is not stored - not that
 * ioredis can talk to a server.
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

/** An in-memory stand-in, wired through the mocked client. */
function useFakeRedis() {
  const store = new Map();
  redis.isEnabled.mockReturnValue(true);
  redis.getRaw.mockImplementation(async (key) => store.get(key) ?? null);
  redis.get.mockImplementation(async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null));
  redis.set.mockImplementation(async (key, value) => {
    store.set(key, JSON.stringify(value));
  });
  redis.increment.mockImplementation(async (key) => {
    const next = Number.parseInt(store.get(key) ?? '0', 10) + 1;
    store.set(key, String(next));
    return next;
  });
  return store;
}

describe('cache disabled (no REDIS_URL)', () => {
  beforeEach(() => {
    redis.isEnabled.mockReturnValue(false);
  });

  it('calls the producer every time and never touches Redis', async () => {
    const produce = jest.fn().mockResolvedValue({ id: 1 });

    await cache.wrap('cinema', 8, {}, produce);
    await cache.wrap('cinema', 8, {}, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('makes invalidation a no-op rather than an error', async () => {
    await expect(cache.invalidateCatalogue()).resolves.toBeUndefined();
    expect(redis.increment).not.toHaveBeenCalled();
  });
});

describe('cache enabled', () => {
  beforeEach(() => {
    useFakeRedis();
  });

  it('runs the producer once, then serves the stored value', async () => {
    const produce = jest.fn().mockResolvedValue({ id: 1, name: 'NOIDA' });

    const first = await cache.wrap('cinema', 8, {}, produce);
    const second = await cache.wrap('cinema', 8, {}, produce);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ id: 1, name: 'NOIDA' });
    expect(second).toEqual(first);
  });

  it('keeps different cinemas apart', async () => {
    const eight = jest.fn().mockResolvedValue('eight');
    const nine = jest.fn().mockResolvedValue('nine');

    expect(await cache.wrap('cinema', 8, {}, eight)).toBe('eight');
    expect(await cache.wrap('cinema', 9, {}, nine)).toBe('nine');
    // The second cinema must not have been answered from the first's entry.
    expect(nine).toHaveBeenCalledTimes(1);
  });

  it('keeps different parameters apart', async () => {
    const pageOne = jest.fn().mockResolvedValue('p1');
    const pageTwo = jest.fn().mockResolvedValue('p2');

    expect(await cache.wrap('products', 8, { page: 1 }, pageOne)).toBe('p1');
    expect(await cache.wrap('products', 8, { page: 2 }, pageTwo)).toBe('p2');
    expect(pageTwo).toHaveBeenCalledTimes(1);
  });

  it('treats the same parameters written in a different order as one entry', async () => {
    const produce = jest.fn().mockResolvedValue('same');

    await cache.wrap('products', 8, { limit: 20, page: 1 }, produce);
    await cache.wrap('products', 8, { page: 1, limit: 20 }, produce);

    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('stops serving an entry once the catalogue is invalidated', async () => {
    const produce = jest.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after');

    expect(await cache.wrap('products', 8, {}, produce)).toBe('before');
    expect(await cache.wrap('products', 8, {}, produce)).toBe('before');

    await cache.invalidateCatalogue();

    expect(await cache.wrap('products', 8, {}, produce)).toBe('after');
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('does not cache a thrown error, so a 404 is re-evaluated every time', async () => {
    const produce = jest.fn().mockRejectedValue(new Error('Cinema not found'));

    await expect(cache.wrap('cinema', 99, {}, produce)).rejects.toThrow('Cinema not found');
    await expect(cache.wrap('cinema', 99, {}, produce)).rejects.toThrow('Cinema not found');

    expect(produce).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('does not store undefined, which would be indistinguishable from a miss', async () => {
    const produce = jest.fn().mockResolvedValue(undefined);

    await cache.wrap('cinema', 8, {}, produce);
    await cache.wrap('cinema', 8, {}, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('serves from the database when a cache read fails', async () => {
    // A dead Redis reports a miss (see config/redis.js), so the request is
    // answered correctly - just without the speed-up.
    redis.get.mockResolvedValue(null);
    redis.getRaw.mockResolvedValue(null);
    const produce = jest.fn().mockResolvedValue('from-db');

    expect(await cache.wrap('cinema', 8, {}, produce)).toBe('from-db');
  });
});

describe('invalidatingAfter', () => {
  beforeEach(() => {
    useFakeRedis();
  });

  it('invalidates only after the write resolves, and passes the result through', async () => {
    const order = [];
    redis.increment.mockImplementation(async () => {
      order.push('invalidate');
      return 1;
    });
    const write = jest.fn(async () => {
      order.push('write');
      return { id: 7 };
    });

    const wrapped = cache.invalidatingAfter(write);
    await expect(wrapped('actor', { name: 'x' })).resolves.toEqual({ id: 7 });

    expect(write).toHaveBeenCalledWith('actor', { name: 'x' });
    expect(order).toEqual(['write', 'invalidate']);
  });

  it('does not invalidate when the write throws', async () => {
    const write = jest.fn().mockRejectedValue(new Error('validation failed'));

    await expect(cache.invalidatingAfter(write)('a')).rejects.toThrow('validation failed');
    expect(redis.increment).not.toHaveBeenCalled();
  });
});
