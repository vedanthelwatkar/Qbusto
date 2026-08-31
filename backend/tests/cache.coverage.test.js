'use strict';

/**
 * The two questions a cache gets wrong in production, asked statically:
 *
 *   - Did a write that CHANGES the catalogue forget to invalidate it?
 *   - Did something that must never be cached get wired into the cache?
 *
 * Both are answered by reading the service sources rather than by exercising
 * them, because the failure mode is an omission - and you cannot write a
 * behavioural test for a call somebody forgot to make. The classification
 * below is exhaustive: a NEW service with mutating exports fails the last test
 * in this file until it is deliberately placed in one list or the other.
 *
 * This is not hypothetical. Reviewing against this list is what surfaced
 * availability.service and screen.service, both of which change cached
 * catalogue output and neither of which was invalidating.
 */

const fs = require('fs');
const path = require('path');

const SERVICES_DIR = path.join(__dirname, '..', 'src', 'services');

/**
 * Writes that change what the PUBLIC consumer catalogue returns. Every one of
 * these must drop the cache.
 */
const CATALOGUE_WRITERS = {
  'product.service.js': 'products are the catalogue',
  'category.service.js': 'categories are the catalogue',
  'banner.service.js': 'getBanners is cached',
  'cinemaproduct.service.js': 'decides which products a cinema carries',
  'pricing.service.js': 'prices and per-source discounts are in the payload',
  'cinema.service.js': 'getCinema is cached (name, city, screensaverUrl)',
  'screen.service.js': 'getScreen is cached',
  'availability.service.js':
    'serving hours decide whether a product is shown at all - both cached ' +
    'product reads eager-load availabilityHours and pricing.unavailableReason ' +
    'filters on them',
};

/**
 * Services whose writes cannot change the catalogue. These must NOT touch the
 * cache at all - the reason matters as much as the entry, because a wrong
 * reason here is how a real invalidation gap gets waved through.
 */
const NON_CATALOGUE_WRITERS = {
  'chain.service.js': 'chains never appear in any consumer catalogue response',
  'user.service.js': 'staff accounts are not catalogue data',
  'offer.service.js':
    'coupons are evaluated at order time, never in a catalogue response - ' +
    'getProducts returns product_pricing, not offers',
  'order.service.js': 'orders are not catalogue data',
  'fulfilment.service.js': 'order status transitions',
  'kitchen.service.js': 'order status transitions',
  'paymentwebhook.service.js': 'payments',
  'upload.service.js':
    'deletes a file from disk; the URL column that references it is written ' +
    'through product/banner/category, which do invalidate',
};

/**
 * The one file that is both sides at once: it owns the cached catalogue reads
 * AND the order path. It cannot be asserted like either list above, so it has
 * its own dedicated test ("consumer.service caches reads but never wraps its
 * write path") and is named here only so the completeness guard knows it was
 * considered rather than forgotten.
 */
const SPECIAL_CASES = {
  'consumer.service.js': 'cached read side and the order write path in one module',
};

/** Exported names that indicate a service mutates something. */
const MUTATION_PREFIXES =
  /^ {2}(create|update|deactivate|delete|apply|transition|verify|init)[A-Za-z]*/gm;

function read(file) {
  return fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8');
}

function exportBlock(source) {
  const match = source.match(/^module\.exports = \{[\s\S]*?^\};/m);
  return match ? match[0] : '';
}

function mutatingExports(source) {
  const block = exportBlock(source);
  const names = block.match(MUTATION_PREFIXES) || [];
  return names.map((n) => n.trim());
}

function serviceFiles() {
  return fs.readdirSync(SERVICES_DIR).filter((f) => f.endsWith('.service.js'));
}

// ---------------------------------------------------------------------------
// 2. Every catalogue write invalidates
// ---------------------------------------------------------------------------

describe('2. every catalogue write increments the generation', () => {
  it.each(Object.entries(CATALOGUE_WRITERS))('%s invalidates (%s)', (file) => {
    const source = read(file);

    expect(source).toContain("require('./cache.service')");

    // Every mutating export must be wrapped, not just some of them: a
    // service that invalidates on create but not on update is the subtler
    // and more dangerous half-fix.
    for (const fn of mutatingExports(source)) {
      expect(exportBlock(source)).toContain(`${fn}: cache.invalidatingAfter(${fn})`);
    }
  });

  it('wraps every mutating export across all catalogue writers', () => {
    const unwrapped = [];

    for (const file of Object.keys(CATALOGUE_WRITERS)) {
      const source = read(file);
      const block = exportBlock(source);
      for (const fn of mutatingExports(source)) {
        if (!block.includes(`${fn}: cache.invalidatingAfter(${fn})`)) {
          unwrapped.push(`${file}:${fn}`);
        }
      }
    }

    expect(unwrapped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Nothing that must not be cached went near the cache
// ---------------------------------------------------------------------------

describe('9. the cache is kept away from everything else', () => {
  it.each(Object.entries(NON_CATALOGUE_WRITERS))('%s does not touch the cache (%s)', (file) => {
    expect(read(file)).not.toContain("require('./cache.service')");
  });

  /**
   * consumer.service is the one file that legitimately requires the cache -
   * it IS the cached read side - so it cannot be asserted the same way. What
   * matters here is the opposite direction: its order path must not have been
   * swept up in the invalidation wrapping applied to the write services.
   */
  it('consumer.service caches reads but never wraps its write path', () => {
    const block = exportBlock(read('consumer.service.js'));

    expect(block).not.toContain('invalidatingAfter');
    expect(block).toContain('createOrder,');
  });

  it('caches exactly the six public catalogue reads, and nothing else', () => {
    const consumerService = require('../src/services/consumer.service');

    // The wrappers are named, so the export's identity tells us whether it is
    // the cached form or the raw query - no behaviour needs to be exercised.
    const cached = {
      getCinema: 'getCinemaCached',
      getScreen: 'getScreenCached',
      getCategories: 'getCategoriesCached',
      getProducts: 'getProductsCached',
      getProductDetail: 'getProductDetailCached',
      getBanners: 'getBannersCached',
    };

    for (const [exported, wrapperName] of Object.entries(cached)) {
      expect(consumerService[exported].name).toBe(wrapperName);
    }

    // The order, payment, coupon and session paths must be the raw functions.
    const uncached = [
      'getSessions',
      'createOrder',
      'validateCouponPreview',
      'paymentInit',
      'paymentVerify',
    ];

    for (const exported of uncached) {
      expect(consumerService[exported].name).toBe(exported);
    }
  });

  it('leaves the kitchen board uncached - it exists to be current', () => {
    expect(read('kitchen.service.js')).not.toContain('cache.service');
  });

  it('never caches a product search, whose keys are unbounded', () => {
    const source = read('consumer.service.js');

    // The early return is the guard; assert it precedes the cache.wrap call
    // inside getProductsCached rather than merely existing somewhere.
    const fn = source.match(/function getProductsCached[\s\S]*?\n}/)[0];
    expect(fn).toContain('if (options.search) return getProducts(cinemaId, options);');
    expect(fn.indexOf('options.search')).toBeLessThan(fn.indexOf('cache.wrap'));
  });
});

// ---------------------------------------------------------------------------
// The completeness guard
// ---------------------------------------------------------------------------

describe('classification is exhaustive', () => {
  it('every service with mutating exports is deliberately classified', () => {
    const unclassified = serviceFiles().filter((file) => {
      if (CATALOGUE_WRITERS[file] || NON_CATALOGUE_WRITERS[file] || SPECIAL_CASES[file]) {
        return false;
      }
      return mutatingExports(read(file)).length > 0;
    });

    // A new write service must be placed in one list or the other, with a
    // reason. Failing here is the point: it forces the question "can this
    // change what the consumer catalogue returns?" to be answered once,
    // rather than discovered as a stale-catalogue bug in production.
    expect(unclassified).toEqual([]);
  });

  it('no service appears in more than one list', () => {
    const all = [
      ...Object.keys(CATALOGUE_WRITERS),
      ...Object.keys(NON_CATALOGUE_WRITERS),
      ...Object.keys(SPECIAL_CASES),
    ];
    expect(all.length).toBe(new Set(all).size);
  });
});
