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
