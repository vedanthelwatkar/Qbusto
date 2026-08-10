'use strict';

/**
 * End-to-end tests for /api/product-availability-hours.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, two-level tenant scoping, the time-range rule, overlap
 * detection, hard delete - rather than the SQL it emits.
 */

const request = require('supertest');
const { Op } = require('sequelize');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    CinemaProduct: { findOne: jest.fn() },
    ProductAvailabilityHour: {
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

const VALID_WINDOW = { cinemaProductId: 12, dayOfWeek: 1, startTime: '09:00', endTime: '17:30' };

function buildHour(overrides = {}) {
  return {
    id: 31,
    cinemaProductId: 12,
    dayOfWeek: 1,
    startTime: '09:00:00',
    endTime: '17:30:00',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    update: jest.fn(function update(values) {
      Object.assign(this, values);
      return Promise.resolve(this);
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
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

/** The nested cinema filter carried by the cinemaProduct include. */
function nestedCinemaWhere(mockCall) {
  const cinemaProduct = mockCall.include.find((e) => e.association === 'cinemaProduct');
  return cinemaProduct.include.find((e) => e.association === 'cinema').where;
}

describe('GET /api/product-availability-hours', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/product-availability-hours');

    expect(response.status).toBe(401);
    expect(models.ProductAvailabilityHour.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Products read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app)
      .get('/api/product-availability-hours')
      .set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.ProductAvailabilityHour.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns a page of windows with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.ProductAvailabilityHour.findAndCountAll.mockResolvedValue({
      rows: [buildHour()],
      count: 1,
    });

    const response = await request(app)
      .get('/api/product-availability-hours')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      id: 31,
      cinemaProductId: 12,
      startTime: '09:00:00',
    });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, total: 1 });
  });

  it('scopes a non-owner through the nested cinema join', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductAvailabilityHour.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/product-availability-hours').set('Authorization', token);

    expect(
      nestedCinemaWhere(models.ProductAvailabilityHour.findAndCountAll.mock.calls[0][0])
    ).toEqual({ chainId: 4 });
  });

  it('leaves an owner unfiltered while keeping both joins required', async () => {
    const token = authenticateAs(buildOwner());
    models.ProductAvailabilityHour.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/product-availability-hours').set('Authorization', token);

    const call = models.ProductAvailabilityHour.findAndCountAll.mock.calls[0][0];
    const cinemaProduct = call.include.find((e) => e.association === 'cinemaProduct');
    expect(cinemaProduct.required).toBe(true);
    expect(cinemaProduct.include[0].required).toBe(true);
    expect(cinemaProduct.include[0].where).toBeUndefined();
  });

  it('rejects a dayOfWeek outside 0-7', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/product-availability-hours?dayOfWeek=8')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.ProductAvailabilityHour.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/product-availability-hours/:id', () => {
  it('returns the window', async () => {
    const token = authenticateAs(buildActor());
    models.ProductAvailabilityHour.findOne.mockResolvedValue(buildHour());

    const response = await request(app)
      .get('/api/product-availability-hours/31')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 31, dayOfWeek: 1 });
  });

  it('renders a driver-supplied Date time as HH:MM:SS', async () => {
    // The driver returns a TIME column as a Date pinned to 1970-01-01 in UTC.
    // Emitting that untouched would produce '1970-01-01T09:00:00.000Z', which
    // this endpoint's own validator rejects - a client could not send back what
    // it just read.
    const token = authenticateAs(buildActor());
    models.ProductAvailabilityHour.findOne.mockResolvedValue(
      buildHour({
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 17, 5, 30)),
      })
    );

    const response = await request(app)
      .get('/api/product-availability-hours/31')
      .set('Authorization', token);

    expect(response.body.data.startTime).toBe('09:00:00');
    expect(response.body.data.endTime).toBe('17:05:30');
  });

  it('reports a window in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductAvailabilityHour.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/product-availability-hours/99')
      .set('Authorization', token);

    expect(response.status).toBe(404);
    expect(nestedCinemaWhere(models.ProductAvailabilityHour.findOne.mock.calls[0][0])).toEqual({
      chainId: 4,
    });
  });
});

describe('POST /api/product-availability-hours', () => {
  it('denies a user without the Products edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send(VALID_WINDOW);

    expect(response.status).toBe(403);
    expect(models.ProductAvailabilityHour.create).not.toHaveBeenCalled();
  });

  it('creates the window and normalises HH:MM to HH:MM:SS', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    models.CinemaProduct.findOne.mockResolvedValue({ id: 12, cinemaId: 3, productId: 17 });
    models.ProductAvailabilityHour.findOne.mockResolvedValue(null);
    models.ProductAvailabilityHour.create.mockResolvedValue(buildHour());

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send(VALID_WINDOW);

    expect(response.status).toBe(201);
    expect(models.ProductAvailabilityHour.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cinemaProductId: 12,
        startTime: '09:00:00',
        endTime: '17:30:00',
        createdBy: 7,
        updatedBy: 7,
      })
    );
  });

  it('rejects a cinema product in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.CinemaProduct.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send(VALID_WINDOW);

    expect(response.status).toBe(404);
    expect(models.ProductAvailabilityHour.create).not.toHaveBeenCalled();
  });

  it('rejects endTime equal to startTime with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send({ ...VALID_WINDOW, startTime: '09:00', endTime: '09:00' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('endTime');
    expect(models.CinemaProduct.findOne).not.toHaveBeenCalled();
  });

  it('rejects an overnight window, since endTime must be later than startTime', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send({ ...VALID_WINDOW, startTime: '22:00', endTime: '02:00' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('endTime');
  });

  it('rejects a malformed time with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send({ ...VALID_WINDOW, startTime: '9am' });

    expect(response.status).toBe(400);
  });

  it('rejects an overlapping window with 409', async () => {
    const token = authenticateAs(buildActor());
    models.CinemaProduct.findOne.mockResolvedValue({ id: 12, cinemaId: 3, productId: 17 });
    models.ProductAvailabilityHour.findOne.mockResolvedValue(
      buildHour({ id: 30, startTime: '12:00:00', endTime: '20:00:00' })
    );

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send(VALID_WINDOW);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(response.body.error.details.conflictingId).toBe(30);
    expect(models.ProductAvailabilityHour.create).not.toHaveBeenCalled();
  });

  it('checks a specific day against that day and against day 0', async () => {
    const token = authenticateAs(buildActor());
    models.CinemaProduct.findOne.mockResolvedValue({ id: 12, cinemaId: 3, productId: 17 });
    models.ProductAvailabilityHour.findOne.mockResolvedValue(null);
    models.ProductAvailabilityHour.create.mockResolvedValue(buildHour());

    await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send({ ...VALID_WINDOW, dayOfWeek: 3 });

    const { where } = models.ProductAvailabilityHour.findOne.mock.calls[0][0];
    expect(where.dayOfWeek).toEqual({ [Op.in]: [0, 3] });
    // Strict comparisons, so touching ranges do not count as overlapping.
    expect(where.startTime).toEqual({ [Op.lt]: '17:30:00' });
    expect(where.endTime).toEqual({ [Op.gt]: '09:00:00' });
  });

  it('checks an every-day window against every day, with no day filter', async () => {
    const token = authenticateAs(buildActor());
    models.CinemaProduct.findOne.mockResolvedValue({ id: 12, cinemaId: 3, productId: 17 });
    models.ProductAvailabilityHour.findOne.mockResolvedValue(null);
    models.ProductAvailabilityHour.create.mockResolvedValue(buildHour());

    await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send({ ...VALID_WINDOW, dayOfWeek: 0 });

    expect(models.ProductAvailabilityHour.findOne.mock.calls[0][0].where).not.toHaveProperty(
      'dayOfWeek'
    );
  });

  it('rejects a missing body with 400', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/product-availability-hours')
      .set('Authorization', token)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'cinemaProductId' }),
        expect.objectContaining({ field: 'dayOfWeek' }),
        expect.objectContaining({ field: 'startTime' }),
      ])
    );
  });
});

describe('PUT /api/product-availability-hours/:id', () => {
  it('updates the window and excludes itself from the overlap check', async () => {
    const token = authenticateAs(buildActor({ id: 7 }));
    const hour = buildHour({ id: 31, cinemaProductId: 12 });
    models.ProductAvailabilityHour.findOne.mockResolvedValueOnce(hour).mockResolvedValueOnce(null);

    const response = await request(app)
      .put('/api/product-availability-hours/31')
      .set('Authorization', token)
      .send({ dayOfWeek: 1, startTime: '10:00', endTime: '18:00' });

    expect(response.status).toBe(200);
    expect(models.ProductAvailabilityHour.findOne.mock.calls[1][0].where.id).toEqual({
      [Op.ne]: 31,
    });
    expect(hour.update).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: '10:00:00', endTime: '18:00:00', updatedBy: 7 })
    );
  });

  it('requires the whole range', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/product-availability-hours/31')
      .set('Authorization', token)
      .send({ startTime: '10:00' });

    expect(response.status).toBe(400);
    expect(models.ProductAvailabilityHour.findOne).not.toHaveBeenCalled();
  });

  it('reports a window in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductAvailabilityHour.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/product-availability-hours/99')
      .set('Authorization', token)
      .send({ dayOfWeek: 1, startTime: '10:00', endTime: '18:00' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/product-availability-hours/:id', () => {
  it('denies a user without the Products delete permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .delete('/api/product-availability-hours/31')
      .set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.ProductAvailabilityHour.findOne).not.toHaveBeenCalled();
  });

  it('hard deletes, because the table has no is_active column', async () => {
    const token = authenticateAs(buildActor());
    const hour = buildHour();
    models.ProductAvailabilityHour.findOne.mockResolvedValue(hour);

    const response = await request(app)
      .delete('/api/product-availability-hours/31')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(hour.destroy).toHaveBeenCalled();
    expect(hour.update).not.toHaveBeenCalled();
    // Returned as it last existed, so a client can undo by re-creating it.
    expect(response.body.data).toMatchObject({ id: 31, startTime: '09:00:00' });
  });

  it('reports a window in another chain as 404 without deleting', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.ProductAvailabilityHour.findOne.mockResolvedValue(null);

    const response = await request(app)
      .delete('/api/product-availability-hours/99')
      .set('Authorization', token);

    expect(response.status).toBe(404);
    expect(models.ProductAvailabilityHour.destroy).not.toHaveBeenCalled();
  });
});
