'use strict';

/**
 * The model layer is mocked so these tests exercise the middleware's decision
 * logic without opening a database connection.
 */

jest.mock('../src/config/database', () => ({
  models: { User: { findByPk: jest.fn() } },
}));

const { models } = require('../src/config/database');
const authenticate = require('../src/middleware/authenticate');
const { generateAccessToken } = require('../src/utils/jwt');
const { AuthenticationError, AuthorizationError } = require('../src/utils/errors');
const { ERROR_CODES } = require('../src/constants');

const middleware = authenticate();

function buildRequest(authorization) {
  return {
    headers: authorization ? { authorization } : {},
  };
}

/** Runs the middleware and resolves with { err, req } - err is null on success. */
function run(req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve({ err: err || null, req }));
  });
}

const activeUser = { id: 5, isActive: true, role: 'cinema_admin', permissions: [] };

describe('middleware/authenticate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects a request with no Authorization header', async () => {
    const { err } = await run(buildRequest());

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(models.User.findByPk).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer Authorization header', async () => {
    const { err } = await run(buildRequest('Basic dXNlcjpwYXNz'));

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const { err } = await run(buildRequest('Bearer garbage'));

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(models.User.findByPk).not.toHaveBeenCalled();
  });

  it('rejects an expired token with the TOKEN_EXPIRED code', async () => {
    const expired = generateAccessToken({ sub: activeUser.id }, { expiresIn: '-1s' });
    const { err } = await run(buildRequest(`Bearer ${expired}`));

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe(ERROR_CODES.TOKEN_EXPIRED);
  });

  it('rejects a token whose subject no longer exists', async () => {
    models.User.findByPk.mockResolvedValue(null);

    const token = generateAccessToken({ sub: 999 });
    const { err } = await run(buildRequest(`Bearer ${token}`));

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(models.User.findByPk).toHaveBeenCalledWith(999, expect.any(Object));
  });

  it('rejects a deactivated user with 403 ACCOUNT_INACTIVE', async () => {
    models.User.findByPk.mockResolvedValue({ ...activeUser, isActive: false });

    const token = generateAccessToken({ sub: activeUser.id });
    const { err } = await run(buildRequest(`Bearer ${token}`));

    expect(err).toBeInstanceOf(AuthorizationError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe(ERROR_CODES.ACCOUNT_INACTIVE);
  });

  it('attaches the user and token payload on success', async () => {
    models.User.findByPk.mockResolvedValue(activeUser);

    const token = generateAccessToken({ sub: activeUser.id, role: activeUser.role });
    const { err, req } = await run(buildRequest(`Bearer ${token}`));

    expect(err).toBeNull();
    expect(req.user).toBe(activeUser);
    expect(req.auth.sub).toBe(String(activeUser.id));
  });

  it('never selects the password hash and always includes permissions', async () => {
    models.User.findByPk.mockResolvedValue(activeUser);

    const token = generateAccessToken({ sub: activeUser.id });
    await run(buildRequest(`Bearer ${token}`));

    const [, options] = models.User.findByPk.mock.calls[0];
    expect(options.attributes.exclude).toContain('passwordHash');
    expect(options.include[0].association).toBe('permissions');
  });

  it('forwards an unexpected database failure to the error handler', async () => {
    models.User.findByPk.mockRejectedValue(new Error('connection lost'));

    const token = generateAccessToken({ sub: activeUser.id });
    const { err } = await run(buildRequest(`Bearer ${token}`));

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('connection lost');
  });
});
