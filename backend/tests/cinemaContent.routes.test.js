'use strict';

/**
 * End-to-end tests for /api/cinemas/{id}/content.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * tenant scoping via the cinema (there is no chainId on cinema_content
 * itself), the "no row yet" empty shape, and the JSON encode/decode of
 * tncPoints - rather than the SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Cinema: { findOne: jest.fn() },
    CinemaContent: {
      findOne: jest.fn(),
      create: jest.fn(),
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

const app = createApp();

const SETTINGS_FULL = [{ moduleName: 'Settings', canRead: true, canEdit: true, canDelete: true }];
const SETTINGS_READ = [{ moduleName: 'Settings', canRead: true, canEdit: false, canDelete: false }];

function buildContentRow(overrides = {}) {
  return {
    cinemaId: 8,
    contactNo: '9999999999',
    mailId: 'contactus@1cinema.co',
    tncPoints: JSON.stringify(['All food items are prepared in a hygienic environment.']),
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

function buildOwner(overrides = {}) {
  return buildActor({ role: 'owner', permissions: [], ...overrides });
}

function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return `Bearer ${generateAccessToken({ sub: actor.id, role: actor.role })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/cinemas/:id/content', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/cinemas/8/content');

    expect(response.status).toBe(401);
  });

  it('denies a user without the Settings read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/cinemas/8/content').set('Authorization', token);

    expect(response.status).toBe(403);
  });

  it('404s when the cinema is out of the actor chain scope', async () => {
    const token = authenticateAs(buildActor({ chainId: 1 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/cinemas/8/content').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8, chainId: 1 } })
    );
  });

  it('an owner may read any chain', async () => {
    const token = authenticateAs(buildOwner());
    models.Cinema.findOne.mockResolvedValue({ id: 8 });
    models.CinemaContent.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/cinemas/8/content').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 } })
    );
  });

  it('returns an empty shape - not a 404 - when no content row exists yet', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 8 });
    models.CinemaContent.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/cinemas/8/content').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      cinemaId: 8,
      contactNo: null,
      mailId: null,
      tncPoints: [],
      iconUrl: null,
    });
  });

  it('parses tncPoints out of the stored JSON string', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 8 });
    models.CinemaContent.findOne.mockResolvedValue(buildContentRow());

    const response = await request(app).get('/api/cinemas/8/content').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data.tncPoints).toEqual([
      'All food items are prepared in a hygienic environment.',
    ]);
    expect(response.body.data.contactNo).toBe('9999999999');
    expect(response.body.data.mailId).toBe('contactus@1cinema.co');
  });
});

describe('PUT /api/cinemas/:id/content', () => {
  it('denies a user without the Settings edit permission', async () => {
    const token = authenticateAs(buildActor({ permissions: SETTINGS_READ }));

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({ contactNo: '9999999999' });

    expect(response.status).toBe(403);
    expect(models.CinemaContent.create).not.toHaveBeenCalled();
  });

  it('404s when the cinema is out of scope', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({ tncPoints: ['A point'] });

    expect(response.status).toBe(404);
    expect(models.CinemaContent.create).not.toHaveBeenCalled();
  });

  it('creates the row on first save, JSON-encoding tncPoints', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 8 });
    models.CinemaContent.findOne.mockResolvedValue(null);
    models.CinemaContent.create.mockImplementation((attrs) =>
      Promise.resolve(buildContentRow(attrs))
    );

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({
        contactNo: '9999999999',
        mailId: 'contactus@1cinema.co',
        tncPoints: ['Point one', 'Point two'],
      });

    expect(response.status).toBe(200);
    expect(models.CinemaContent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cinemaId: 8,
        contactNo: '9999999999',
        mailId: 'contactus@1cinema.co',
        tncPoints: JSON.stringify(['Point one', 'Point two']),
        createdBy: 7,
        updatedBy: 7,
      })
    );
    expect(response.body.data.tncPoints).toEqual(['Point one', 'Point two']);
  });

  it('updates the existing row on a later save instead of creating a second one', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 8 });
    const existing = buildContentRow();
    models.CinemaContent.findOne.mockResolvedValue(existing);

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({ contactNo: '8888888888', mailId: null, tncPoints: [] });

    expect(response.status).toBe(200);
    expect(models.CinemaContent.create).not.toHaveBeenCalled();
    expect(existing.update).toHaveBeenCalledWith(
      expect.objectContaining({ contactNo: '8888888888', mailId: null, tncPoints: '[]' })
    );
  });

  it('drops blank points from the list rather than rejecting the request', async () => {
    const token = authenticateAs(buildActor());
    models.Cinema.findOne.mockResolvedValue({ id: 8 });
    const existing = buildContentRow();
    models.CinemaContent.findOne.mockResolvedValue(existing);

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({ tncPoints: ['Real point', '   ', ''] });

    expect(response.status).toBe(200);
    expect(existing.update).toHaveBeenCalledWith(
      expect.objectContaining({ tncPoints: JSON.stringify(['Real point']) })
    );
  });

  it('rejects a tncPoints entry over the 500-character cap', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({ tncPoints: ['x'.repeat(501)] });

    expect(response.status).toBe(400);
    expect(models.Cinema.findOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid mailId', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/cinemas/8/content')
      .set('Authorization', token)
      .send({ mailId: 'not-an-email' });

    expect(response.status).toBe(400);
  });
});
