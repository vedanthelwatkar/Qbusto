'use strict';

/**
 * End-to-end tests for /api/auth, driven through the real Express app so the
 * validator, middleware, controller and error handler are all exercised.
 *
 * The model layer is mocked: these assert behaviour, not SQL.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findOne: jest.fn(), findByPk: jest.fn() },
    UserPermission: { destroy: jest.fn(), bulkCreate: jest.fn() },
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

function buildUser(overrides = {}) {
  return {
    id: 7,
    chainId: 1,
    cinemaId: null,
    role: 'cinema_admin',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Ng',
    mobile: null,
    isActive: true,
    passwordHash: '$2b$10$notarealhashnotarealhashnotarealhashnotarealhashnotare',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    permissions: [{ moduleName: 'Orders', canRead: true, canEdit: false, canDelete: false }],
    verifyPassword: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function tokenFor(user) {
  return `Bearer ${generateAccessToken({ sub: user.id, role: user.role })}`;
}

describe('POST /api/auth/login', () => {
  it('returns a token, the profile and permissions', async () => {
    const user = buildUser();
    models.User.findOne.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'correct-horse' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.data.token).toBe('string');
    expect(response.body.data.user.username).toBe('alice');
    expect(response.body.data.user.role).toBe('cinema_admin');
    expect(response.body.data.user.permissions).toEqual([
      { moduleName: 'Orders', canRead: true, canEdit: false, canDelete: false },
    ]);
  });

  it('never exposes the password hash', async () => {
    models.User.findOne.mockResolvedValue(buildUser());

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'correct-horse' });

    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|\$2b\$/);
  });

  it('signs a token carrying only the user id and role', async () => {
    const user = buildUser();
    models.User.findOne.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'correct-horse' });

    const [, encodedPayload] = response.body.data.token.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64').toString());

    expect(payload.sub).toBe(String(user.id));
    expect(payload.role).toBe(user.role);
    // Only the identity claims plus the registered iat/exp/iss.
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'role', 'sub']);
  });

  it('rejects a wrong password with 401', async () => {
    models.User.findOne.mockResolvedValue(buildUser({ verifyPassword: jest.fn(() => false) }));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHENTICATION_ERROR);
  });

  it('gives an unknown username the same 401 as a wrong password', async () => {
    models.User.findOne.mockResolvedValue(null);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrong' });

    models.User.findOne.mockResolvedValue(buildUser({ verifyPassword: jest.fn(() => false) }));
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrong' });

    expect(unknown.status).toBe(401);
    // Identical messages: a difference here would let an attacker enumerate
    // valid usernames.
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects a deactivated account with 403 ACCOUNT_INACTIVE', async () => {
    models.User.findOne.mockResolvedValue(buildUser({ isActive: false }));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'correct-horse' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.ACCOUNT_INACTIVE);
  });

  it('rejects a missing password with 400 before touching the database', async () => {
    const response = await request(app).post('/api/auth/login').send({ username: 'alice' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(models.User.findOne).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/me', () => {
  it('returns the profile, role and permissions', async () => {
    const user = buildUser();
    models.User.findByPk.mockResolvedValue(user);

    const response = await request(app).get('/api/auth/me').set('Authorization', tokenFor(user));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: 7,
      username: 'alice',
      role: 'cinema_admin',
      isActive: true,
    });
    expect(response.body.data.permissions).toHaveLength(1);
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(models.User.findByPk).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  it('succeeds for an authenticated user', async () => {
    const user = buildUser();
    models.User.findByPk.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', tokenFor(user));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('requires a token', async () => {
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('hashes the new password through the model and persists it', async () => {
    const user = buildUser();
    models.User.findByPk.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', tokenFor(user))
      .send({ current_password: 'old-password', new_password: 'new-password-1' });

    expect(response.status).toBe(200);
    expect(user.verifyPassword).toHaveBeenCalledWith('old-password');
    // Set on the virtual field so the model's hook does the hashing.
    expect(user.password).toBe('new-password-1');
    // passwordHash must be named explicitly or the UPDATE would write nothing.
    expect(user.save).toHaveBeenCalledWith({ fields: ['password', 'passwordHash'] });
  });

  it('rejects a wrong current password with 401 and does not save', async () => {
    const user = buildUser({ verifyPassword: jest.fn(() => false) });
    models.User.findByPk.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', tokenFor(user))
      .send({ current_password: 'guess', new_password: 'new-password-1' });

    expect(response.status).toBe(401);
    expect(user.save).not.toHaveBeenCalled();
  });

  it('rejects reusing the current password', async () => {
    const user = buildUser();
    models.User.findByPk.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', tokenFor(user))
      .send({ current_password: 'same-password', new_password: 'same-password' });

    expect(response.status).toBe(400);
    expect(user.save).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const user = buildUser();
    models.User.findByPk.mockResolvedValue(user);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', tokenFor(user))
      .send({ current_password: 'old-password', new_password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('requires a token', async () => {
    const response = await request(app)
      .post('/api/auth/change-password')
      .send({ current_password: 'a-password', new_password: 'new-password-1' });

    expect(response.status).toBe(401);
  });
});
