'use strict';

/**
 * End-to-end tests for /api/users.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, transaction use, soft delete - rather than
 * the SQL it emits. `sequelize.transaction` runs its callback immediately with a
 * sentinel, which lets the tests prove that the writes were passed a
 * transaction without needing a real one.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: {
      findOne: jest.fn(),
      findByPk: jest.fn(),
      findAndCountAll: jest.fn(),
      create: jest.fn(),
      destroy: jest.fn(),
    },
    UserPermission: { destroy: jest.fn(), bulkCreate: jest.fn() },
    Cinema: { findByPk: jest.fn() },
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

const { models, sequelize } = require('../src/config/database');
const createApp = require('../src/app');
const { generateAccessToken } = require('../src/utils/jwt');
const { ERROR_CODES } = require('../src/constants');

const app = createApp();

const TX = Symbol('transaction');

const ALL_USER_PERMISSIONS = [
  { moduleName: 'Users', canRead: true, canEdit: true, canDelete: true },
];

/**
 * An actor who also holds the modules the create/update fixtures hand out.
 * Needed because a non-owner may only grant permissions they hold themselves,
 * so an actor holding Users alone cannot set up an Orders or Reports grant.
 */
const ADMIN_PERMISSIONS = [
  { moduleName: 'Users', canRead: true, canEdit: true, canDelete: true },
  { moduleName: 'Orders', canRead: true, canEdit: true, canDelete: true },
  { moduleName: 'Reports', canRead: true, canEdit: true, canDelete: true },
];

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
    permissions: ALL_USER_PERMISSIONS,
    // Mirrors Sequelize: the instance reflects the change afterwards.
    update: jest.fn(function update(values) {
      Object.assign(this, values);
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** An actor authenticate() will accept, with the given Users permissions. */
function actorWith(permissions, overrides = {}) {
  return buildUser({ permissions, ...overrides });
}

function tokenFor(user) {
  return `Bearer ${generateAccessToken({ sub: user.id, role: user.role })}`;
}

/** Point authenticate() at `actor` and return its Authorization header. */
function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return tokenFor(actor);
}

beforeEach(() => {
  // clearMocks wipes call history but keeps implementations; transaction needs
  // its implementation restored because the mock factory leaves it bare.
  sequelize.transaction.mockImplementation((callback) => callback(TX));
});

describe('GET /api/users', () => {
  it('denies a user without the Users read permission', async () => {
    const token = authenticateAs(actorWith([]));

    const response = await request(app).get('/api/users').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHORIZATION_ERROR);
    expect(models.User.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user granted only edit on Users', async () => {
    const token = authenticateAs(
      actorWith([{ moduleName: 'Users', canRead: false, canEdit: true, canDelete: false }])
    );

    const response = await request(app).get('/api/users').set('Authorization', token);

    expect(response.status).toBe(403);
  });

  it('returns a page of users with pagination meta', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findAndCountAll.mockResolvedValue({ rows: [buildUser({ id: 9 })], count: 1 });

    const response = await request(app)
      .get('/api/users?page=1&limit=20')
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|\$2b\$/);
  });

  it('confines a non-owner to their own chain', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS, { chainId: 4 }));
    models.User.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/users').set('Authorization', token);

    const [options] = models.User.findAndCountAll.mock.calls[0];
    expect(options.where.chainId).toBe(4);
  });

  it('lets an owner see across chains', async () => {
    const token = authenticateAs(actorWith([], { role: 'owner', chainId: 4 }));
    models.User.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    const response = await request(app).get('/api/users').set('Authorization', token);

    expect(response.status).toBe(200);
    const [options] = models.User.findAndCountAll.mock.calls[0];
    expect(options.where).not.toHaveProperty('chainId');
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));

    const response = await request(app)
      .get('/api/users?sort=passwordHash')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.User.findAndCountAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/users/:id', () => {
  it('returns the user with permissions', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findOne.mockResolvedValue(buildUser({ id: 9, username: 'bob' }));

    const response = await request(app).get('/api/users/9').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data.username).toBe('bob');
    expect(response.body.data.permissions).toEqual(ALL_USER_PERMISSIONS);
  });

  it('returns 404 for a user outside the actor chain', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/users/999').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('rejects a non-numeric id', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));

    const response = await request(app).get('/api/users/abc').set('Authorization', token);

    expect(response.status).toBe(400);
  });
});

describe('POST /api/users', () => {
  const body = {
    role: 'kitchen_staff',
    username: 'newcomer',
    password: 'a-good-password',
    firstName: 'New',
    permissions: [{ moduleName: 'Orders', canRead: true, canEdit: true }],
  };

  it('creates the user and their permissions in one transaction', async () => {
    const token = authenticateAs(actorWith(ADMIN_PERMISSIONS));
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42, username: 'newcomer' }));

    const response = await request(app).post('/api/users').set('Authorization', token).send(body);

    expect(response.status).toBe(201);
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);

    const [attributes, createOptions] = models.User.create.mock.calls[0];
    expect(attributes.username).toBe('newcomer');
    // Plaintext is handed to the model, which hashes it in beforeValidate.
    expect(attributes.password).toBe('a-good-password');
    expect(attributes).not.toHaveProperty('passwordHash');
    expect(createOptions.transaction).toBe(TX);

    expect(models.UserPermission.bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: 42,
          moduleName: 'Orders',
          canRead: true,
          canEdit: true,
          canDelete: false,
          createdBy: 7,
          updatedBy: 7,
        }),
      ],
      { transaction: TX }
    );
  });

  it('forces a non-owner to create inside their own chain', async () => {
    const token = authenticateAs(actorWith(ADMIN_PERMISSIONS, { chainId: 4 }));
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ ...body, chainId: 99 });

    const [attributes] = models.User.create.mock.calls[0];
    expect(attributes.chainId).toBe(4);
  });

  it('denies a user without the Users edit permission', async () => {
    const token = authenticateAs(
      actorWith([{ moduleName: 'Users', canRead: true, canEdit: false, canDelete: false }])
    );

    const response = await request(app).post('/api/users').set('Authorization', token).send(body);

    expect(response.status).toBe(403);
    expect(models.User.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ ...body, role: 'superuser' });

    expect(response.status).toBe(400);
    expect(models.User.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate module in the permission set', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({
        ...body,
        permissions: [{ moduleName: 'Orders', canRead: true }, { moduleName: 'Orders' }],
      });

    expect(response.status).toBe(400);
    expect(models.User.create).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than 8 characters', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ ...body, password: 'short' });

    expect(response.status).toBe(400);
  });
});

describe('PUT /api/users/:id', () => {
  it('updates attributes and replaces permissions in one transaction', async () => {
    const token = authenticateAs(actorWith(ADMIN_PERMISSIONS));
    const target = buildUser({ id: 9, username: 'bob' });
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({
        firstName: 'Robert',
        permissions: [{ moduleName: 'Reports', canRead: true }],
      });

    expect(response.status).toBe(200);
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(target.update).toHaveBeenCalledWith({ firstName: 'Robert' }, { transaction: TX });

    // Replace, not merge: the old rows go first.
    expect(models.UserPermission.destroy).toHaveBeenCalledWith({
      where: { userId: 9 },
      transaction: TX,
    });
    expect(models.UserPermission.bulkCreate).toHaveBeenCalledWith(
      [expect.objectContaining({ userId: 9, moduleName: 'Reports', canRead: true })],
      { transaction: TX }
    );
  });

  it('leaves permissions untouched when the body omits them', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findOne.mockResolvedValue(buildUser({ id: 9 }));

    await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({ mobile: '9876543210' });

    expect(models.UserPermission.destroy).not.toHaveBeenCalled();
    expect(models.UserPermission.bulkCreate).not.toHaveBeenCalled();
  });

  it('returns 404 for a user outside the actor chain', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/users/999')
      .set('Authorization', token)
      .send({ firstName: 'Nope' });

    expect(response.status).toBe(404);
  });

  it('rejects an empty body', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));

    const response = await request(app).put('/api/users/9').set('Authorization', token).send({});

    expect(response.status).toBe(400);
  });

  it('refuses to let the actor deactivate themselves', async () => {
    const actor = actorWith(ALL_USER_PERMISSIONS);
    const token = authenticateAs(actor);

    const response = await request(app)
      .put(`/api/users/${actor.id}`)
      .set('Authorization', token)
      .send({ isActive: false });

    expect(response.status).toBe(409);
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('ignores an attempt to change the chain', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    const target = buildUser({ id: 9 });
    models.User.findOne.mockResolvedValue(target);

    await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({ firstName: 'Robert', chainId: 99 });

    // stripUnknown drops chainId before it reaches the service.
    expect(target.update).toHaveBeenCalledWith({ firstName: 'Robert' }, { transaction: TX });
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the three privilege-escalation findings.
//
// Each `escalates` case was a working exploit before the fix: it returned 2xx
// and wrote the attacker's value. They assert the write never happens, not just
// the status code - a 403 with the row already written would still be a breach.
// ---------------------------------------------------------------------------

describe('security: the owner role', () => {
  /** Full Users permissions, but not an owner. */
  const cinemaAdmin = () => actorWith(ALL_USER_PERMISSIONS, { role: 'cinema_admin' });

  it('refuses to let a non-owner create an owner', async () => {
    const token = authenticateAs(cinemaAdmin());

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ role: 'owner', username: 'backdoor', password: 'a-good-password' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHORIZATION_ERROR);
    expect(models.User.create).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('refuses to let a non-owner promote another user to owner', async () => {
    const token = authenticateAs(cinemaAdmin());
    const target = buildUser({ id: 9 });
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({ role: 'owner' });

    expect(response.status).toBe(403);
    expect(target.update).not.toHaveBeenCalled();
  });

  it('refuses to let a non-owner promote themselves to owner', async () => {
    const actor = cinemaAdmin();
    const token = authenticateAs(actor);

    const response = await request(app)
      .put(`/api/users/${actor.id}`)
      .set('Authorization', token)
      .send({ role: 'owner' });

    expect(response.status).toBe(403);
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  // Roles are identities, not ranks: any non-owner role may be assigned by
  // anyone holding the Users edit permission. These would have been 403s under
  // the rank model and are deliberately allowed now.
  it('allows a non-owner to assign any other non-owner role', async () => {
    const token = authenticateAs(cinemaAdmin());
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ role: 'chain_admin', username: 'peer', password: 'a-good-password' });

    expect(response.status).toBe(201);
    expect(models.User.create.mock.calls[0][0].role).toBe('chain_admin');
  });

  it('allows a non-owner to change their own role to another non-owner role', async () => {
    const actor = cinemaAdmin();
    const token = authenticateAs(actor);
    models.User.findOne.mockResolvedValue(actor);

    const response = await request(app)
      .put(`/api/users/${actor.id}`)
      .set('Authorization', token)
      .send({ role: 'chain_admin' });

    expect(response.status).toBe(200);
  });

  it('allows an owner to create another owner', async () => {
    const token = authenticateAs(actorWith([], { role: 'owner' }));
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42, role: 'owner' }));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ role: 'owner', username: 'coowner', password: 'a-good-password' });

    expect(response.status).toBe(201);
    expect(models.User.create.mock.calls[0][0].role).toBe('owner');
  });
});

describe('security: owner accounts are only modifiable by owners', () => {
  const cinemaAdmin = () => actorWith(ALL_USER_PERMISSIONS, { role: 'cinema_admin' });

  /** An owner in the same chain, so tenant scoping does not mask the check. */
  const ownerTarget = () => buildUser({ id: 1, role: 'owner', username: 'the-owner' });

  it('refuses to let a non-owner update an owner', async () => {
    const token = authenticateAs(cinemaAdmin());
    const target = ownerTarget();
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/1')
      .set('Authorization', token)
      .send({ username: 'pwned', mobile: '0000000000' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHORIZATION_ERROR);
    expect(target.update).not.toHaveBeenCalled();
  });

  it('refuses to let a non-owner demote an owner', async () => {
    const token = authenticateAs(cinemaAdmin());
    const target = ownerTarget();
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/1')
      .set('Authorization', token)
      .send({ role: 'cinema_admin' });

    expect(response.status).toBe(403);
    expect(target.update).not.toHaveBeenCalled();
  });

  it('refuses to let a non-owner change an owner permissions', async () => {
    const token = authenticateAs(cinemaAdmin());
    models.User.findOne.mockResolvedValue(ownerTarget());

    const response = await request(app)
      .put('/api/users/1')
      .set('Authorization', token)
      .send({ permissions: [] });

    expect(response.status).toBe(403);
    expect(models.UserPermission.destroy).not.toHaveBeenCalled();
    expect(models.UserPermission.bulkCreate).not.toHaveBeenCalled();
  });

  it('refuses to let a non-owner deactivate an owner', async () => {
    const token = authenticateAs(cinemaAdmin());
    const target = ownerTarget();
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app).delete('/api/users/1').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(target.update).not.toHaveBeenCalled();
  });

  it('allows an owner to update another owner', async () => {
    const token = authenticateAs(actorWith([], { role: 'owner', id: 2 }));
    const target = ownerTarget();
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/1')
      .set('Authorization', token)
      .send({ mobile: '9876543210' });

    expect(response.status).toBe(200);
    expect(target.update).toHaveBeenCalled();
  });

  it('allows an owner to deactivate another owner', async () => {
    const token = authenticateAs(actorWith([], { role: 'owner', id: 2 }));
    const target = ownerTarget();
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app).delete('/api/users/1').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(target.update).toHaveBeenCalledWith({ isActive: false });
  });

  it('leaves non-owner targets to the Users permission alone', async () => {
    const token = authenticateAs(cinemaAdmin());
    const target = buildUser({ id: 9, role: 'chain_admin' });
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({ mobile: '9876543210' });

    expect(response.status).toBe(200);
    expect(target.update).toHaveBeenCalled();
  });
});

describe('security: permission escalation', () => {
  /** Holds Users fully, but nothing at all on Settings or Reports. */
  const usersOnlyAdmin = () =>
    actorWith([{ moduleName: 'Users', canRead: true, canEdit: true, canDelete: true }]);

  const newUser = (permissions) => ({
    role: 'kitchen_staff',
    username: 'granted',
    password: 'a-good-password',
    permissions,
  });

  it('refuses to grant a module the actor holds no permission on', async () => {
    const token = authenticateAs(usersOnlyAdmin());

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send(newUser([{ moduleName: 'Settings', canRead: true, canEdit: true, canDelete: true }]));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ERROR_CODES.AUTHORIZATION_ERROR);
    expect(models.User.create).not.toHaveBeenCalled();
    expect(models.UserPermission.bulkCreate).not.toHaveBeenCalled();
  });

  it('refuses to grant a flag the actor lacks on a module they do hold', async () => {
    const token = authenticateAs(
      actorWith([
        { moduleName: 'Users', canRead: true, canEdit: true, canDelete: false },
        { moduleName: 'Orders', canRead: true, canEdit: false, canDelete: false },
      ])
    );

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send(newUser([{ moduleName: 'Orders', canRead: true, canEdit: true }]));

    expect(response.status).toBe(403);
    expect(response.body.error.details).toEqual([{ module: 'Orders', permission: 'canEdit' }]);
    expect(models.UserPermission.bulkCreate).not.toHaveBeenCalled();
  });

  it('reports every refused flag, not just the first', async () => {
    const token = authenticateAs(usersOnlyAdmin());

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send(newUser([{ moduleName: 'Reports', canRead: true, canEdit: true, canDelete: true }]));

    expect(response.status).toBe(403);
    expect(response.body.error.details).toHaveLength(3);
  });

  it('allows granting a permission the actor does hold', async () => {
    const token = authenticateAs(
      actorWith([
        { moduleName: 'Users', canRead: true, canEdit: true, canDelete: true },
        { moduleName: 'Orders', canRead: true, canEdit: true, canDelete: false },
      ])
    );
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send(newUser([{ moduleName: 'Orders', canRead: true, canEdit: true }]));

    expect(response.status).toBe(201);
    expect(models.UserPermission.bulkCreate).toHaveBeenCalled();
  });

  it('does not treat a false flag as an escalation attempt', async () => {
    const token = authenticateAs(usersOnlyAdmin());
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send(newUser([{ moduleName: 'Settings', canRead: false, canEdit: false }]));

    expect(response.status).toBe(201);
  });

  it('lets an owner grant anything, having no permission rows of their own', async () => {
    const token = authenticateAs(actorWith([], { role: 'owner' }));
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send(newUser([{ moduleName: 'Settings', canRead: true, canEdit: true, canDelete: true }]));

    expect(response.status).toBe(201);
  });

  it('applies the same check when replacing permissions on update', async () => {
    const token = authenticateAs(usersOnlyAdmin());
    const target = buildUser({ id: 9 });
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({ permissions: [{ moduleName: 'Settings', canDelete: true }] });

    expect(response.status).toBe(403);
    expect(models.UserPermission.destroy).not.toHaveBeenCalled();
  });
});

describe('security: cross-tenant cinema assignment', () => {
  it('rejects a cinema belonging to another chain on create', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS, { chainId: 1 }));
    models.Cinema.findByPk.mockResolvedValue({ id: 999, chainId: 2 });

    const response = await request(app).post('/api/users').set('Authorization', token).send({
      role: 'kitchen_staff',
      username: 'crosstenant',
      password: 'a-good-password',
      cinemaId: 999,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.User.create).not.toHaveBeenCalled();
  });

  it('rejects a cinema belonging to another chain on update', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS, { chainId: 1 }));
    const target = buildUser({ id: 9, chainId: 1 });
    models.User.findOne.mockResolvedValue(target);
    models.Cinema.findByPk.mockResolvedValue({ id: 999, chainId: 2 });

    const response = await request(app)
      .put('/api/users/9')
      .set('Authorization', token)
      .send({ cinemaId: 999 });

    expect(response.status).toBe(409);
    expect(target.update).not.toHaveBeenCalled();
  });

  it('accepts a cinema inside the same chain', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS, { chainId: 1 }));
    models.Cinema.findByPk.mockResolvedValue({ id: 3, chainId: 1 });
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    const response = await request(app).post('/api/users').set('Authorization', token).send({
      role: 'kitchen_staff',
      username: 'local',
      password: 'a-good-password',
      cinemaId: 3,
    });

    expect(response.status).toBe(201);
    expect(models.User.create.mock.calls[0][0].cinemaId).toBe(3);
  });

  it('checks against the target user chain, not the actor, when an owner acts', async () => {
    const token = authenticateAs(actorWith([], { role: 'owner', chainId: 1 }));
    models.Cinema.findByPk.mockResolvedValue({ id: 50, chainId: 2 });
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    // The owner places the user in chain 2, so a chain 2 cinema is correct.
    const response = await request(app).post('/api/users').set('Authorization', token).send({
      chainId: 2,
      role: 'kitchen_staff',
      username: 'otherchain',
      password: 'a-good-password',
      cinemaId: 50,
    });

    expect(response.status).toBe(201);
  });

  it('skips the lookup when no cinema is supplied', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.create.mockResolvedValue({ id: 42 });
    models.User.findOne.mockResolvedValue(buildUser({ id: 42 }));

    await request(app)
      .post('/api/users')
      .set('Authorization', token)
      .send({ role: 'kitchen_staff', username: 'nocinema', password: 'a-good-password' });

    expect(models.Cinema.findByPk).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/users/:id', () => {
  it('soft deletes by setting isActive to false', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    const target = buildUser({ id: 9 });
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app).delete('/api/users/9').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(target.update).toHaveBeenCalledWith({ isActive: false });
    expect(response.body.data.isActive).toBe(false);
  });

  it('never physically deletes the row or its permissions', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findOne.mockResolvedValue(buildUser({ id: 9 }));

    await request(app).delete('/api/users/9').set('Authorization', token);

    expect(models.User.destroy).not.toHaveBeenCalled();
    expect(models.UserPermission.destroy).not.toHaveBeenCalled();
  });

  it('is idempotent for an already inactive user', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    const target = buildUser({ id: 9, isActive: false });
    models.User.findOne.mockResolvedValue(target);

    const response = await request(app).delete('/api/users/9').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(target.update).not.toHaveBeenCalled();
  });

  it('refuses to let the actor deactivate themselves', async () => {
    const actor = actorWith(ALL_USER_PERMISSIONS);
    const token = authenticateAs(actor);

    const response = await request(app)
      .delete(`/api/users/${actor.id}`)
      .set('Authorization', token);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(models.User.findOne).not.toHaveBeenCalled();
  });

  it('denies a user without the Users delete permission', async () => {
    const token = authenticateAs(
      actorWith([{ moduleName: 'Users', canRead: true, canEdit: true, canDelete: false }])
    );

    const response = await request(app).delete('/api/users/9').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.User.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 for a user outside the actor chain', async () => {
    const token = authenticateAs(actorWith(ALL_USER_PERMISSIONS));
    models.User.findOne.mockResolvedValue(null);

    const response = await request(app).delete('/api/users/999').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});
