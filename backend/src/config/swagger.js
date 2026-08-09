'use strict';

/**
 * OpenAPI definition, shared by two consumers:
 *   - src/app.js serves it at /api/docs via swagger-ui-express
 *   - scripts/generate-openapi.js writes it to shared/openapi.json for the
 *     frontend orval clients
 *
 * Keeping one definition means the served docs and the generated client can
 * never drift apart.
 *
 * Route documentation itself lives in @openapi JSDoc blocks in src/routes.
 */

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const env = require('./env');
const pkg = require('../../package.json');

/**
 * Absolute, so the spec builds identically no matter the working directory
 * (npm scripts run from backend/, but the CLI may not). Separators are
 * normalised to forward slashes because glob does not match backslashes on
 * Windows.
 */
const apis = [path.join(__dirname, '..', 'routes', '**', '*.js').split(path.sep).join('/')];

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'Cinema Ordering API',
    version: pkg.version,
    description:
      'QBusto backend API. Operational probes (/health, /ready, /version) live ' +
      'at the root; all business endpoints live under /api.',
  },
  servers: [{ url: env.apiBaseUrl, description: env.nodeEnv }],
  tags: [
    { name: 'Health', description: 'Liveness, readiness and version probes' },
    { name: 'Meta', description: 'API metadata' },
    { name: 'Auth', description: 'Login, session and password management' },
    { name: 'Users', description: 'User accounts and module permissions' },
    { name: 'Chains', description: 'Cinema chains - the top of the tenant tree' },
    { name: 'Cinemas', description: 'Cinemas belonging to a chain' },
    { name: 'Screens', description: 'Screens belonging to a cinema' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token issued by the authentication endpoint.',
      },
    },
    schemas: {
      ResponseMeta: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'OK' },
          data: {},
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Request validation failed' },
              details: {},
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      UserPermission: {
        type: 'object',
        properties: {
          moduleName: {
            type: 'string',
            enum: [
              'Dashboard',
              'Orders',
              'Products',
              'Categories',
              'Pricing',
              'Banners',
              'Users',
              'Reports',
              'POS Integrations',
              'Settings',
            ],
            example: 'Orders',
          },
          canRead: { type: 'boolean', example: true },
          canEdit: { type: 'boolean', example: false },
          canDelete: { type: 'boolean', example: false },
        },
      },
      UserPermissionInput: {
        allOf: [
          { $ref: '#/components/schemas/UserPermission' },
          { type: 'object', required: ['moduleName'] },
        ],
        description: 'Omitted flags default to false.',
      },
      // The password hash is not part of this schema and is never returned.
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 12 },
          chainId: { type: 'integer', example: 1 },
          cinemaId: { type: 'integer', nullable: true, example: 3 },
          role: {
            type: 'string',
            enum: ['owner', 'chain_admin', 'cinema_admin', 'kitchen_staff', 'cinema_accountant'],
            example: 'cinema_admin',
          },
          username: { type: 'string', example: 'jordan.p' },
          firstName: { type: 'string', nullable: true, example: 'Jordan' },
          lastName: { type: 'string', nullable: true, example: 'Pereira' },
          mobile: { type: 'string', nullable: true, example: '9876543210' },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          permissions: {
            type: 'array',
            description: 'Present only when the user was loaded with permissions.',
            items: { $ref: '#/components/schemas/UserPermission' },
          },
        },
      },
      Chain: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Starlight Cinemas' },
          logoImageUrl: {
            type: 'string',
            nullable: true,
            example: 'https://cdn.qbusto.com/chains/1/logo.png',
          },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Cinema: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          chainId: { type: 'integer', example: 1 },
          code: {
            type: 'string',
            description: 'Short identifier used in QR ordering URLs. Unique system-wide.',
            example: 'BLR-01',
          },
          name: { type: 'string', example: 'Starlight Indiranagar' },
          location: { type: 'string', nullable: true, example: '100 Feet Road, Indiranagar' },
          city: { type: 'string', nullable: true, example: 'Bengaluru' },
          gstNumber: { type: 'string', nullable: true, example: '29ABCDE1234F1Z5' },
          fssaiNumber: { type: 'string', nullable: true, example: '12345678901234' },
          activeSince: { type: 'string', format: 'date-time', nullable: true },
          smsEnabled: { type: 'boolean', example: false },
          whatsappEnabled: { type: 'boolean', example: false },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Screen: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 8 },
          cinemaId: { type: 'integer', example: 3 },
          name: {
            type: 'string',
            description: 'Unique within its cinema.',
            example: 'Screen 1',
          },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LoginResult: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Signed JWT. Send as `Authorization: Bearer`.' },
          expiresIn: { type: 'string', example: '1d' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Request validation failed',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Unauthorized: {
        description: 'Missing, malformed or expired access token',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Forbidden: {
        description: 'Authenticated, but not permitted to perform this action',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Conflict: {
        description: 'Request conflicts with current state',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
    },
  },
  // Endpoints are protected by default; public ones opt out with `security: []`.
  security: [{ bearerAuth: [] }],
};

/** Build the full spec by scanning route files for @openapi blocks. */
function buildSpec() {
  return swaggerJsdoc({ definition, apis });
}

module.exports = { buildSpec };
