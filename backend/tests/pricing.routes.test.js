'use strict';

/**
 * End-to-end tests for /api/product-pricing.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, cross-chain pairing, discount validation,
 * soft delete - rather than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Cinema: { findOne: jest.fn() },
    Product: { findOne: jest.fn() },
    ProductPricing: {
      findOne: jest.fn(),
      findAndCountAll: jest.fn(),
      create: jest.fn(),
      destroy: jest.fn(),
    },
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

const { models } = require('../src/config/database');
const createApp = require('../src/app');
const { generateAccessToken } = require('../src/utils/jwt');
const { ERROR_CODES } = require('../src/constants');

const app = createApp();

const FULL = [{ moduleName: 'Pricing', canRead: true, canEdit: true, canDelete: true }];
const READ_ONLY = [{ moduleName: 'Pricing', canRead: true, canEdit: false, canDelete: false }];

const VALID_PRICE = { cinemaId: 3, productId: 17, basePrice: 250 };

function buildPricing(overrides = {}) {
  return {
    id: 22,
    cinemaId: 3,
    productId: 17,
    dayOfWeek: 0,
    basePrice: '250.00',
    discountType: null,
    discountValue: null,
    discountOnQr: null,
    discountOnKiosk: null,
    discountOnSeatQr: null,
    discountOnCounter: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    update: jest.fn(function update(values) {
      Object.assign(this, values);
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

function buildActor(overrides = {}) {
  return {
    id: 7,
    chainId: 1,
    cinemaId: null,
    role: 'cinema_admin',
    username: 'alice',
    isActive: true,
    permissions: FULL,
    ...overrides,
  };
}

/** An owner bypasses the permission table entirely, so they need no grants. */
function buildOwner(overrides = {}) {
  return buildActor({ role: 'owner', permissions: [], ...overrides });
}

function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return `Bearer ${generateAccessToken({ sub: actor.id, role: actor.role })}`;
}

function cinemaInclude(mockCall) {
  return mockCall.include.find((entry) => entry.association === 'cinema');
}

/** Both parent lookups resolve inside one chain. */
function parentsIn(chainId) {
  models.Cinema.findOne.mockResolvedValue({ id: 3, chainId });
  models.Product.findOne.mockResolvedValue({ id: 17, chainId });
}

describe('GET /api/product-pricing', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/product-pricing');

    expect(response.status).toBe(401);
    expect(models.ProductPricing.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Pricing read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/product-pricing').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.ProductPricing.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user holding only the Products permission', async () => {
    const token = authenticateAs(
      buildActor({
        permissions: [{ moduleName: 'Products', canRead: true, canEdit: true, canDelete: true }],
      })
    );

    const response = await request(app).get('/api/product-pricing').set('Authorization', token);

    expect(response.status).toBe(403);
  });

  it('returns a page of price rows with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.ProductPricing.findAndCountAll.mockResolvedValue({ rows: [buildPricing()], count: 1 });

    const response = await request(app).get('/api/product-pricing').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 22, basePrice: '250.00' });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, total: 1 });
  });

  it('scopes a non-owner through the cinema join', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductPricing.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/product-pricing').set('Authorization', token);

    expect(cinemaInclude(models.ProductPricing.findAndCountAll.mock.calls[0][0])).toMatchObject({
      required: true,
      where: { chainId: 4 },
    });
  });

  it('keeps the tenant join when filtering by a cinema in another chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductPricing.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/product-pricing?cinemaId=99').set('Authorization', token);

    const call = models.ProductPricing.findAndCountAll.mock.calls[0][0];
    expect(call.where.cinemaId).toBe(99);
    expect(cinemaInclude(call).where).toEqual({ chainId: 4 });
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/product-pricing?sort=base_price;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
  });
});

describe('GET /api/product-pricing/:id', () => {
  it('returns the price row', async () => {
    const token = authenticateAs(buildActor());
    models.ProductPricing.findOne.mockResolvedValue(buildPricing());

    const response = await request(app).get('/api/product-pricing/22').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 22, cinemaId: 3, productId: 17 });
  });

  it('reports a price row in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductPricing.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/product-pricing/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.ProductPricing.findOne.mock.calls[0][0]).where).toEqual({
      chainId: 4,
    });
  });
});

describe('POST /api/product-pricing', () => {
  it('denies a user without the Pricing edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send(VALID_PRICE);

    expect(response.status).toBe(403);
    expect(models.ProductPricing.create).not.toHaveBeenCalled();
  });

  it('creates the price row and defaults dayOfWeek to every day', async () => {
    const token = authenticateAs(buildActor({ id: 7, chainId: 1 }));
    parentsIn(1);
    models.ProductPricing.create.mockResolvedValue(buildPricing());

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send(VALID_PRICE);

    expect(response.status).toBe(201);
    expect(models.ProductPricing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cinemaId: 3,
        productId: 17,
        dayOfWeek: 0,
        basePrice: 250,
        createdBy: 7,
        updatedBy: 7,
      })
    );
  });

  it('rejects a cinema and product from different chains with 409', async () => {
    const token = authenticateAs(buildOwner());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1 });
    models.Product.findOne.mockResolvedValue({ id: 17, chainId: 9 });

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send(VALID_PRICE);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.ProductPricing.create).not.toHaveBeenCalled();
  });

  it('reports an out-of-chain cinema as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);
    models.Product.findOne.mockResolvedValue({ id: 17, chainId: 4 });

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send(VALID_PRICE);

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 3, chainId: 4 }) })
    );
  });

  it('reports an out-of-chain product as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 4 });
    models.Product.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send(VALID_PRICE);

    expect(response.status).toBe(404);
  });

  it('rejects a negative base price with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({ ...VALID_PRICE, basePrice: -1 });

    expect(response.status).toBe(400);
    expect(models.ProductPricing.create).not.toHaveBeenCalled();
  });

  it('rejects a discountType outside P and F with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({ ...VALID_PRICE, discountType: 'X', discountValue: 10 });

    expect(response.status).toBe(400);
  });

  it('rejects a percentage discount above 100 with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({ ...VALID_PRICE, discountType: 'P', discountValue: 150 });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('discountValue');
    expect(models.ProductPricing.create).not.toHaveBeenCalled();
  });

  it('rejects a source-specific percentage above 100 with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({ ...VALID_PRICE, discountType: 'P', discountOnQr: 120 });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('discountOnQr');
  });

  it('allows a flat discount above 100', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    models.ProductPricing.create.mockResolvedValue(buildPricing({ discountType: 'F' }));

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({ ...VALID_PRICE, discountType: 'F', discountValue: 150 });

    expect(response.status).toBe(201);
  });

  it('accepts every source-specific discount together', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    models.ProductPricing.create.mockResolvedValue(buildPricing({ discountType: 'P' }));

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({
        ...VALID_PRICE,
        discountType: 'P',
        discountOnQr: 10,
        discountOnKiosk: 5,
        discountOnSeatQr: 7.5,
        discountOnCounter: 0,
      });

    expect(response.status).toBe(201);
    expect(models.ProductPricing.create.mock.calls[0][0]).toMatchObject({
      discountOnQr: 10,
      discountOnSeatQr: 7.5,
      discountOnCounter: 0,
    });
  });

  it('surfaces the model hook as a 400 when a discount has no discountType', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    // The frozen ProductPricing beforeSave hook raises this; the service does
    // not duplicate the rule.
    const { ValidationError } = require('../src/utils/errors');
    models.ProductPricing.create.mockRejectedValue(
      new ValidationError(
        "discountType must be set ('P' or 'F') when any discount amount is provided",
        [{ field: 'discountOnQr', message: "'discountOnQr' requires 'discountType' to be set" }]
      )
    );

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({ ...VALID_PRICE, discountOnQr: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(response.body.error.details[0].field).toBe('discountOnQr');
  });

  it('surfaces a duplicate cinema/product/day from the unique index as 409', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    const { UniqueConstraintError } = require('sequelize');
    models.ProductPricing.create.mockRejectedValue(
      new UniqueConstraintError({ errors: [{ path: 'cinema_id', message: 'must be unique' }] })
    );

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send(VALID_PRICE);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
  });

  it('rejects a missing cinemaId, productId and basePrice with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-pricing')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'cinemaId' }),
        expect.objectContaining({ field: 'productId' }),
        expect.objectContaining({ field: 'basePrice' }),
      ])
    );
  });
});

describe('PUT /api/product-pricing/:id', () => {
  it('updates the price row and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const pricing = buildPricing();
    models.ProductPricing.findOne.mockResolvedValue(pricing);

    const response = await request(app)
      .put('/api/product-pricing/22')
      .set('Authorization', token)
      .send({ basePrice: 300 });

    expect(response.status).toBe(200);
    expect(pricing.update).toHaveBeenCalledWith(
      expect.objectContaining({ basePrice: 300, updatedBy: 7 })
    );
  });

  it('ignores an attempt to change the natural key', async () => {
    const token = authenticateAs(buildActor());
    const pricing = buildPricing({ cinemaId: 3, productId: 17, dayOfWeek: 0 });
    models.ProductPricing.findOne.mockResolvedValue(pricing);

    const response = await request(app)
      .put('/api/product-pricing/22')
      .set('Authorization', token)
      .send({ basePrice: 300, cinemaId: 99, productId: 99, dayOfWeek: 5 });

    expect(response.status).toBe(200);
    const [values] = pricing.update.mock.calls[0];
    expect(values).not.toHaveProperty('cinemaId');
    expect(values).not.toHaveProperty('productId');
    expect(values).not.toHaveProperty('dayOfWeek');
  });

  it('rejects a percentage above 100 on update', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/product-pricing/22')
      .set('Authorization', token)
      .send({ discountType: 'P', discountValue: 150 });

    expect(response.status).toBe(400);
    expect(models.ProductPricing.findOne).not.toHaveBeenCalled();
  });

  it('reports a price row in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductPricing.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/product-pricing/99')
      .set('Authorization', token)
      .send({ basePrice: 300 });

    expect(response.status).toBe(404);
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/product-pricing/22')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/product-pricing/:id', () => {
  it('denies a user without the Pricing delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .delete('/api/product-pricing/22')
      .set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.ProductPricing.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const pricing = buildPricing({ isActive: true });
    models.ProductPricing.findOne.mockResolvedValue(pricing);

    const response = await request(app)
      .delete('/api/product-pricing/22')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(pricing.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(models.ProductPricing.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated price row', async () => {
    const token = authenticateAs(buildActor());
    const pricing = buildPricing({ isActive: false });
    models.ProductPricing.findOne.mockResolvedValue(pricing);

    const response = await request(app)
      .delete('/api/product-pricing/22')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(pricing.update).not.toHaveBeenCalled();
  });
});
