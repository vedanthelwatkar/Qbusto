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
    { name: 'Categories', description: 'Chain-scoped product categories' },
    { name: 'Products', description: 'Chain-scoped products and add-ons' },
    {
      name: 'Product Availability Hours',
      description: 'When a product is orderable at a cinema',
    },
    { name: 'Product Pricing', description: 'Per-cinema, per-day product prices and discounts' },
    { name: 'Banners', description: 'Promotional images shown for a cinema' },
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
          // Present on list endpoints only - paginated() in src/utils/response.js
          // merges it into meta, and success() does not.
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      Pagination: {
        type: 'object',
        description: 'Present in `meta` on paginated list responses.',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          // Total matching rows, ignoring pagination.
          total: { type: 'integer', example: 137 },
          totalPages: { type: 'integer', example: 7 },
          hasNextPage: { type: 'boolean', example: true },
          hasPreviousPage: { type: 'boolean', example: false },
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
      Category: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 4 },
          chainId: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Beverages' },
          description: { type: 'string', nullable: true, example: 'Hot and cold drinks' },
          imageUrl: { type: 'string', nullable: true },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 17 },
          chainId: {
            type: 'integer',
            example: 1,
            description: "Copied from the product's category; never accepted from a request.",
          },
          categoryId: { type: 'integer', example: 4 },
          name: { type: 'string', example: 'Salted Popcorn' },
          description: { type: 'string', nullable: true },
          weight: { type: 'string', nullable: true, example: '150g' },
          imageUrl: { type: 'string', nullable: true },
          taxSlabCode: { type: 'string', nullable: true, example: 'GST5' },
          isAddon: { type: 'boolean', example: false },
          addonParentId: { type: 'integer', nullable: true, example: null },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProductAvailabilityHour: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 31 },
          cinemaProductId: {
            type: 'integer',
            example: 12,
            description: 'The cinema/product link this window applies to.',
          },
          dayOfWeek: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            example: 0,
            description: '0 = every day, 1 = Monday ... 7 = Sunday.',
          },
          startTime: { type: 'string', example: '09:00:00' },
          endTime: { type: 'string', example: '17:30:00' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProductPricing: {
        type: 'object',
        description:
          'Decimal columns are returned as strings to preserve exact scale. ' +
          'Discount amounts are only meaningful when discountType is set.',
        properties: {
          id: { type: 'integer', example: 22 },
          cinemaId: { type: 'integer', example: 3 },
          productId: { type: 'integer', example: 17 },
          dayOfWeek: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            example: 0,
            description: '0 = every day, 1 = Monday ... 7 = Sunday.',
          },
          basePrice: { type: 'string', example: '250.00' },
          discountType: {
            type: 'string',
            enum: ['P', 'F'],
            nullable: true,
            example: 'P',
            description: 'P = percentage, F = flat amount.',
          },
          discountValue: { type: 'string', nullable: true, example: '10.00' },
          discountOnQr: { type: 'string', nullable: true },
          discountOnKiosk: { type: 'string', nullable: true },
          discountOnSeatQr: { type: 'string', nullable: true },
          discountOnCounter: { type: 'string', nullable: true },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Banner: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 9 },
          cinemaId: { type: 'integer', example: 3 },
          imageUrl: { type: 'string', example: 'https://cdn.qbusto.com/banners/9.png' },
          type: {
            type: 'string',
            enum: ['H', 'I'],
            example: 'H',
            description: 'H = header, I = inner.',
          },
          sequence: {
            type: 'integer',
            example: 1,
            description: 'Display order. Unique within a cinema.',
          },
          startDate: { type: 'string', format: 'date-time', nullable: true },
          endDate: { type: 'string', format: 'date-time', nullable: true },
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
