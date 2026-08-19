'use strict';

/**
 * End-to-end tests for /api/banners.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, sequence uniqueness, the date-window rule,
 * soft delete - rather than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Cinema: { findOne: jest.fn() },
    Banner: {
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

const FULL = [{ moduleName: 'Banners', canRead: true, canEdit: true, canDelete: true }];
const READ_ONLY = [{ moduleName: 'Banners', canRead: true, canEdit: false, canDelete: false }];

const VALID_BANNER = { cinemaId: 3, imageUrl: 'https://cdn.example/b1.png' };

function buildBanner(overrides = {}) {
  return {
    id: 9,
    cinemaId: 3,
    imageUrl: 'https://cdn.example/b1.png',
    type: 'H',
    sequence: 1,
    startDate: null,
    endDate: null,
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

describe('GET /api/banners', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/banners');

    expect(response.status).toBe(401);
    expect(models.Banner.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Banners read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/banners').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Banner.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns several banners for one cinema, ordered by sequence by default', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.Banner.findAndCountAll.mockResolvedValue({
      rows: [buildBanner({ id: 9, sequence: 1 }), buildBanner({ id: 10, sequence: 2 })],
      count: 2,
    });

    const response = await request(app).get('/api/banners?cinemaId=3').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    // Several images for one cinema is how "multiple banner images" is modelled.
    expect(response.body.data.map((b) => b.sequence)).toEqual([1, 2]);
    expect(models.Banner.findAndCountAll.mock.calls[0][0].order).toEqual([['sequence', 'ASC']]);
  });

  it('scopes a non-owner through the cinema join', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Banner.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/banners').set('Authorization', token);

    expect(cinemaInclude(models.Banner.findAndCountAll.mock.calls[0][0])).toMatchObject({
      required: true,
      where: { chainId: 4 },
    });
  });

  it('leaves an owner unfiltered while keeping the join', async () => {
    const token = authenticateAs(buildOwner());
    models.Banner.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/banners').set('Authorization', token);

    const include = cinemaInclude(models.Banner.findAndCountAll.mock.calls[0][0]);
    expect(include.where).toBeUndefined();
    expect(include.required).toBe(true);
  });

  it('filters by banner type', async () => {
    const token = authenticateAs(buildActor());
    models.Banner.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/banners?type=i').set('Authorization', token);

    expect(models.Banner.findAndCountAll.mock.calls[0][0].where.type).toBe('I');
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/banners?sort=cinema_id;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Banner.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/banners/:id', () => {
  it('returns the banner', async () => {
    const token = authenticateAs(buildActor());
    models.Banner.findOne.mockResolvedValue(buildBanner());

    const response = await request(app).get('/api/banners/9').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 9, type: 'H', sequence: 1 });
  });

  it('reports a banner in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Banner.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/banners/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.Banner.findOne.mock.calls[0][0]).where).toEqual({ chainId: 4 });
  });
});

describe('POST /api/banners', () => {
  it('denies a user without the Banners edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send(VALID_BANNER);

    expect(response.status).toBe(403);
    expect(models.Banner.create).not.toHaveBeenCalled();
  });

  it('creates the banner and stamps the audit columns', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Banner.findOne.mockResolvedValue(null);
    models.Banner.create.mockResolvedValue(buildBanner());

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({ ...VALID_BANNER, sequence: 1 });

    expect(response.status).toBe(201);
    expect(models.Banner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cinemaId: 3,
        sequence: 1,
        type: 'H',
        createdBy: 7,
        updatedBy: 7,
      })
    );
  });

  it('refuses to create against a deactivated cinema with 409', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: false });

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send(VALID_BANNER);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.Banner.create).not.toHaveBeenCalled();
  });

  it('reports a cinema in another chain as 404, not 409', async () => {
    // Scope is applied by the query, so an out-of-chain cinema never comes back
    // and its active state must not leak through the status code.
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({ ...VALID_BANNER, cinemaId: 99 });

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, chainId: 4 } })
    );
  });

  it('rejects a duplicate sequence within the cinema with 409', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Banner.findOne.mockResolvedValue({ id: 9 });

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({ ...VALID_BANNER, sequence: 1 });

    expect(response.status).toBe(409);
    expect(models.Banner.create).not.toHaveBeenCalled();
  });

  it('scopes the sequence check to the cinema', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Banner.findOne.mockResolvedValue(null);
    models.Banner.create.mockResolvedValue(buildBanner());

    await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({ ...VALID_BANNER, sequence: 2 });

    // The same sequence in another cinema must not collide.
    expect(models.Banner.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cinemaId: 3, sequence: 2 } })
    );
  });

  it('rejects endDate before startDate with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({
        ...VALID_BANNER,
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-05-01T00:00:00Z',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('endDate');
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
  });

  it('accepts equal start and end dates', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
    models.Banner.findOne.mockResolvedValue(null);
    models.Banner.create.mockResolvedValue(buildBanner());

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({
        ...VALID_BANNER,
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-06-01T00:00:00Z',
      });

    expect(response.status).toBe(201);
  });

  it('rejects a banner type outside H and I with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/banners')
      .set('Authorization', token)
      .send({ ...VALID_BANNER, type: 'X' });

    expect(response.status).toBe(400);
  });

  it('rejects a missing cinemaId and imageUrl with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).post('/api/banners').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'cinemaId' }),
        expect.objectContaining({ field: 'imageUrl' }),
      ])
    );
  });
});

describe('PUT /api/banners/:id', () => {
  it('updates the banner and stamps updatedBy', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const banner = buildBanner();
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ imageUrl: 'https://cdn.example/b2.png' });

    expect(response.status).toBe(200);
    expect(banner.update).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: 'https://cdn.example/b2.png', updatedBy: 7 })
    );
  });

  it('skips the sequence check when the sequence is unchanged', async () => {
    const token = authenticateAs(buildActor());
    models.Banner.findOne.mockResolvedValue(buildBanner({ sequence: 1 }));

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ sequence: 1 });

    expect(response.status).toBe(200);
    // One lookup only: the load. No second call for the sequence check.
    expect(models.Banner.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects moving onto a sequence taken in the same cinema with 409', async () => {
    const token = authenticateAs(buildActor());
    const banner = buildBanner({ id: 9, cinemaId: 3, sequence: 1 });
    models.Banner.findOne.mockResolvedValueOnce(banner).mockResolvedValueOnce({ id: 10 });

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ sequence: 2 });

    expect(response.status).toBe(409);
    expect(banner.update).not.toHaveBeenCalled();
  });

  it('checks a new endDate against the stored startDate', async () => {
    // The request schema cannot see this: only one end of the window is sent.
    const token = authenticateAs(buildActor());
    const banner = buildBanner({ startDate: new Date('2026-06-01T00:00:00Z'), endDate: null });
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ endDate: '2026-05-01T00:00:00Z' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('endDate');
    expect(banner.update).not.toHaveBeenCalled();
  });

  it('checks a new startDate against the stored endDate', async () => {
    const token = authenticateAs(buildActor());
    const banner = buildBanner({ startDate: null, endDate: new Date('2026-05-01T00:00:00Z') });
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ startDate: '2026-06-01T00:00:00Z' });

    expect(response.status).toBe(400);
    expect(banner.update).not.toHaveBeenCalled();
  });

  it('allows clearing one end of the window', async () => {
    const token = authenticateAs(buildActor());
    const banner = buildBanner({ startDate: new Date('2026-06-01T00:00:00Z') });
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ endDate: null });

    expect(response.status).toBe(200);
  });

  it('ignores an attempt to move the banner to another cinema', async () => {
    const token = authenticateAs(buildActor());
    const banner = buildBanner({ cinemaId: 3 });
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app)
      .put('/api/banners/9')
      .set('Authorization', token)
      .send({ imageUrl: 'https://cdn.example/b3.png', cinemaId: 99 });

    expect(response.status).toBe(200);
    expect(banner.update.mock.calls[0][0]).not.toHaveProperty('cinemaId');
    expect(banner.cinemaId).toBe(3);
  });

  it('reports a banner in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Banner.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/banners/99')
      .set('Authorization', token)
      .send({ sequence: 3 });

    expect(response.status).toBe(404);
  });

  it('rejects an empty body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).put('/api/banners/9').set('Authorization', token).send({});

    expect(response.status).toBe(400);
    expect(models.Banner.findOne).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/banners/:id', () => {
  it('denies a user without the Banners delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app).delete('/api/banners/9').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Banner.findOne).not.toHaveBeenCalled();
  });

  it('soft deletes rather than destroying the row', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const banner = buildBanner({ isActive: true });
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app).delete('/api/banners/9').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(banner.update).toHaveBeenCalledWith({ isActive: false, updatedBy: 7 });
    expect(response.body.data.isActive).toBe(false);
    expect(models.Banner.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already deactivated banner', async () => {
    const token = authenticateAs(buildActor());
    const banner = buildBanner({ isActive: false });
    models.Banner.findOne.mockResolvedValue(banner);

    const response = await request(app).delete('/api/banners/9').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(banner.update).not.toHaveBeenCalled();
  });

  it('reports a banner in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Banner.findOne.mockResolvedValue(null);

    const response = await request(app).delete('/api/banners/99').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});
