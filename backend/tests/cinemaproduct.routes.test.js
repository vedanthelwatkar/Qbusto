'use strict';

/**
 * End-to-end tests for /api/cinema-products.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, cross-chain pairing, deactivated parents,
 * the date-range rule, soft delete - rather than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Cinema: { findOne: jest.fn() },
    Product: { findOne: jest.fn() },
    CinemaProduct: {
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

const FULL = [{ moduleName: 'Products', canRead: true, canEdit: true, canDelete: true }];
const READ_ONLY = [{ moduleName: 'Products', canRead: true, canEdit: false, canDelete: false }];

const VALID_LINK = { cinemaId: 3, productId: 17 };

function buildCinemaProduct(overrides = {}) {
  return {
    id: 12,
    cinemaId: 3,
    productId: 17,
    sequence: 0,
    availableFrom: null,
    availableUntil: null,
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

/** Both parent lookups resolve inside one chain, both active. */
function parentsIn(chainId) {
  models.Cinema.findOne.mockResolvedValue({ id: 3, chainId, isActive: true });
  models.Product.findOne.mockResolvedValue({ id: 17, chainId, isActive: true });
}

describe('GET /api/cinema-products', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/cinema-products');

    expect(response.status).toBe(401);
    expect(models.CinemaProduct.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Products read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/cinema-products').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.CinemaProduct.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user holding only the Pricing permission', async () => {
    const token = authenticateAs(
      buildActor({
        permissions: [{ moduleName: 'Pricing', canRead: true, canEdit: true, canDelete: true }],
      })
    );

    const response = await request(app).get('/api/cinema-products').set('Authorization', token);

    expect(response.status).toBe(403);
  });

  it('returns a page of links with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.CinemaProduct.findAndCountAll.mockResolvedValue({
      rows: [buildCinemaProduct()],
      count: 1,
    });

    const response = await request(app).get('/api/cinema-products').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 12, cinemaId: 3, productId: 17 });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, total: 1 });
  });

  it('defaults to ordering by sequence', async () => {
    const token = authenticateAs(buildActor());
    models.CinemaProduct.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinema-products').set('Authorization', token);

    expect(models.CinemaProduct.findAndCountAll.mock.calls[0][0].order).toEqual([
      ['sequence', 'ASC'],
    ]);
  });

  it('resolves a (cinema, product) pair to a single link', async () => {
    const token = authenticateAs(buildActor());
    models.CinemaProduct.findAndCountAll.mockResolvedValue({
      rows: [buildCinemaProduct()],
      count: 1,
    });

    const response = await request(app)
      .get('/api/cinema-products?cinemaId=3&productId=17')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(models.CinemaProduct.findAndCountAll.mock.calls[0][0].where).toMatchObject({
      cinemaId: 3,
      productId: 17,
    });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(12);
  });

  it('scopes a non-owner through the cinema join', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.CinemaProduct.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinema-products').set('Authorization', token);

    expect(cinemaInclude(models.CinemaProduct.findAndCountAll.mock.calls[0][0])).toMatchObject({
      required: true,
      where: { chainId: 4 },
    });
  });

  it('keeps the tenant join when filtering by a cinema in another chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.CinemaProduct.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinema-products?cinemaId=99').set('Authorization', token);

    const call = models.CinemaProduct.findAndCountAll.mock.calls[0][0];
    expect(call.where.cinemaId).toBe(99);
    expect(cinemaInclude(call).where).toEqual({ chainId: 4 });
  });

  it('leaves an owner unscoped', async () => {
    const token = authenticateAs(buildOwner());
    models.CinemaProduct.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinema-products').set('Authorization', token);

    expect(
      cinemaInclude(models.CinemaProduct.findAndCountAll.mock.calls[0][0]).where
    ).toBeUndefined();
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/cinema-products?sort=sequence;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
  });
});

describe('GET /api/cinema-products/:id', () => {
  it('returns the link', async () => {
    const token = authenticateAs(buildActor());
    models.CinemaProduct.findOne.mockResolvedValue(buildCinemaProduct());

    const response = await request(app).get('/api/cinema-products/12').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 12, cinemaId: 3, productId: 17 });
  });

  it('reports a link in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.CinemaProduct.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/cinema-products/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.CinemaProduct.findOne.mock.calls[0][0]).where).toEqual({
      chainId: 4,
    });
  });
});

describe('POST /api/cinema-products', () => {
  it('denies a user without the Products edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(403);
    expect(models.CinemaProduct.create).not.toHaveBeenCalled();
  });

  it('creates the link and defaults sequence, dates and status', async () => {
    const token = authenticateAs(buildActor({ id: 7, chainId: 1 }));
    parentsIn(1);
    models.CinemaProduct.create.mockResolvedValue(buildCinemaProduct());

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(201);
    expect(models.CinemaProduct.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cinemaId: 3,
        productId: 17,
        sequence: 0,
        availableFrom: null,
        availableUntil: null,
        isActive: true,
        createdBy: 7,
        updatedBy: 7,
      })
    );
  });

  it('rejects a cinema and product from different chains with 409', async () => {
    const token = authenticateAs(buildOwner());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Product.findOne.mockResolvedValue({ id: 17, chainId: 9, isActive: true });

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.CinemaProduct.create).not.toHaveBeenCalled();
  });

  it('reports an out-of-chain cinema as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);
    models.Product.findOne.mockResolvedValue({ id: 17, chainId: 4, isActive: true });

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 3, chainId: 4 }) })
    );
  });

  it('reports an out-of-chain product as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 4, isActive: true });
    models.Product.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(404);
  });

  it('refuses to add a product to a deactivated cinema', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: false });
    models.Product.findOne.mockResolvedValue({ id: 17, chainId: 1, isActive: true });

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(409);
    expect(models.CinemaProduct.create).not.toHaveBeenCalled();
  });

  it('refuses to add a deactivated product to a cinema', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Product.findOne.mockResolvedValue({ id: 17, chainId: 1, isActive: false });

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(409);
    expect(models.CinemaProduct.create).not.toHaveBeenCalled();
  });

  it('accepts a date range and stores both bounds', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    models.CinemaProduct.create.mockResolvedValue(buildCinemaProduct());

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send({
        ...VALID_LINK,
        availableFrom: '2026-01-01T00:00:00.000Z',
        availableUntil: '2026-01-31T00:00:00.000Z',
      });

    expect(response.status).toBe(201);
    expect(models.CinemaProduct.create.mock.calls[0][0]).toMatchObject({
      availableFrom: new Date('2026-01-01T00:00:00.000Z'),
      availableUntil: new Date('2026-01-31T00:00:00.000Z'),
    });
  });

  it('rejects a date range that ends before it starts with 400', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send({
        ...VALID_LINK,
        availableFrom: '2026-01-31T00:00:00.000Z',
        availableUntil: '2026-01-01T00:00:00.000Z',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('availableUntil');
    expect(models.CinemaProduct.create).not.toHaveBeenCalled();
  });

  it('rejects a zero-length date range with 400', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send({
        ...VALID_LINK,
        availableFrom: '2026-01-01T00:00:00.000Z',
        availableUntil: '2026-01-01T00:00:00.000Z',
      });

    expect(response.status).toBe(400);
  });

  it('allows an open-ended range', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    models.CinemaProduct.create.mockResolvedValue(buildCinemaProduct());

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send({ ...VALID_LINK, availableFrom: '2026-01-01T00:00:00.000Z' });

    expect(response.status).toBe(201);
  });

  it('surfaces a duplicate cinema/product from the unique index as 409', async () => {
    const token = authenticateAs(buildActor());
    parentsIn(1);
    const { UniqueConstraintError } = require('sequelize');
    models.CinemaProduct.create.mockRejectedValue(
      new UniqueConstraintError({ errors: [{ path: 'cinema_id', message: 'must be unique' }] })
    );

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
  });

  it('surfaces the model tenant hook as a 409', async () => {
    const token = authenticateAs(buildOwner());
    parentsIn(1);
    // The frozen CinemaProduct beforeSave hook is the backstop for any write
    // that does not pass through this service.
    const { ConflictError } = require('../src/utils/errors');
    models.CinemaProduct.create.mockRejectedValue(
      new ConflictError('A cinema can only be linked to a product belonging to the same chain')
    );

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send(VALID_LINK);

    expect(response.status).toBe(409);
  });

  it('rejects a missing cinemaId and productId with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'cinemaId' }),
        expect.objectContaining({ field: 'productId' }),
      ])
    );
  });

  it('rejects a negative sequence with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/cinema-products')
      .set('Authorization', token)
      .send({ ...VALID_LINK, sequence: -1 });

    expect(response.status).toBe(400);
  });
});

describe('PUT /api/cinema-products/:id', () => {
  it('updates the sequence and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const link = buildCinemaProduct();
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({ sequence: 5 });

    expect(response.status).toBe(200);
    expect(link.update).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 5, updatedBy: 7 })
    );
  });

  it('ignores an attempt to change the natural key', async () => {
    const token = authenticateAs(buildActor());
    const link = buildCinemaProduct();
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({ sequence: 5, cinemaId: 99, productId: 99 });

    expect(response.status).toBe(200);
    const [values] = link.update.mock.calls[0];
    expect(values).not.toHaveProperty('cinemaId');
    expect(values).not.toHaveProperty('productId');
  });

  it('clears a date bound when null is sent', async () => {
    const token = authenticateAs(buildActor());
    const link = buildCinemaProduct({ availableFrom: new Date('2026-01-01T00:00:00Z') });
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({ availableFrom: null });

    expect(response.status).toBe(200);
    expect(link.update.mock.calls[0][0]).toMatchObject({ availableFrom: null });
  });

  it('checks a new bound against the stored one', async () => {
    const token = authenticateAs(buildActor());
    // Stored range ends 31 Jan; moving the start past it is rejected.
    const link = buildCinemaProduct({ availableUntil: new Date('2026-01-31T00:00:00Z') });
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({ availableFrom: '2026-02-15T00:00:00.000Z' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('availableUntil');
    expect(link.update).not.toHaveBeenCalled();
  });

  it('allows a new bound that clears the stored one', async () => {
    const token = authenticateAs(buildActor());
    const link = buildCinemaProduct({ availableUntil: new Date('2026-01-31T00:00:00Z') });
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({ availableFrom: '2026-02-15T00:00:00.000Z', availableUntil: null });

    expect(response.status).toBe(200);
  });

  it('reactivates a deactivated link', async () => {
    const token = authenticateAs(buildActor());
    const link = buildCinemaProduct({ isActive: false });
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({ isActive: true });

    expect(response.status).toBe(200);
    expect(link.update).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('reports a link in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.CinemaProduct.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/cinema-products/99')
      .set('Authorization', token)
      .send({ sequence: 5 });

    expect(response.status).toBe(404);
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/cinema-products/12')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/cinema-products/:id', () => {
  it('denies a user without the Products delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .delete('/api/cinema-products/12')
      .set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.CinemaProduct.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const link = buildCinemaProduct({ isActive: true });
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .delete('/api/cinema-products/12')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(link.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(models.CinemaProduct.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated link', async () => {
    const token = authenticateAs(buildActor());
    const link = buildCinemaProduct({ isActive: false });
    models.CinemaProduct.findOne.mockResolvedValue(link);

    const response = await request(app)
      .delete('/api/cinema-products/12')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(link.update).not.toHaveBeenCalled();
  });
});
