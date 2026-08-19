'use strict';

/**
 * End-to-end tests for /api/cinemas.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, parent validation, soft delete - rather
 * than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Chain: { findByPk: jest.fn() },
    Cinema: {
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

const VALID_CINEMA = { code: 'BLR-01', name: 'Starlight Indiranagar' };

function buildCinema(overrides = {}) {
  return {
    id: 3,
    chainId: 1,
    code: 'BLR-01',
    name: 'Starlight Indiranagar',
    location: null,
    city: 'Bengaluru',
    gstNumber: null,
    fssaiNumber: null,
    activeSince: null,
    smsEnabled: false,
    whatsappEnabled: false,
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

describe('GET /api/cinemas', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/cinemas');

    expect(response.status).toBe(401);
    expect(models.Cinema.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Settings read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/cinemas').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Cinema.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns a page of cinemas with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));
    models.Cinema.findAndCountAll.mockResolvedValue({ rows: [buildCinema()], count: 1 });

    const response = await request(app).get('/api/cinemas').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 3, chainId: 1, code: 'BLR-01' });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('confines a non-owner to their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinemas').set('Authorization', token);

    expect(models.Cinema.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ chainId: 4 }) })
    );
  });

  it('ignores a chainId filter from a non-owner', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinemas?chainId=9').set('Authorization', token);

    const { where } = models.Cinema.findAndCountAll.mock.calls[0][0];
    expect(where.chainId).toBe(4);
  });

  it('honours a chainId filter from an owner', async () => {
    const token = authenticateAs(buildOwner({ chainId: 1 }));
    models.Cinema.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/cinemas?chainId=9').set('Authorization', token);

    const { where } = models.Cinema.findAndCountAll.mock.calls[0][0];
    expect(where.chainId).toBe(9);
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/cinemas?sort=chain_id;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Cinema.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/cinemas/:id', () => {
  it('returns the cinema', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue(buildCinema());

    const response = await request(app).get('/api/cinemas/3').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 3, code: 'BLR-01' });
  });

  it('scopes the lookup to the actor chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/cinemas/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 99, chainId: 4 }) })
    );
  });

  it('leaves an owner unscoped', async () => {
    const token = authenticateAs(buildOwner());
    models.Cinema.findOne.mockResolvedValue(buildCinema({ chainId: 9 }));

    await request(app).get('/api/cinemas/3').set('Authorization', token);

    const { where } = models.Cinema.findOne.mock.calls[0][0];
    expect(where).not.toHaveProperty('chainId');
  });

  it('rejects a non-numeric id', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/cinemas/abc').set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/cinemas', () => {
  it('denies a user without the Settings edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send(VALID_CINEMA);

    expect(response.status).toBe(403);
    expect(models.Cinema.create).not.toHaveBeenCalled();
  });

  it('creates the cinema and stamps the audit columns', async () => {
    const token = authenticateAs(buildActor({ id: 7, chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue({ id: 1, isActive: true });
    models.Cinema.create.mockResolvedValue(buildCinema());

    const response = await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send(VALID_CINEMA);

    expect(response.status).toBe(201);
    expect(models.Cinema.create).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1, code: 'BLR-01', createdBy: 7, updatedBy: 7 })
    );
  });

  it('forces a non-owner to create inside their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Chain.findByPk.mockResolvedValue({ id: 4, isActive: true });
    models.Cinema.create.mockResolvedValue(buildCinema({ chainId: 4 }));

    await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send({ ...VALID_CINEMA, chainId: 9 });

    const [values] = models.Cinema.create.mock.calls[0];
    expect(values.chainId).toBe(4);
  });

  it('lets an owner create inside another chain', async () => {
    const token = authenticateAs(buildOwner({ chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue({ id: 9, isActive: true });
    models.Cinema.create.mockResolvedValue(buildCinema({ chainId: 9 }));

    await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send({ ...VALID_CINEMA, chainId: 9 });

    const [values] = models.Cinema.create.mock.calls[0];
    expect(values.chainId).toBe(9);
  });

  it('rejects a chain that does not exist with 404', async () => {
    const token = authenticateAs(buildOwner());
    models.Chain.findByPk.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send({ ...VALID_CINEMA, chainId: 404 });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/chain/i);
    expect(models.Cinema.create).not.toHaveBeenCalled();
  });

  it('refuses to create inside a deactivated chain with 409', async () => {
    const token = authenticateAs(buildActor({ chainId: 1 }));
    models.Chain.findByPk.mockResolvedValue({ id: 1, isActive: false });

    const response = await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send(VALID_CINEMA);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.Cinema.create).not.toHaveBeenCalled();
  });

  it('still allows updating a cinema whose chain is deactivated', async () => {
    // The rule blocks new children, it does not cascade: existing rows stay
    // editable after their parent is closed.
    const token = authenticateAs(buildActor());
    const cinema = buildCinema();
    models.Cinema.findOne.mockResolvedValue(cinema);

    const response = await request(app)
      .put('/api/cinemas/3')
      .set('Authorization', token)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(models.Chain.findByPk).not.toHaveBeenCalled();
    expect(cinema.update).toHaveBeenCalled();
  });

  it('normalises the code to upper case', async () => {
    const token = authenticateAs(buildActor());
    models.Chain.findByPk.mockResolvedValue({ id: 1, isActive: true });
    models.Cinema.create.mockResolvedValue(buildCinema());

    await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send({ ...VALID_CINEMA, code: 'blr-02' });

    const [values] = models.Cinema.create.mock.calls[0];
    expect(values.code).toBe('BLR-02');
  });

  it('rejects a code containing characters that are unsafe in a QR URL', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send({ ...VALID_CINEMA, code: 'BLR 01/x' });

    expect(response.status).toBe(400);
    expect(models.Cinema.create).not.toHaveBeenCalled();
  });

  it('rejects a missing code and name with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).post('/api/cinemas').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'code' }),
        expect.objectContaining({ field: 'name' }),
      ])
    );
  });

  it('surfaces a duplicate code from the unique constraint as 409', async () => {
    const token = authenticateAs(buildActor());
    models.Chain.findByPk.mockResolvedValue({ id: 1, isActive: true });

    // Shape the error handler recognises, without pulling in Sequelize itself.
    const { UniqueConstraintError } = require('sequelize');
    models.Cinema.create.mockRejectedValue(
      new UniqueConstraintError({ errors: [{ path: 'code', message: 'code must be unique' }] })
    );

    const response = await request(app)
      .post('/api/cinemas')
      .set('Authorization', token)
      .send(VALID_CINEMA);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
  });
});

describe('PUT /api/cinemas/:id', () => {
  it('updates the cinema and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const cinema = buildCinema();
    models.Cinema.findOne.mockResolvedValue(cinema);

    const response = await request(app)
      .put('/api/cinemas/3')
      .set('Authorization', token)
      .send({ city: 'Mysuru' });

    expect(response.status).toBe(200);
    expect(cinema.update).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Mysuru', updatedBy: 7 })
    );
  });

  it('ignores an attempt to move the cinema to another chain', async () => {
    const token = authenticateAs(buildActor());
    const cinema = buildCinema({ chainId: 1 });
    models.Cinema.findOne.mockResolvedValue(cinema);

    const response = await request(app)
      .put('/api/cinemas/3')
      .set('Authorization', token)
      .send({ city: 'Mysuru', chainId: 9 });

    expect(response.status).toBe(200);
    const [values] = cinema.update.mock.calls[0];
    expect(values).not.toHaveProperty('chainId');
    expect(cinema.chainId).toBe(1);
  });

  it('reports a cinema in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/cinemas/99')
      .set('Authorization', token)
      .send({ city: 'Mysuru' });

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 99, chainId: 4 }) })
    );
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).put('/api/cinemas/3').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
  });

  it('clears an optional text field to null rather than an empty string', async () => {
    const token = authenticateAs(buildActor());
    const cinema = buildCinema({ city: 'Bengaluru' });
    models.Cinema.findOne.mockResolvedValue(cinema);

    const response = await request(app)
      .put('/api/cinemas/3')
      .set('Authorization', token)
      .send({ city: '', location: '   ' });

    expect(response.status).toBe(200);
    const [values] = cinema.update.mock.calls[0];
    expect(values.city).toBeNull();
    // Whitespace-only counts as empty: it trims to nothing.
    expect(values.location).toBeNull();
  });

  it('leaves optional fields the request did not mention untouched', async () => {
    const token = authenticateAs(buildActor());
    const cinema = buildCinema({ city: 'Bengaluru', gstNumber: '29ABCDE1234F1Z5' });
    models.Cinema.findOne.mockResolvedValue(cinema);

    await request(app).put('/api/cinemas/3').set('Authorization', token).send({ name: 'Renamed' });

    // A partial update must not blank every optional column it omitted.
    const [values] = cinema.update.mock.calls[0];
    expect(values).not.toHaveProperty('city');
    expect(values).not.toHaveProperty('gstNumber');
    expect(cinema.city).toBe('Bengaluru');
  });

  it('still trims and rejects an over-long optional field', async () => {
    const token = authenticateAs(buildActor());
    const cinema = buildCinema();
    models.Cinema.findOne.mockResolvedValue(cinema);

    const ok = await request(app)
      .put('/api/cinemas/3')
      .set('Authorization', token)
      .send({ city: '  Mysuru  ' });

    expect(ok.status).toBe(200);
    expect(cinema.update.mock.calls[0][0].city).toBe('Mysuru');

    const tooLong = await request(app)
      .put('/api/cinemas/3')
      .set('Authorization', token)
      .send({ city: 'x'.repeat(101) });

    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.details[0].message).toMatch(/less than or equal to 100/);
  });
});

describe('DELETE /api/cinemas/:id', () => {
  it('denies a user without the Settings delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app).delete('/api/cinemas/3').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const cinema = buildCinema({ isActive: true });
    models.Cinema.findOne.mockResolvedValue(cinema);

    const response = await request(app).delete('/api/cinemas/3').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(cinema.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(response.body.data.isActive).toBe(false);
    expect(models.Cinema.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated cinema', async () => {
    const token = authenticateAs(buildActor());
    const cinema = buildCinema({ isActive: false });
    models.Cinema.findOne.mockResolvedValue(cinema);

    const response = await request(app).delete('/api/cinemas/3').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(cinema.update).not.toHaveBeenCalled();
  });

  it('reports a cinema in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app).delete('/api/cinemas/99').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});
