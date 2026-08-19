'use strict';

/**
 * End-to-end tests for /api/categories.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, duplicate names, soft delete - rather than
 * the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Chain: { findByPk: jest.fn() },
    Category: {
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

const FULL = [{ moduleName: 'Categories', canRead: true, canEdit: true, canDelete: true }];
const READ_ONLY = [{ moduleName: 'Categories', canRead: true, canEdit: false, canDelete: false }];

function buildCategory(overrides = {}) {
  return {
    id: 4,
    chainId: 1,
    name: 'Beverages',
    description: null,
    imageUrl: null,
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

describe('GET /api/categories', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/categories');

    expect(response.status).toBe(401);
    expect(models.Category.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Categories read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/categories').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHORIZATION_ERROR);
    expect(models.Category.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user holding only the Products permission', async () => {
    const token = authenticateAs(
      buildActor({
        permissions: [{ moduleName: 'Products', canRead: true, canEdit: true, canDelete: true }],
      })
    );

    const response = await request(app).get('/api/categories').set('Authorization', token);

    expect(response.status).toBe(403);
  });

  it('returns a page of categories with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.Category.findAndCountAll.mockResolvedValue({ rows: [buildCategory()], count: 1 });

    const response = await request(app).get('/api/categories').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 4, chainId: 1, name: 'Beverages' });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('confines a non-owner to their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Category.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/categories').set('Authorization', token);

    expect(models.Category.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ chainId: 4 }) })
    );
  });

  it('ignores a chainId filter from a non-owner', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Category.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/categories?chainId=9').set('Authorization', token);

    expect(models.Category.findAndCountAll.mock.calls[0][0].where.chainId).toBe(4);
  });

  it('honours a chainId filter from an owner', async () => {
    const token = authenticateAs(buildOwner());
    models.Category.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/categories?chainId=9').set('Authorization', token);

    expect(models.Category.findAndCountAll.mock.calls[0][0].where.chainId).toBe(9);
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/categories?sort=chain_id;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Category.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/categories/:id', () => {
  it('returns the category', async () => {
    const token = authenticateAs(buildActor());
    models.Category.findOne.mockResolvedValue(buildCategory());

    const response = await request(app).get('/api/categories/4').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 4, name: 'Beverages' });
  });

  it('reports a category in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Category.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/categories/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(models.Category.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 99, chainId: 4 }) })
    );
  });

  it('rejects a non-numeric id', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/categories/abc').set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Category.findOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/categories', () => {
  it('denies a user without the Categories edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Snacks' });

    expect(response.status).toBe(403);
    expect(models.Category.create).not.toHaveBeenCalled();
  });

  it('creates the category and stamps the audit columns', async () => {
    const token = authenticateAs(buildActor({ id: 7, chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue({ id: 1 });
    models.Category.findOne.mockResolvedValue(null);
    models.Category.create.mockResolvedValue(buildCategory({ id: 12, name: 'Snacks' }));

    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Snacks' });

    expect(response.status).toBe(201);
    expect(models.Category.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Snacks', chainId: 1, createdBy: 7, updatedBy: 7 })
    );
  });

  it('forces a non-owner to create inside their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Chain.findByPk.mockResolvedValue({ id: 4 });
    models.Category.findOne.mockResolvedValue(null);
    models.Category.create.mockResolvedValue(buildCategory({ chainId: 4 }));

    await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Snacks', chainId: 9 });

    expect(models.Category.create.mock.calls[0][0].chainId).toBe(4);
  });

  it('lets an owner create inside another chain', async () => {
    const token = authenticateAs(buildOwner({ chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue({ id: 9 });
    models.Category.findOne.mockResolvedValue(null);
    models.Category.create.mockResolvedValue(buildCategory({ chainId: 9 }));

    await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Snacks', chainId: 9 });

    expect(models.Category.create.mock.calls[0][0].chainId).toBe(9);
  });

  it('rejects a chain that does not exist with 404', async () => {
    const token = authenticateAs(buildOwner());
    models.Chain.findByPk.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Snacks', chainId: 404 });

    expect(response.status).toBe(404);
    expect(models.Category.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name within the chain with 409', async () => {
    const token = authenticateAs(buildActor());
    models.Chain.findByPk.mockResolvedValue({ id: 1 });
    models.Category.findOne.mockResolvedValue({ id: 5 });

    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Beverages' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.Category.create).not.toHaveBeenCalled();
  });

  it('scopes the duplicate check to the chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue({ id: 1 });
    models.Category.findOne.mockResolvedValue(null);
    models.Category.create.mockResolvedValue(buildCategory());

    await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({ name: 'Beverages' });

    // The same name in another chain must not collide.
    expect(models.Category.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chainId: 1, name: 'Beverages' } })
    );
  });

  it('rejects a missing name with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });
});

describe('PUT /api/categories/:id', () => {
  it('updates the category and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const category = buildCategory();
    models.Category.findOne.mockResolvedValue(category);

    const response = await request(app)
      .put('/api/categories/4')
      .set('Authorization', token)
      .send({ description: 'Hot and cold drinks' });

    expect(response.status).toBe(200);
    expect(category.update).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Hot and cold drinks', updatedBy: 7 })
    );
  });

  it('skips the uniqueness check when the name is unchanged', async () => {
    const token = authenticateAs(buildActor());
    models.Category.findOne.mockResolvedValue(buildCategory({ name: 'Beverages' }));

    const response = await request(app)
      .put('/api/categories/4')
      .set('Authorization', token)
      .send({ name: 'Beverages' });

    expect(response.status).toBe(200);
    // One lookup only: the load. No second call for the duplicate check.
    expect(models.Category.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects renaming onto a name taken in the same chain with 409', async () => {
    const token = authenticateAs(buildActor());
    const category = buildCategory({ name: 'Beverages' });
    models.Category.findOne.mockResolvedValueOnce(category).mockResolvedValueOnce({ id: 5 });

    const response = await request(app)
      .put('/api/categories/4')
      .set('Authorization', token)
      .send({ name: 'Snacks' });

    expect(response.status).toBe(409);
    expect(category.update).not.toHaveBeenCalled();
  });

  it('ignores an attempt to move the category to another chain', async () => {
    const token = authenticateAs(buildActor());
    const category = buildCategory({ chainId: 1 });
    models.Category.findOne.mockResolvedValue(category);

    const response = await request(app)
      .put('/api/categories/4')
      .set('Authorization', token)
      .send({ imageUrl: 'https://cdn.example/x.png', chainId: 9 });

    expect(response.status).toBe(200);
    expect(category.update.mock.calls[0][0]).not.toHaveProperty('chainId');
    expect(category.chainId).toBe(1);
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/categories/4')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
    expect(models.Category.findOne).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/categories/:id', () => {
  it('denies a user without the Categories delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app).delete('/api/categories/4').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Category.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const category = buildCategory({ isActive: true });
    models.Category.findOne.mockResolvedValue(category);

    const response = await request(app).delete('/api/categories/4').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(category.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(response.body.data.isActive).toBe(false);
    expect(models.Category.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated category', async () => {
    const token = authenticateAs(buildActor());
    const category = buildCategory({ isActive: false });
    models.Category.findOne.mockResolvedValue(category);

    const response = await request(app).delete('/api/categories/4').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(category.update).not.toHaveBeenCalled();
  });

  it('reports a category in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Category.findOne.mockResolvedValue(null);

    const response = await request(app).delete('/api/categories/99').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});
