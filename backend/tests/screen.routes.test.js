'use strict';

/**
 * End-to-end tests for /api/screens.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping through the parent cinema, duplicate names
 * within a cinema, soft delete - rather than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Cinema: { findOne: jest.fn() },
    Screen: {
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

const SETTINGS_FULL = [{ moduleName: 'Settings', canRead: true, canEdit: true, canDelete: true }];
const SETTINGS_READ = [{ moduleName: 'Settings', canRead: true, canEdit: false, canDelete: false }];

function buildScreen(overrides = {}) {
  return {
    id: 8,
    cinemaId: 3,
    name: 'Screen 1',
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
    permissions: SETTINGS_FULL,
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

/** The `cinema` entry of an include list, whatever else is alongside it. */
function cinemaInclude(mockCall) {
  return mockCall.include.find((entry) => entry.association === 'cinema');
}

describe('GET /api/screens', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/screens');

    expect(response.status).toBe(401);
    expect(models.Screen.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Settings read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/screens').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Screen.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns a page of screens with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));
    models.Screen.findAndCountAll.mockResolvedValue({ rows: [buildScreen()], count: 1 });

    const response = await request(app).get('/api/screens').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 8, cinemaId: 3, name: 'Screen 1' });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('scopes a non-owner through an inner join on their chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Screen.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/screens').set('Authorization', token);

    const include = cinemaInclude(models.Screen.findAndCountAll.mock.calls[0][0]);
    expect(include).toMatchObject({ required: true, where: { chainId: 4 } });
  });

  it('leaves an owner unfiltered while keeping the join', async () => {
    const token = authenticateAs(buildOwner());
    models.Screen.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/screens').set('Authorization', token);

    const include = cinemaInclude(models.Screen.findAndCountAll.mock.calls[0][0]);
    expect(include.where).toBeUndefined();
    expect(include.required).toBe(true);
  });

  it('keeps the tenant join when filtering by a cinema in another chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Screen.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/screens?cinemaId=99').set('Authorization', token);

    const call = models.Screen.findAndCountAll.mock.calls[0][0];
    expect(call.where.cinemaId).toBe(99);
    // The filter narrows an already-scoped set; it cannot widen it.
    expect(cinemaInclude(call).where).toEqual({ chainId: 4 });
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/screens?sort=name;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Screen.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/screens/:id', () => {
  it('returns the screen', async () => {
    const token = authenticateAs(buildActor());
    models.Screen.findOne.mockResolvedValue(buildScreen());

    const response = await request(app).get('/api/screens/8').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 8, name: 'Screen 1' });
  });

  it('reports a screen in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    // The inner join drops it, so the row simply does not come back.
    models.Screen.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/screens/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.Screen.findOne.mock.calls[0][0]).where).toEqual({ chainId: 4 });
  });

  it('rejects a non-numeric id', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/screens/abc').set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Screen.findOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/screens', () => {
  it('denies a user without the Settings edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 3, name: 'Screen 2' });

    expect(response.status).toBe(403);
    expect(models.Screen.create).not.toHaveBeenCalled();
  });

  it('creates the screen and stamps the audit columns', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Screen.findOne.mockResolvedValue(null);
    models.Screen.create.mockResolvedValue(buildScreen({ id: 20, name: 'Screen 2' }));

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 3, name: 'Screen 2' });

    expect(response.status).toBe(201);
    expect(models.Screen.create).toHaveBeenCalledWith(
      expect.objectContaining({ cinemaId: 3, name: 'Screen 2', createdBy: 7, updatedBy: 7 })
    );
  });

  it('rejects a cinema in another chain as 404 without creating anything', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 99, name: 'Screen 2' });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/cinema/i);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, chainId: 4 } })
    );
    expect(models.Screen.create).not.toHaveBeenCalled();
  });

  it('does not scope the cinema lookup for an owner', async () => {
    const token = authenticateAs(buildOwner({ chainId: 1 }));
    models.Cinema.findOne.mockResolvedValue({ id: 99, chainId: 9, isActive: true });
    models.Screen.findOne.mockResolvedValue(null);
    models.Screen.create.mockResolvedValue(buildScreen({ cinemaId: 99 }));

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 99, name: 'Screen 2' });

    expect(response.status).toBe(201);
    const { where } = models.Cinema.findOne.mock.calls[0][0];
    expect(where).not.toHaveProperty('chainId');
  });

  it('refuses to create inside a deactivated cinema with 409', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: false });

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 3, name: 'Screen 2' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.Screen.create).not.toHaveBeenCalled();
  });

  it('reports a deactivated cinema in another chain as 404, not 409', async () => {
    // Scope is checked by the query itself, so an out-of-chain cinema never
    // comes back at all - its active state must not leak through the status.
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 99, name: 'Screen 2' });

    expect(response.status).toBe(404);
  });

  it('still allows updating a screen whose cinema is deactivated', async () => {
    // The rule blocks new children, it does not cascade.
    const token = authenticateAs(buildActor());
    const screen = buildScreen();
    models.Screen.findOne.mockResolvedValue(screen);

    const response = await request(app)
      .put('/api/screens/8')
      .set('Authorization', token)
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
    expect(screen.update).toHaveBeenCalled();
  });

  it('rejects a duplicate name within the same cinema with 409', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Screen.findOne.mockResolvedValue({ id: 8 });

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 3, name: 'Screen 1' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.Screen.create).not.toHaveBeenCalled();
  });

  it('scopes the duplicate check to the one cinema', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Screen.findOne.mockResolvedValue(null);
    models.Screen.create.mockResolvedValue(buildScreen());

    await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 3, name: 'Screen 1' });

    // Same name in a different cinema must not collide, so cinemaId is part of
    // the lookup rather than the name alone.
    expect(models.Screen.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cinemaId: 3, name: 'Screen 1' } })
    );
  });

  it('rejects a missing cinemaId and name with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).post('/api/screens').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'cinemaId' }),
        expect.objectContaining({ field: 'name' }),
      ])
    );
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
  });

  it('rejects a name longer than the column', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/screens')
      .set('Authorization', token)
      .send({ cinemaId: 3, name: 'x'.repeat(51) });

    expect(response.status).toBe(400);
    expect(models.Screen.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/screens/:id', () => {
  it('renames the screen and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const screen = buildScreen({ name: 'Screen 1' });
    models.Screen.findOne.mockResolvedValueOnce(screen).mockResolvedValueOnce(null);
    models.Screen.create.mockResolvedValue(screen);

    const response = await request(app)
      .put('/api/screens/8')
      .set('Authorization', token)
      .send({ name: 'IMAX' });

    expect(response.status).toBe(200);
    expect(screen.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'IMAX', updatedBy: 7 })
    );
  });

  it('skips the uniqueness check when the name is unchanged', async () => {
    const token = authenticateAs(buildActor());
    models.Screen.findOne.mockResolvedValue(buildScreen({ name: 'Screen 1' }));

    const response = await request(app)
      .put('/api/screens/8')
      .set('Authorization', token)
      .send({ name: 'Screen 1', isActive: true });

    expect(response.status).toBe(200);
    // One lookup only: the load. No second call for the duplicate check.
    expect(models.Screen.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects renaming onto a name taken in the same cinema with 409', async () => {
    const token = authenticateAs(buildActor());
    const screen = buildScreen({ id: 8, cinemaId: 3, name: 'Screen 1' });
    models.Screen.findOne.mockResolvedValueOnce(screen).mockResolvedValueOnce({ id: 9 });

    const response = await request(app)
      .put('/api/screens/8')
      .set('Authorization', token)
      .send({ name: 'IMAX' });

    expect(response.status).toBe(409);
    expect(screen.update).not.toHaveBeenCalled();
    // Excludes the row being renamed, so a screen never collides with itself.
    const [duplicateLookup] = models.Screen.findOne.mock.calls[1];
    expect(duplicateLookup.where).toMatchObject({ cinemaId: 3, name: 'IMAX' });
    expect(duplicateLookup.where.id).toBeDefined();
  });

  it('ignores an attempt to move the screen to another cinema', async () => {
    const token = authenticateAs(buildActor());
    const screen = buildScreen({ cinemaId: 3 });
    models.Screen.findOne.mockResolvedValue(screen);

    const response = await request(app)
      .put('/api/screens/8')
      .set('Authorization', token)
      .send({ isActive: false, cinemaId: 99 });

    expect(response.status).toBe(200);
    const [values] = screen.update.mock.calls[0];
    expect(values).not.toHaveProperty('cinemaId');
    expect(screen.cinemaId).toBe(3);
  });

  it('reports a screen in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Screen.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/screens/99')
      .set('Authorization', token)
      .send({ name: 'IMAX' });

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.Screen.findOne.mock.calls[0][0]).where).toEqual({ chainId: 4 });
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).put('/api/screens/8').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(models.Screen.findOne).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/screens/:id', () => {
  it('denies a user without the Settings delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app).delete('/api/screens/8').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Screen.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const screen = buildScreen({ isActive: true });
    models.Screen.findOne.mockResolvedValue(screen);

    const response = await request(app).delete('/api/screens/8').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(screen.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(response.body.data.isActive).toBe(false);
    expect(models.Screen.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated screen', async () => {
    const token = authenticateAs(buildActor());
    const screen = buildScreen({ isActive: false });
    models.Screen.findOne.mockResolvedValue(screen);

    const response = await request(app).delete('/api/screens/8').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(screen.update).not.toHaveBeenCalled();
  });

  it('reports a screen in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Screen.findOne.mockResolvedValue(null);

    const response = await request(app).delete('/api/screens/99').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});
