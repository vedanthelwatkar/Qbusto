'use strict';

const authorize = require('../src/middleware/authorize');
const { AuthenticationError, AuthorizationError } = require('../src/utils/errors');
const { MODULES, ACTIONS, ROLES } = require('../src/constants');

/** Runs a middleware and resolves with the error it passed to next(), or null. */
function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err || null));
  });
}

const permission = (moduleName, grants) => ({
  moduleName,
  canRead: false,
  canEdit: false,
  canDelete: false,
  ...grants,
});

describe('middleware/authorize', () => {
  describe('construction', () => {
    it('throws at build time for an unknown module', () => {
      expect(() => authorize('Product', ACTIONS.READ)).toThrow(/unknown module "Product"/);
    });

    it('throws at build time for an unknown action', () => {
      expect(() => authorize(MODULES.PRODUCTS, 'write')).toThrow(/unknown action "write"/);
    });

    it('accepts every valid module and action combination', () => {
      for (const moduleName of Object.values(MODULES)) {
        for (const action of Object.values(ACTIONS)) {
          expect(() => authorize(moduleName, action)).not.toThrow();
        }
      }
    });
  });

  describe('enforcement', () => {
    it('rejects when authenticate() has not run', async () => {
      const err = await run(authorize(MODULES.PRODUCTS, ACTIONS.READ), {});

      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(401);
    });

    it('lets an owner through without any permission rows', async () => {
      const req = { user: { role: ROLES.OWNER, permissions: [] } };
      const err = await run(authorize(MODULES.SETTINGS, ACTIONS.DELETE), req);

      expect(err).toBeNull();
    });

    it('allows a granted action', async () => {
      const req = {
        user: {
          role: ROLES.CINEMA_ADMIN,
          permissions: [permission(MODULES.PRODUCTS, { canRead: true })],
        },
      };

      expect(await run(authorize(MODULES.PRODUCTS, ACTIONS.READ), req)).toBeNull();
    });

    it('denies an action that is not granted on a module the user can read', async () => {
      const req = {
        user: {
          role: ROLES.CINEMA_ADMIN,
          permissions: [permission(MODULES.PRODUCTS, { canRead: true })],
        },
      };

      const err = await run(authorize(MODULES.PRODUCTS, ACTIONS.DELETE), req);

      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.statusCode).toBe(403);
      expect(err.details).toEqual({ module: MODULES.PRODUCTS, action: ACTIONS.DELETE });
    });

    it('denies a module the user has no row for', async () => {
      const req = {
        user: {
          role: ROLES.KITCHEN_STAFF,
          permissions: [permission(MODULES.ORDERS, { canRead: true, canEdit: true })],
        },
      };

      const err = await run(authorize(MODULES.REPORTS, ACTIONS.READ), req);

      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.statusCode).toBe(403);
    });

    it('does not let a grant on one module leak to another', async () => {
      const req = {
        user: {
          role: ROLES.CINEMA_ACCOUNTANT,
          permissions: [permission(MODULES.REPORTS, { canRead: true, canEdit: true })],
        },
      };

      expect(await run(authorize(MODULES.REPORTS, ACTIONS.EDIT), req)).toBeNull();
      expect(await run(authorize(MODULES.PRICING, ACTIONS.EDIT), req)).toBeInstanceOf(
        AuthorizationError
      );
    });

    it('treats a missing permissions collection as no permissions', async () => {
      const req = { user: { role: ROLES.CHAIN_ADMIN } };

      const err = await run(authorize(MODULES.USERS, ACTIONS.READ), req);
      expect(err).toBeInstanceOf(AuthorizationError);
    });

    it('requires the flag to be strictly true, not merely truthy', async () => {
      const req = {
        user: {
          role: ROLES.CINEMA_ADMIN,
          permissions: [{ moduleName: MODULES.BANNERS, canRead: 1, canEdit: 0, canDelete: 0 }],
        },
      };

      const err = await run(authorize(MODULES.BANNERS, ACTIONS.READ), req);
      expect(err).toBeInstanceOf(AuthorizationError);
    });
  });
});
