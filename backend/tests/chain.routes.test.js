'use strict';

/**
 * End-to-end tests for /api/chains.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, duplicate names, soft delete - rather than
 * the SQL it emits.
 *
 * `Chain.findByPk` loads an addressed chain; `Chain.findOne` is only ever the
 * duplicate-name lookup. Keeping them separate is what lets these tests tell the
 * two apart.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Chain: {
      findOne: jest.fn(),
      findByPk: jest.fn(),
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

const SETTINGS_FULL = [{ moduleName: 'Settings', canRead: true, canEdit: true, canDelete: true }];
const SETTINGS_READ = [{ moduleName: 'Settings', canRead: true, canEdit: false, canDelete: false }];

function buildChain(overrides = {}) {
  return {
    id: 1,
    name: 'Starlight Cinemas',
    logoImageUrl: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    // Mirrors Sequelize: the instance reflects the change afterwards.
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
    permissions: SETTINGS_FULL,
    ...overrides,
  };
}

/** An owner bypasses the permission table entirely, so they need no grants. */
function buildOwner(overrides = {}) {
  return buildActor({ role: 'owner', permissions: [], ...overrides });
}

/** Point authenticate() at `actor` and return its Authorization header. */
function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return `Bearer ${generateAccessToken({ sub: actor.id, role: actor.role })}`;
}

describe('GET /api/chains', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/chains');

    expect(response.status).toBe(401);
    expect(models.Chain.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Settings read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/chains').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHORIZATION_ERROR);
    expect(models.Chain.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns a page of chains with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));
    models.Chain.findAndCountAll.mockResolvedValue({ rows: [buildChain()], count: 1 });

    const response = await request(app)
      .get('/api/chains?page=1&limit=20')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: 1, name: 'Starlight Cinemas' });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('confines a non-owner to their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Chain.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/chains').set('Authorization', token);

    expect(models.Chain.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 4 }) })
    );
  });

  it('leaves an owner unscoped', async () => {
    const token = authenticateAs(buildOwner());
    models.Chain.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/chains').set('Authorization', token);

    const { where } = models.Chain.findAndCountAll.mock.calls[0][0];
    expect(where).not.toHaveProperty('id');
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/chains?sort=passwordHash')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Chain.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/chains/:id', () => {
  it('returns the chain', async () => {
    const token = authenticateAs(buildActor());
    models.Chain.findByPk.mockResolvedValue(buildChain());

    const response = await request(app).get('/api/chains/1').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 1, name: 'Starlight Cinemas' });
  });

  it('reports another chain as 404 rather than returning the actor own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 1 }));

    const response = await request(app).get('/api/chains/99').set('Authorization', token);

    expect(response.status).toBe(404);
    // The guard runs before any query: nothing is loaded, so nothing can leak.
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
  });

  it('lets an owner read any chain', async () => {
    const token = authenticateAs(buildOwner({ chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue(buildChain({ id: 99 }));

    const response = await request(app).get('/api/chains/99').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(99);
  });

  it('rejects a non-numeric id', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/chains/abc').set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
  });
});

describe('POST /api/chains', () => {
  it('denies a user without the Settings edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app)
      .post('/api/chains')
      .set('Authorization', token)
      .send({ name: 'New Chain' });

    expect(response.status).toBe(403);
    expect(models.Chain.create).not.toHaveBeenCalled();
  });

  it('denies a non-owner even with the Settings edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_FULL }));

    const response = await request(app)
      .post('/api/chains')
      .set('Authorization', token)
      .send({ name: 'New Chain' });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/owner/i);
    expect(models.Chain.create).not.toHaveBeenCalled();
  });

  it('creates the chain for an owner and stamps the audit columns', async () => {
    const token = authenticateAs(buildOwner({ id: 3 }));
    models.Chain.findOne.mockResolvedValue(null);
    models.Chain.create.mockResolvedValue(buildChain({ id: 12, name: 'New Chain' }));

    const response = await request(app)
      .post('/api/chains')
      .set('Authorization', token)
      .send({ name: 'New Chain' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 12, name: 'New Chain' });
    expect(models.Chain.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Chain', createdBy: 3, updatedBy: 3 })
    );
  });

  it('rejects a duplicate name with 409', async () => {
    const token = authenticateAs(buildOwner());
    models.Chain.findOne.mockResolvedValue({ id: 5 });

    const response = await request(app)
      .post('/api/chains')
      .set('Authorization', token)
      .send({ name: 'Starlight Cinemas' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.Chain.create).not.toHaveBeenCalled();
  });

  it('rejects a missing name with 400', async () => {
    const token = authenticateAs(buildOwner());

    const response = await request(app).post('/api/chains').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(models.Chain.create).not.toHaveBeenCalled();
  });

  it('strips unknown fields rather than passing them to the model', async () => {
    const token = authenticateAs(buildOwner({ id: 3 }));
    models.Chain.findOne.mockResolvedValue(null);
    models.Chain.create.mockResolvedValue(buildChain());

    await request(app)
      .post('/api/chains')
      .set('Authorization', token)
      .send({ name: 'New Chain', id: 999, createdBy: 4242 });

    const [values] = models.Chain.create.mock.calls[0];
    expect(values).not.toHaveProperty('id');
    expect(values.createdBy).toBe(3);
  });
});

describe('PUT /api/chains/:id', () => {
  it('updates the chain and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const chain = buildChain();
    models.Chain.findByPk.mockResolvedValue(chain);

    const response = await request(app)
      .put('/api/chains/1')
      .set('Authorization', token)
      .send({ logoImageUrl: 'https://cdn.example/logo.png' });

    expect(response.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ logoImageUrl: 'https://cdn.example/logo.png', updatedBy: 7 })
    );
  });

  it('skips the uniqueness check when the name is unchanged', async () => {
    const token = authenticateAs(buildActor());
    models.Chain.findByPk.mockResolvedValue(buildChain({ name: 'Starlight Cinemas' }));

    const response = await request(app)
      .put('/api/chains/1')
      .set('Authorization', token)
      .send({ name: 'Starlight Cinemas' });

    expect(response.status).toBe(200);
    expect(models.Chain.findOne).not.toHaveBeenCalled();
  });

  it('rejects renaming onto an existing name with 409', async () => {
    const token = authenticateAs(buildActor());
    const chain = buildChain({ name: 'Starlight Cinemas' });
    models.Chain.findByPk.mockResolvedValue(chain);
    models.Chain.findOne.mockResolvedValue({ id: 5 });

    const response = await request(app)
      .put('/api/chains/1')
      .set('Authorization', token)
      .send({ name: 'Taken Name' });

    expect(response.status).toBe(409);
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('reports another chain as 404 without loading it', async () => {
    const token = authenticateAs(buildActor({ chainId: 1 }));

    const response = await request(app)
      .put('/api/chains/99')
      .set('Authorization', token)
      .send({ name: 'Whatever' });

    expect(response.status).toBe(404);
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).put('/api/chains/1').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/chains/:id', () => {
  it('denies a user without the Settings delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app).delete('/api/chains/1').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const chain = buildChain({ isActive: true });
    models.Chain.findByPk.mockResolvedValue(chain);

    const response = await request(app).delete('/api/chains/1').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(response.body.data.isActive).toBe(false);
    expect(models.Chain.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated chain', async () => {
    const token = authenticateAs(buildActor());
    const chain = buildChain({ isActive: false });
    models.Chain.findByPk.mockResolvedValue(chain);

    const response = await request(app).delete('/api/chains/1').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('reports another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 1 }));

    const response = await request(app).delete('/api/chains/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
  });
});
