'use strict';

/**
 * Which consumer service calls are wired through the cache, and which are
 * deliberately not.
 *
 * The point of these is the WIRING, not the caching mechanics (covered in
 * cache.service.test.js). A future refactor that drops a wrapper - or adds one
 * to the order or session path, where it would be actively wrong - fails here.
 */

jest.mock('../src/services/cache.service', () => ({
  wrap: jest.fn((resource, cinemaId, params, produce) => produce()),
  invalidateCatalogue: jest.fn().mockResolvedValue(undefined),
  invalidatingAfter: jest.fn((fn) => fn),
}));

jest.mock('../src/config/database', () => ({
  models: {
    Cinema: { findByPk: jest.fn(), findOne: jest.fn() },
    Screen: { findOne: jest.fn(), findAll: jest.fn() },
    Product: { findAll: jest.fn(), findOne: jest.fn() },
    CinemaProduct: { findAll: jest.fn() },
    ProductPricing: { findAll: jest.fn() },
    ProductAvailabilityHour: { findAll: jest.fn() },
    Category: { findAll: jest.fn(), findOne: jest.fn() },
    Banner: { findAll: jest.fn() },
    Session: { findAll: jest.fn() },
    Order: { findOne: jest.fn(), create: jest.fn() },
  },
  sequelize: {
    transaction: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
    literal: jest.fn(),
    fn: jest.fn(),
    col: jest.fn(),
    QueryTypes: { SELECT: 'SELECT' },
  },
}));

const cache = require('../src/services/cache.service');
const { models } = require('../src/config/database');
const consumerService = require('../src/services/consumer.service');

const CINEMA = { id: 8, name: 'NOIDA', code: 'NOIDA' };

beforeEach(() => {
  models.Cinema.findByPk.mockResolvedValue(CINEMA);
});

describe('catalogue reads go through the cache', () => {
  it('getCinema is wrapped, keyed by the cinema', async () => {
    await consumerService.getCinema(8);

    expect(cache.wrap).toHaveBeenCalledWith('cinema', 8, {}, expect.any(Function));
  });

  it('getBanners keys on the banner type, which changes the answer', async () => {
    models.Banner.findAll.mockResolvedValue([]);

    await consumerService.getBanners(8, 'hero');

    expect(cache.wrap).toHaveBeenCalledWith('banners', 8, { type: 'hero' }, expect.any(Function));
  });

  it('getCategories keys on the page and limit', async () => {
    models.Category.findAll.mockResolvedValue([]);
    models.Product.findAll.mockResolvedValue([]);

    await consumerService.getCategories(8, 20, 2);

    expect(cache.wrap).toHaveBeenCalledWith(
      'categories',
      8,
      { limit: 20, page: 2 },
      expect.any(Function)
    );
  });
});

describe('what the cache is deliberately kept away from', () => {
  it('does not cache a product SEARCH - unbounded keys, no reuse', async () => {
    models.Product.findAll.mockResolvedValue([]);

    await consumerService.getProducts(8, { search: 'popcorn', limit: 20, page: 1 });

    expect(cache.wrap).not.toHaveBeenCalled();
  });

  it('still caches a product listing with no search term', async () => {
    models.Product.findAll.mockResolvedValue([]);

    await consumerService.getProducts(8, { categoryId: 3, limit: 20, page: 1 });

    // `source` is part of the key and defaults to 'qr' when the caller omits
    // it. The listing prices per channel, so a key without it would serve one
    // channel's prices to every other one - see consumer.pricing.source.test.js.
    expect(cache.wrap).toHaveBeenCalledWith(
      'products',
      8,
      { categoryId: 3, limit: 20, page: 1, source: 'qr' },
      expect.any(Function)
    );
  });

  it('carries the caller source into the key, normalised', async () => {
    models.Product.findAll.mockResolvedValue([]);

    await consumerService.getProducts(8, {
      categoryId: 3,
      limit: 20,
      page: 1,
      source: 'SEAT_QR',
      seat: 'A5',
    });

    expect(cache.wrap).toHaveBeenCalledWith(
      'products',
      8,
      { categoryId: 3, limit: 20, page: 1, source: 'seat_qr' },
      expect.any(Function)
    );
  });

  /**
   * The key must carry the source that was DERIVED, not the one that was
   * asked for. A seat_qr claim with no seat is priced at the lobby rate
   * (pricing.service.deriveSource), so filing that payload under `seat_qr`
   * would hand it to the next request that did name a seat.
   */
  it('keys a seatless seat_qr claim under qr, the rate it was actually served', async () => {
    models.Product.findAll.mockResolvedValue([]);

    await consumerService.getProducts(8, { categoryId: 3, limit: 20, page: 1, source: 'seat_qr' });

    expect(cache.wrap).toHaveBeenCalledWith(
      'products',
      8,
      { categoryId: 3, limit: 20, page: 1, source: 'qr' },
      expect.any(Function)
    );
  });

  it('does not cache getSessions - its answer is relative to now', async () => {
    models.Session.findAll.mockResolvedValue([]);
    models.Screen.findAll.mockResolvedValue([]);

    await consumerService.getSessions(8);

    expect(cache.wrap).not.toHaveBeenCalled();
  });
});

describe('catalogue writes drop the cache', () => {
  it.each([
    ['product.service', 'createProduct'],
    ['product.service', 'updateProduct'],
    ['product.service', 'deactivateProduct'],
    ['category.service', 'createCategory'],
    ['banner.service', 'updateBanner'],
    ['cinemaproduct.service', 'createCinemaProduct'],
    ['pricing.service', 'updatePricing'],
    ['cinema.service', 'updateCinema'],
  ])('%s.%s is wrapped in invalidatingAfter', (moduleName, fnName) => {
    // Requiring the module runs its export block, which is where the wrapping
    // happens - so the assertion is that the wrapper was applied at all.
    jest.isolateModules(() => {
      require(`../src/services/${moduleName}`);
    });

    const wrappedNames = cache.invalidatingAfter.mock.calls.map(([fn]) => fn.name);
    expect(wrappedNames).toContain(fnName);
  });
});
