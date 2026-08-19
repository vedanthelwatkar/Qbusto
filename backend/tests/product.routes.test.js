'use strict';

/**
 * End-to-end tests for /api/products.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, chain derivation, duplicate names, add-on
 * rules, soft delete - rather than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Category: { findOne: jest.fn() },
    Product: {
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

function buildProduct(overrides = {}) {
  return {
    id: 17,
    chainId: 1,
    categoryId: 4,
    name: 'Salted Popcorn',
    description: null,
    weight: null,
    imageUrl: null,
    taxSlabCode: null,
    isAddon: false,
    addonParentId: null,
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

describe('GET /api/products', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/products');

    expect(response.status).toBe(401);
    expect(models.Product.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Products read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/products').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Product.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns a page of products with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.Product.findAndCountAll.mockResolvedValue({ rows: [buildProduct()], count: 1 });

    const response = await request(app).get('/api/products').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 17, categoryId: 4, name: 'Salted Popcorn' });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('confines a non-owner to their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Product.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/products').set('Authorization', token);

    expect(models.Product.findAndCountAll.mock.calls[0][0].where.chainId).toBe(4);
  });

  it('filters by category and add-on parent', async () => {
    const token = authenticateAs(buildActor());
    models.Product.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app)
      .get('/api/products?categoryId=4&isAddon=true&addonParentId=17')
      .set('Authorization', token);

    expect(models.Product.findAndCountAll.mock.calls[0][0].where).toMatchObject({
      categoryId: 4,
      isAddon: true,
      addonParentId: 17,
    });
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/products?sort=chain_id;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Product.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/products/:id', () => {
  it('returns the product', async () => {
    const token = authenticateAs(buildActor());
    models.Product.findOne.mockResolvedValue(buildProduct());

    const response = await request(app).get('/api/products/17').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 17, name: 'Salted Popcorn' });
  });

  it('reports a product in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Product.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/products/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(models.Product.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 99, chainId: 4 }) })
    );
  });
});

describe('POST /api/products', () => {
  it('denies a user without the Products edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 4, name: 'Nachos' });

    expect(response.status).toBe(403);
    expect(models.Product.create).not.toHaveBeenCalled();
  });

  it('derives chainId from the category rather than the request', async () => {
    const token = authenticateAs(buildOwner({ chainId: 1 }));
    models.Category.findOne.mockResolvedValue({ id: 4, chainId: 9 });
    models.Product.findOne.mockResolvedValue(null);
    models.Product.create.mockResolvedValue(buildProduct({ chainId: 9 }));

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      // chainId is not part of the schema and must not survive stripUnknown.
      .send({ categoryId: 4, name: 'Nachos', chainId: 1 });

    expect(response.status).toBe(201);
    expect(models.Product.create.mock.calls[0][0].chainId).toBe(9);
  });

  it('rejects a category in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Category.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 99, name: 'Nachos' });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/category/i);
    expect(models.Category.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 99, chainId: 4 }) })
    );
    expect(models.Product.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name within the same category with 409', async () => {
    const token = authenticateAs(buildActor());
    models.Category.findOne.mockResolvedValue({ id: 4, chainId: 1 });
    models.Product.findOne.mockResolvedValue({ id: 17 });

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 4, name: 'Salted Popcorn' });

    expect(response.status).toBe(409);
    expect(models.Product.create).not.toHaveBeenCalled();
  });

  it('scopes the duplicate check to the category', async () => {
    const token = authenticateAs(buildActor());
    models.Category.findOne.mockResolvedValue({ id: 4, chainId: 1 });
    models.Product.findOne.mockResolvedValue(null);
    models.Product.create.mockResolvedValue(buildProduct());

    await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 4, name: 'Salted Popcorn' });

    // The same name under a different category must not collide.
    expect(models.Product.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoryId: 4, name: 'Salted Popcorn' } })
    );
  });

  it('rejects an add-on parent that is itself an add-on with 400', async () => {
    const token = authenticateAs(buildActor());
    models.Category.findOne.mockResolvedValue({ id: 4, chainId: 1 });
    models.Product.findOne
      .mockResolvedValueOnce(null) // duplicate-name check
      .mockResolvedValueOnce({ id: 20, chainId: 1, isAddon: true }); // parent

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 4, name: 'Extra Cheese', isAddon: true, addonParentId: 20 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(models.Product.create).not.toHaveBeenCalled();
  });

  it('rejects an add-on parent in another chain with 409', async () => {
    const token = authenticateAs(buildOwner());
    models.Category.findOne.mockResolvedValue({ id: 4, chainId: 1 });
    models.Product.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 20, chainId: 9, isAddon: false });

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 4, name: 'Extra Cheese', isAddon: true, addonParentId: 20 });

    expect(response.status).toBe(409);
    expect(models.Product.create).not.toHaveBeenCalled();
  });

  it('accepts a valid add-on parent', async () => {
    const token = authenticateAs(buildActor());
    models.Category.findOne.mockResolvedValue({ id: 4, chainId: 1 });
    models.Product.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 20, chainId: 1, isAddon: false });
    models.Product.create.mockResolvedValue(buildProduct({ isAddon: true, addonParentId: 20 }));

    const response = await request(app)
      .post('/api/products')
      .set('Authorization', token)
      .send({ categoryId: 4, name: 'Extra Cheese', isAddon: true, addonParentId: 20 });

    expect(response.status).toBe(201);
  });

  it('rejects a missing categoryId and name with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).post('/api/products').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'categoryId' }),
        expect.objectContaining({ field: 'name' }),
      ])
    );
  });
});

describe('PUT /api/products/:id', () => {
  it('updates the product and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const product = buildProduct();
    models.Product.findOne.mockResolvedValue(product);

    const response = await request(app)
      .put('/api/products/17')
      .set('Authorization', token)
      .send({ weight: '150g' });

    expect(response.status).toBe(200);
    expect(product.update).toHaveBeenCalledWith(
      expect.objectContaining({ weight: '150g', updatedBy: 7 })
    );
  });

  it('refuses to re-file a product into a category in another chain', async () => {
    const token = authenticateAs(buildOwner());
    const product = buildProduct({ chainId: 1, categoryId: 4 });
    models.Product.findOne.mockResolvedValue(product);
    models.Category.findOne.mockResolvedValue({ id: 8, chainId: 9 });

    const response = await request(app)
      .put('/api/products/17')
      .set('Authorization', token)
      .send({ categoryId: 8 });

    expect(response.status).toBe(409);
    expect(product.update).not.toHaveBeenCalled();
  });

  it('allows re-filing into a category in the same chain', async () => {
    const token = authenticateAs(buildActor());
    const product = buildProduct({ chainId: 1, categoryId: 4 });
    models.Product.findOne.mockResolvedValueOnce(product).mockResolvedValueOnce(null);
    models.Category.findOne.mockResolvedValue({ id: 8, chainId: 1 });

    const response = await request(app)
      .put('/api/products/17')
      .set('Authorization', token)
      .send({ categoryId: 8 });

    expect(response.status).toBe(200);
    expect(product.update).toHaveBeenCalled();
  });

  it('re-checks the name against the target category when re-filing', async () => {
    const token = authenticateAs(buildActor());
    const product = buildProduct({ chainId: 1, categoryId: 4, name: 'Salted Popcorn' });
    models.Product.findOne.mockResolvedValueOnce(product).mockResolvedValueOnce({ id: 30 });
    models.Category.findOne.mockResolvedValue({ id: 8, chainId: 1 });

    const response = await request(app)
      .put('/api/products/17')
      .set('Authorization', token)
      .send({ categoryId: 8 });

    expect(response.status).toBe(409);
    // Checked against the destination category, carrying the unchanged name.
    expect(models.Product.findOne.mock.calls[1][0].where).toMatchObject({
      categoryId: 8,
      name: 'Salted Popcorn',
    });
  });

  it('rejects a product being made its own add-on parent', async () => {
    const token = authenticateAs(buildActor());
    const product = buildProduct({ id: 17 });
    models.Product.findOne.mockResolvedValue(product);

    const response = await request(app)
      .put('/api/products/17')
      .set('Authorization', token)
      .send({ addonParentId: 17 });

    expect(response.status).toBe(400);
    expect(product.update).not.toHaveBeenCalled();
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/products/17')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
    expect(models.Product.findOne).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/products/:id', () => {
  it('denies a user without the Products delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app).delete('/api/products/17').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Product.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const product = buildProduct({ isActive: true });
    models.Product.findOne.mockResolvedValue(product);

    const response = await request(app).delete('/api/products/17').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(product.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(response.body.data.isActive).toBe(false);
    expect(models.Product.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated product', async () => {
    const token = authenticateAs(buildActor());
    const product = buildProduct({ isActive: false });
    models.Product.findOne.mockResolvedValue(product);

    const response = await request(app).delete('/api/products/17').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(product.update).not.toHaveBeenCalled();
  });

  it('reports a product in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Product.findOne.mockResolvedValue(null);

    const response = await request(app).delete('/api/products/99').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});
