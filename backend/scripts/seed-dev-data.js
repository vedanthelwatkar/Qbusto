#!/usr/bin/env node
'use strict';

/**
 * seed-dev-data
 *
 * Builds a small but complete sample cinema deployment so the dashboard has
 * something realistic to page, search, sort, filter and edit. Development only.
 *
 * Every row is written through the ordinary services - chain.service,
 * product.service, availability.service and the rest - with a synthetic owner
 * actor. Nothing here inserts raw SQL, skips a model hook or sets a foreign key
 * it has not just read back, so data that lands in the database is data the API
 * itself would have accepted. If a business rule changes, this script starts
 * failing rather than quietly producing rows the API would now reject.
 *
 * It does not create, modify or delete a single user. The actor it passes
 * carries `id: null`, so created_by and updated_by stay NULL - honest, because
 * no user did create these rows.
 *
 * OWNERSHIP AND REPEATABILITY
 *
 * The seed owns the chains named in seed-dev-dataset and everything beneath
 * them. Re-running deletes those chains and their descendants and rebuilds
 * from scratch, so it is idempotent in the sense that matters: running it twice
 * leaves exactly what running it once leaves. Nothing outside those chains is
 * read for deletion, and if anything the seed does not own points into them -
 * a user scoped to a seed chain, an order against a seed cinema - the run
 * aborts and changes nothing rather than deleting its way through.
 *
 * Usage:
 *   npm run seed:dev
 *   npm run seed:dev -- --skip-verify
 *
 * Exits 0 on success, 1 on failure.
 */

const path = require('path');

// Resolved against this file rather than the working directory, for the same
// reason create-dev-user does it: running from backend/ and from backend/scripts
// must both find the same .env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Op } = require('sequelize');

const { sequelize, models } = require('../src/config/database');
const { ROLES } = require('../src/constants');

const availabilityService = require('../src/services/availability.service');
const bannerService = require('../src/services/banner.service');
const categoryService = require('../src/services/category.service');
const chainService = require('../src/services/chain.service');
const cinemaProductService = require('../src/services/cinemaproduct.service');
const cinemaService = require('../src/services/cinema.service');
const pricingService = require('../src/services/pricing.service');
const productService = require('../src/services/product.service');
const screenService = require('../src/services/screen.service');

const dataset = require('./seed-dev-dataset');

const OK = '✓';
const FAIL = '✗';

/**
 * The actor every service call is made as.
 *
 * `role: 'owner'` because the seed writes across several chains and only an
 * owner may do that. `id: null` because no user is involved: the services copy
 * it into created_by/updated_by, both of which are nullable, so the rows record
 * that nobody created them rather than blaming a real account.
 */
const SEED_ACTOR = { id: null, role: ROLES.OWNER, chainId: null };

/** Resolved ids, keyed by the slugs the dataset refers to each other with. */
const ids = {
  chains: new Map(),
  cinemas: new Map(),
  categories: new Map(),
  products: new Map(),
  cinemaProducts: new Map(),
};

let failures = 0;

function fail(message, detail) {
  failures += 1;
  console.error(`  ${FAIL} ${message}${detail ? `\n      ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * The chains this seed owns.
 *
 * Matched on the marker in the logo URL *or* the exact name, so a chain whose
 * logo has been edited in the dashboard is still recognised as the seed's own
 * and does not become an orphan that blocks the next run on the name check.
 */
async function findSeedChains() {
  return models.Chain.findAll({
    where: {
      [Op.or]: [
        { logoImageUrl: { [Op.like]: `%${dataset.SEED_MARKER}%` } },
        { name: { [Op.in]: dataset.CHAINS.map((chain) => chain.name) } },
      ],
    },
    attributes: ['id', 'name'],
  });
}

const idsOf = (rows) => rows.map((row) => row.id);

/**
 * Rows that point into the seed's chains but are not the seed's to remove.
 *
 * Every one of these would turn a delete into a foreign-key error, and each is
 * something a person put there. Reporting them and stopping is the only safe
 * answer - in particular a user must never be deleted to make a seed run.
 */
async function findBlockers(chainIds, cinemaIds, productIds) {
  const counts = {
    'users scoped to a seeded chain or cinema': await models.User.count({
      where: {
        [Op.or]: [
          { chainId: { [Op.in]: chainIds } },
          ...(cinemaIds.length ? [{ cinemaId: { [Op.in]: cinemaIds } }] : []),
        ],
      },
    }),
    'orders against a seeded cinema': cinemaIds.length
      ? await models.Order.count({ where: { cinemaId: { [Op.in]: cinemaIds } } })
      : 0,
    'order items against a seeded product': productIds.length
      ? await models.OrderItem.count({ where: { productId: { [Op.in]: productIds } } })
      : 0,
    'POS mappings against a seeded product': productIds.length
      ? await models.ProductPosMapping.count({ where: { productId: { [Op.in]: productIds } } })
      : 0,
    'POS integrations on a seeded cinema': cinemaIds.length
      ? await models.PosIntegration.count({ where: { cinemaId: { [Op.in]: cinemaIds } } })
      : 0,
    'payment gateway configs on a seeded cinema': cinemaIds.length
      ? await models.PaymentGatewayConfig.count({ where: { cinemaId: { [Op.in]: cinemaIds } } })
      : 0,
    'cinema categories on a seeded cinema': cinemaIds.length
      ? await models.CinemaCategory.count({ where: { cinemaId: { [Op.in]: cinemaIds } } })
      : 0,
  };

  return Object.entries(counts).filter(([, count]) => count > 0);
}

async function purge() {
  const chains = await findSeedChains();

  if (chains.length === 0) {
    console.log('  nothing to remove - this is a first run');
    return;
  }

  const chainIds = idsOf(chains);
  const cinemaIds = idsOf(
    await models.Cinema.findAll({ where: { chainId: chainIds }, attributes: ['id'] })
  );
  const productIds = idsOf(
    await models.Product.findAll({ where: { chainId: chainIds }, attributes: ['id'] })
  );

  const blockers = await findBlockers(chainIds, cinemaIds, productIds);

  if (blockers.length > 0) {
    const lines = blockers.map(([what, count]) => `      ${count} ${what}`).join('\n');

    throw new Error(
      'Refusing to remove the previous sample data - rows the seed does not own point at it:\n' +
        `${lines}\n` +
        '      Nothing has been changed. Remove or re-point those rows and run again.'
    );
  }

  const linkIds = idsOf(
    await models.CinemaProduct.findAll({
      where: {
        [Op.or]: [
          ...(cinemaIds.length ? [{ cinemaId: { [Op.in]: cinemaIds } }] : []),
          ...(productIds.length ? [{ productId: { [Op.in]: productIds } }] : []),
        ],
      },
      attributes: ['id'],
    })
  );

  // Children first, all the way down.
  if (linkIds.length) {
    await models.ProductAvailabilityHour.destroy({ where: { cinemaProductId: linkIds } });
    await models.CinemaProduct.destroy({ where: { id: linkIds } });
  }

  if (cinemaIds.length || productIds.length) {
    await models.ProductPricing.destroy({
      where: {
        [Op.or]: [
          ...(cinemaIds.length ? [{ cinemaId: { [Op.in]: cinemaIds } }] : []),
          ...(productIds.length ? [{ productId: { [Op.in]: productIds } }] : []),
        ],
      },
    });
  }

  if (cinemaIds.length) {
    await models.Banner.destroy({ where: { cinemaId: cinemaIds } });
    await models.Screen.destroy({ where: { cinemaId: cinemaIds } });
  }

  if (productIds.length) {
    // Add-ons before their parents: products self-reference through
    // addon_parent_id, so deleting the whole set in one statement can trip the
    // constraint depending on the order the rows happen to be removed in.
    await models.Product.destroy({
      where: { id: productIds, addonParentId: { [Op.ne]: null } },
    });
    await models.Product.destroy({ where: { id: productIds } });
  }

  await models.Category.destroy({ where: { chainId: chainIds } });

  if (cinemaIds.length) await models.Cinema.destroy({ where: { id: cinemaIds } });

  await models.Chain.destroy({ where: { id: chainIds } });

  console.log(
    `  removed ${chains.length} chain(s), ${cinemaIds.length} cinema(s), ` +
      `${productIds.length} product(s) and everything beneath them`
  );
}

// ---------------------------------------------------------------------------
// Build
//
// Everything is created active. The dataset's `deactivate` flags are applied
// afterwards, because the backend refuses to create a screen under a
// deactivated cinema, or a cinema product under a deactivated cinema or
// product - so the graph has to exist before any of it is switched off.
// ---------------------------------------------------------------------------

async function build() {
  for (const chain of dataset.CHAINS) {
    const created = await chainService.createChain(SEED_ACTOR, {
      name: chain.name,
      logoImageUrl: chain.logoImageUrl,
      isActive: true,
    });

    ids.chains.set(chain.slug, created.id);
  }
  console.log(`  ${OK} chains: ${ids.chains.size}`);

  for (const cinema of dataset.CINEMAS) {
    const created = await cinemaService.createCinema(SEED_ACTOR, {
      chainId: ids.chains.get(cinema.chain),
      code: cinema.code,
      name: cinema.name,
      location: cinema.location ?? null,
      city: cinema.city ?? null,
      gstNumber: cinema.gstNumber ?? null,
      fssaiNumber: cinema.fssaiNumber ?? null,
      activeSince: cinema.activeSince ?? null,
      smsEnabled: cinema.smsEnabled ?? false,
      whatsappEnabled: cinema.whatsappEnabled ?? false,
      isActive: true,
    });

    ids.cinemas.set(cinema.slug, created.id);
  }
  console.log(`  ${OK} cinemas: ${ids.cinemas.size}`);

  let screens = 0;
  for (const screen of dataset.SCREENS) {
    await screenService.createScreen(SEED_ACTOR, {
      cinemaId: ids.cinemas.get(screen.cinema),
      name: screen.name,
      isActive: true,
    });
    screens += 1;
  }
  console.log(`  ${OK} screens: ${screens}`);

  for (const category of dataset.CATEGORIES) {
    const created = await categoryService.createCategory(SEED_ACTOR, {
      chainId: ids.chains.get(category.chain),
      name: category.name,
      description: category.description ?? null,
      imageUrl: category.imageUrl ?? null,
      isActive: true,
    });

    ids.categories.set(category.slug, created.id);
  }
  console.log(`  ${OK} categories: ${ids.categories.size}`);

  // Ordinary products first, then add-ons: an add-on names its parent, and the
  // parent has to exist to be named.
  const ordered = [
    ...dataset.PRODUCTS.filter((product) => !product.isAddon),
    ...dataset.PRODUCTS.filter((product) => product.isAddon),
  ];

  for (const product of ordered) {
    const created = await productService.createProduct(SEED_ACTOR, {
      categoryId: ids.categories.get(product.category),
      name: product.name,
      description: product.description ?? null,
      weight: product.weight ?? null,
      imageUrl: product.imageUrl ?? null,
      taxSlabCode: product.taxSlabCode ?? null,
      isAddon: product.isAddon ?? false,
      addonParentId: product.addonParent ? ids.products.get(product.addonParent) : null,
      isActive: true,
    });

    ids.products.set(product.slug, created.id);
  }
  console.log(`  ${OK} products: ${ids.products.size}`);

  for (const link of dataset.CINEMA_PRODUCTS) {
    const created = await cinemaProductService.createCinemaProduct(SEED_ACTOR, {
      cinemaId: ids.cinemas.get(link.cinema),
      productId: ids.products.get(link.product),
      sequence: link.sequence ?? 0,
      availableFrom: link.availableFrom ?? null,
      availableUntil: link.availableUntil ?? null,
      isActive: true,
    });

    ids.cinemaProducts.set(link.slug, created.id);
  }
  console.log(`  ${OK} cinema products: ${ids.cinemaProducts.size}`);

  let windows = 0;
  for (const hour of dataset.AVAILABILITY) {
    await availabilityService.createAvailabilityHour(SEED_ACTOR, {
      cinemaProductId: ids.cinemaProducts.get(hour.cinemaProduct),
      dayOfWeek: hour.dayOfWeek,
      startTime: hour.startTime,
      endTime: hour.endTime,
    });
    windows += 1;
  }
  console.log(`  ${OK} availability windows: ${windows}`);

  let prices = 0;
  for (const price of dataset.PRICING) {
    // Discount amounts are only sent alongside a type. The model hook rejects
    // an amount without one, and sending explicit nulls would be sending the
    // hook something to check for no reason.
    const discount = price.discountType
      ? {
          discountType: price.discountType,
          discountValue: price.discountValue ?? null,
          discountOnQr: price.discountOnQr ?? null,
          discountOnKiosk: price.discountOnKiosk ?? null,
          discountOnSeatQr: price.discountOnSeatQr ?? null,
          discountOnCounter: price.discountOnCounter ?? null,
        }
      : {};

    await pricingService.createPricing(SEED_ACTOR, {
      cinemaId: ids.cinemas.get(price.cinema),
      productId: ids.products.get(price.product),
      dayOfWeek: price.dayOfWeek,
      basePrice: price.basePrice,
      ...discount,
      isActive: true,
    });
    prices += 1;
  }
  console.log(`  ${OK} pricing rows: ${prices}`);

  let banners = 0;
  for (const item of dataset.BANNERS) {
    await bannerService.createBanner(SEED_ACTOR, {
      cinemaId: ids.cinemas.get(item.cinema),
      imageUrl: item.imageUrl,
      type: item.type,
      sequence: item.sequence,
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      isActive: true,
    });
    banners += 1;
  }
  console.log(`  ${OK} banners: ${banners}`);
}

/**
 * Switch off everything the dataset marked `deactivate`.
 *
 * Through the same deactivate services the dashboard's own buttons call, so the
 * rows end up in exactly the state a person clicking Deactivate would produce.
 */
async function deactivate() {
  // Children before parents, so nothing is switched off underneath a row that
  // is still being read through.
  const slugKeyed = [
    [dataset.CINEMA_PRODUCTS, ids.cinemaProducts, cinemaProductService.deactivateCinemaProduct],
    [dataset.PRODUCTS, ids.products, productService.deactivateProduct],
    [dataset.CATEGORIES, ids.categories, categoryService.deactivateCategory],
    [dataset.CINEMAS, ids.cinemas, cinemaService.deactivateCinema],
    [dataset.CHAINS, ids.chains, chainService.deactivateChain],
  ];

  let count = 0;

  // Banners, pricing and screens carry no slug - they are identified by their
  // natural key - so each is looked up first. They also come before the
  // slug-keyed pass, which switches off the cinemas and chains above them.

  for (const item of dataset.BANNERS.filter((entry) => entry.deactivate)) {
    const banner = await models.Banner.findOne({
      where: { cinemaId: ids.cinemas.get(item.cinema), sequence: item.sequence },
      attributes: ['id'],
    });

    await bannerService.deactivateBanner(SEED_ACTOR, banner.id);
    count += 1;
  }

  for (const item of dataset.PRICING.filter((entry) => entry.deactivate)) {
    const price = await models.ProductPricing.findOne({
      where: {
        cinemaId: ids.cinemas.get(item.cinema),
        productId: ids.products.get(item.product),
        dayOfWeek: item.dayOfWeek,
      },
      attributes: ['id'],
    });

    await pricingService.deactivatePricing(SEED_ACTOR, price.id);
    count += 1;
  }

  for (const item of dataset.SCREENS.filter((entry) => entry.deactivate)) {
    const screen = await models.Screen.findOne({
      where: { cinemaId: ids.cinemas.get(item.cinema), name: item.name },
      attributes: ['id'],
    });

    await screenService.deactivateScreen(SEED_ACTOR, screen.id);
    count += 1;
  }

  for (const [rows, map, deactivateFn] of slugKeyed) {
    for (const row of rows.filter((entry) => entry.deactivate)) {
      await deactivateFn(SEED_ACTOR, map.get(row.slug));
      count += 1;
    }
  }

  console.log(`  ${OK} deactivated ${count} row(s)`);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

async function report() {
  const chainIds = [...ids.chains.values()];
  const cinemaIds = [...ids.cinemas.values()];
  const linkIds = [...ids.cinemaProducts.values()];

  const totals = {
    Chains: await models.Chain.count({ where: { id: chainIds } }),
    Cinemas: await models.Cinema.count({ where: { chainId: chainIds } }),
    Screens: await models.Screen.count({ where: { cinemaId: cinemaIds } }),
    Categories: await models.Category.count({ where: { chainId: chainIds } }),
    Products: await models.Product.count({ where: { chainId: chainIds } }),
    'Cinema Products': await models.CinemaProduct.count({ where: { cinemaId: cinemaIds } }),
    'Availability Hours': await models.ProductAvailabilityHour.count({
      where: { cinemaProductId: linkIds },
    }),
    'Product Pricing': await models.ProductPricing.count({ where: { cinemaId: cinemaIds } }),
    Banners: await models.Banner.count({ where: { cinemaId: cinemaIds } }),
  };

  console.log('\n  Resource               Count');
  console.log('  ---------------------- -----');
  for (const [name, count] of Object.entries(totals)) {
    console.log(`  ${name.padEnd(22)} ${String(count).padStart(5)}`);
  }
  console.log(`  ${'Users'.padEnd(22)} ${'UNCHANGED'.padStart(5)}`);

  console.log('\n  Distribution by chain');

  for (const chain of dataset.CHAINS) {
    const chainId = ids.chains.get(chain.slug);
    const chainCinemas = idsOf(
      await models.Cinema.findAll({ where: { chainId }, attributes: ['id'] })
    );
    const chainProducts = idsOf(
      await models.Product.findAll({ where: { chainId }, attributes: ['id'] })
    );
    const chainLinks = chainCinemas.length
      ? idsOf(
          await models.CinemaProduct.findAll({
            where: { cinemaId: chainCinemas },
            attributes: ['id'],
          })
        )
      : [];

    console.log(`\n    ${chain.name} (id ${chainId})`);
    console.log(`      Cinemas:            ${chainCinemas.length}`);
    console.log(
      `      Screens:            ${chainCinemas.length ? await models.Screen.count({ where: { cinemaId: chainCinemas } }) : 0}`
    );
    console.log(`      Categories:         ${await models.Category.count({ where: { chainId } })}`);
    console.log(`      Products:           ${chainProducts.length}`);
    console.log(`      Cinema Products:    ${chainLinks.length}`);
    console.log(
      `      Availability Hours: ${chainLinks.length ? await models.ProductAvailabilityHour.count({ where: { cinemaProductId: chainLinks } }) : 0}`
    );
    console.log(
      `      Pricing:            ${chainCinemas.length ? await models.ProductPricing.count({ where: { cinemaId: chainCinemas } }) : 0}`
    );
    console.log(
      `      Banners:            ${chainCinemas.length ? await models.Banner.count({ where: { cinemaId: chainCinemas } }) : 0}`
    );
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Tenant isolation
//
// Checked through the services, which is where tenant scope is actually
// applied, using in-memory chain_admin actors. No user row is created: an actor
// is a plain object, and the scoping code reads only `role` and `chainId` from
// it.
// ---------------------------------------------------------------------------

const LIST_PARAMS = { page: 1, limit: 100, sort: 'id', order: 'asc' };

function chainActor(chainId) {
  return { id: null, role: ROLES.CHAIN_ADMIN, chainId };
}

/** A read that must come back scoped to `actor`, never wider. */
async function expectScoped(label, rows, allowedIds, idOf = (row) => row.id) {
  const leaked = rows.filter((row) => !allowedIds.includes(idOf(row)));

  if (leaked.length === 0) {
    console.log(`  ${OK} ${label} (${rows.length} rows, all in scope)`);
  } else {
    fail(`${label} leaked ${leaked.length} row(s) from another chain`);
  }
}

/** A call that must be refused, whatever the reason. */
async function expectRefused(label, promise) {
  try {
    await promise;
    fail(`${label} was ALLOWED and should not have been`);
  } catch (error) {
    const status = error.statusCode ?? error.status ?? '?';
    console.log(`  ${OK} ${label} refused (${error.name}, ${status})`);
  }
}

async function verifyTenantIsolation() {
  const pvrId = ids.chains.get('pvr');
  const inoxId = ids.chains.get('inox');

  const pvr = chainActor(pvrId);

  const pvrCinemas = idsOf(
    await models.Cinema.findAll({ where: { chainId: pvrId }, attributes: ['id'] })
  );
  const pvrProducts = idsOf(
    await models.Product.findAll({ where: { chainId: pvrId }, attributes: ['id'] })
  );
  const pvrLinks = idsOf(
    await models.CinemaProduct.findAll({ where: { cinemaId: pvrCinemas }, attributes: ['id'] })
  );
  const pvrCategories = idsOf(
    await models.Category.findAll({ where: { chainId: pvrId }, attributes: ['id'] })
  );
  const pvrScreens = idsOf(
    await models.Screen.findAll({ where: { cinemaId: pvrCinemas }, attributes: ['id'] })
  );
  const pvrBanners = idsOf(
    await models.Banner.findAll({ where: { cinemaId: pvrCinemas }, attributes: ['id'] })
  );
  const pvrPricing = idsOf(
    await models.ProductPricing.findAll({ where: { cinemaId: pvrCinemas }, attributes: ['id'] })
  );
  const pvrHours = idsOf(
    await models.ProductAvailabilityHour.findAll({
      where: { cinemaProductId: pvrLinks },
      attributes: ['id'],
    })
  );

  // One INOX row of each kind, to be reached for from inside PVR.
  const inoxCinema = await models.Cinema.findOne({
    where: { chainId: inoxId },
    attributes: ['id'],
  });
  const inoxProduct = await models.Product.findOne({
    where: { chainId: inoxId },
    attributes: ['id'],
  });
  const inoxCategory = await models.Category.findOne({
    where: { chainId: inoxId },
    attributes: ['id'],
  });
  const inoxScreen = await models.Screen.findOne({
    where: { cinemaId: inoxCinema.id },
    attributes: ['id'],
  });
  const inoxLink = await models.CinemaProduct.findOne({
    where: { cinemaId: inoxCinema.id },
    attributes: ['id'],
  });
  const inoxBanner = await models.Banner.findOne({
    where: { cinemaId: inoxCinema.id },
    attributes: ['id'],
  });
  const inoxPricing = await models.ProductPricing.findOne({
    where: { cinemaId: inoxCinema.id },
    attributes: ['id'],
  });
  const inoxHour = await models.ProductAvailabilityHour.findOne({
    where: { cinemaProductId: inoxLink ? [inoxLink.id] : [] },
    attributes: ['id'],
  });

  console.log("\n  Lists are scoped to the actor's own chain");

  await expectScoped(
    'cinemas',
    (await cinemaService.listCinemas(pvr, LIST_PARAMS)).cinemas,
    pvrCinemas
  );
  await expectScoped(
    'screens',
    (await screenService.listScreens(pvr, LIST_PARAMS)).screens,
    pvrScreens
  );
  await expectScoped(
    'categories',
    (await categoryService.listCategories(pvr, LIST_PARAMS)).categories,
    pvrCategories
  );
  await expectScoped(
    'products',
    (await productService.listProducts(pvr, LIST_PARAMS)).products,
    pvrProducts
  );
  await expectScoped(
    'cinema products',
    (await cinemaProductService.listCinemaProducts(pvr, LIST_PARAMS)).cinemaProducts,
    pvrLinks
  );
  await expectScoped(
    'availability hours',
    (await availabilityService.listAvailabilityHours(pvr, LIST_PARAMS)).availabilityHours,
    pvrHours
  );
  await expectScoped(
    'pricing',
    (await pricingService.listPricings(pvr, LIST_PARAMS)).pricings,
    pvrPricing
  );
  await expectScoped(
    'banners',
    (await bannerService.listBanners(pvr, LIST_PARAMS)).banners,
    pvrBanners
  );

  // Chains are the one list a chain_admin sees a single row of - their own.
  const visibleChains = (await chainService.listChains(pvr, LIST_PARAMS)).chains;
  await expectScoped('chains', visibleChains, [pvrId]);

  console.log("\n  Another chain's rows cannot be fetched by id");

  await expectRefused('get cinema', cinemaService.getCinema(pvr, inoxCinema.id));
  await expectRefused('get screen', screenService.getScreen(pvr, inoxScreen.id));
  await expectRefused('get category', categoryService.getCategory(pvr, inoxCategory.id));
  await expectRefused('get product', productService.getProduct(pvr, inoxProduct.id));
  await expectRefused(
    'get cinema product',
    cinemaProductService.getCinemaProduct(pvr, inoxLink.id)
  );
  await expectRefused('get pricing', pricingService.getPricing(pvr, inoxPricing.id));
  await expectRefused('get banner', bannerService.getBanner(pvr, inoxBanner.id));
  await expectRefused('get chain', chainService.getChain(pvr, inoxId));
  if (inoxHour) {
    await expectRefused(
      'get availability hour',
      availabilityService.getAvailabilityHour(pvr, inoxHour.id)
    );
  }

  console.log("\n  Another chain's rows cannot be modified or deleted");

  await expectRefused(
    'update cinema',
    cinemaService.updateCinema(pvr, inoxCinema.id, { name: 'Should not happen' })
  );
  await expectRefused(
    'update product',
    productService.updateProduct(pvr, inoxProduct.id, { name: 'Should not happen' })
  );
  await expectRefused(
    'update cinema product',
    cinemaProductService.updateCinemaProduct(pvr, inoxLink.id, { sequence: 99 })
  );
  await expectRefused(
    'update banner',
    bannerService.updateBanner(pvr, inoxBanner.id, { sequence: 99 })
  );
  await expectRefused('deactivate cinema', cinemaService.deactivateCinema(pvr, inoxCinema.id));
  await expectRefused('deactivate product', productService.deactivateProduct(pvr, inoxProduct.id));
  await expectRefused(
    'deactivate cinema product',
    cinemaProductService.deactivateCinemaProduct(pvr, inoxLink.id)
  );
  await expectRefused('deactivate pricing', pricingService.deactivatePricing(pvr, inoxPricing.id));
  await expectRefused('deactivate banner', bannerService.deactivateBanner(pvr, inoxBanner.id));
  if (inoxHour) {
    await expectRefused(
      'delete availability hour',
      availabilityService.deleteAvailabilityHour(pvr, inoxHour.id)
    );
  }

  // A filter naming another chain's row must narrow an already-scoped set to
  // nothing, not escape the scope.
  const smuggled = await cinemaProductService.listCinemaProducts(pvr, {
    ...LIST_PARAMS,
    cinemaId: inoxCinema.id,
  });

  if (smuggled.total === 0) {
    console.log(`  ${OK} filtering by another chain's cinemaId returns nothing`);
  } else {
    fail(`filtering by another chain's cinemaId returned ${smuggled.total} row(s)`);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run: NODE_ENV is production. This seed is for development only.');
  }

  const skipVerify = process.argv.includes('--skip-verify');

  const usersBefore = await models.User.count();

  console.log('\nRemoving any previous sample data');
  await purge();

  console.log('\nBuilding sample data');
  await build();

  console.log('\nApplying deactivations');
  await deactivate();

  await report();

  const usersAfter = await models.User.count();

  console.log('');
  if (usersBefore === usersAfter) {
    console.log(`  ${OK} users untouched (${usersAfter} before and after)`);
  } else {
    fail(`user count changed from ${usersBefore} to ${usersAfter}`);
  }

  if (!skipVerify) {
    console.log('\nTenant isolation');
    await verifyTenantIsolation();
  }
}

main()
  .then(() => {
    if (failures === 0) {
      console.log('\nSample data ready.\n');
    } else {
      console.error(`\n${failures} check(s) failed.\n`);
    }
  })
  .catch((error) => {
    failures += 1;
    console.error(`\n${FAIL} ${error.message}\n`);
    if (process.env.SEED_DEBUG) console.error(error);
  })
  .then(() => sequelize.close())
  .then(() => process.exit(failures === 0 ? 0 : 1));
