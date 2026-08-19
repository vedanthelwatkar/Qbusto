'use strict';

/**
 * Express application factory.
 *
 * Exported as a function returning a configured app (rather than a module-level
 * singleton) so tests can build an instance with supertest without binding a
 * port. Server startup lives in index.js.
 *
 * Middleware order is deliberate:
 *   1. trust proxy      - so req.ip is the client, not the load balancer
 *   2. request logger   - assigns req.id; every later log line can be correlated
 *   3. helmet           - security headers before anything can respond
 *   4. cors             - reject disallowed origins early
 *   5. compression      - wraps all downstream responses
 *   6. webhooks         - raw body, before the JSON parser (see below)
 *   7. body parsers     - with a size cap
 *   8. docs, routes
 *   9. 404, then the error handler (must be last)
 */

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const corsOptions = require('./config/cors');
const { buildSpec } = require('./config/swagger');
const logger = require('./config/logger');
const requestLogger = require('./middleware/requestLogger');
const apiLimiter = require('./middleware/rateLimiter');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health.routes');
const apiRoutes = require('./routes/api.routes');
const webhookRoutes = require('./routes/webhook.routes');

const BODY_LIMIT = '1mb';

function createApp() {
  const app = express();

  // Behind a reverse proxy in every deployed environment; without this, req.ip
  // is the proxy address and rate limiting would bucket all clients together.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestLogger());

  app.use(
    helmet({
      // The Swagger UI bundle needs inline styles/scripts; the API itself
      // returns JSON, for which CSP is not a meaningful control.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(cors(corsOptions));
  app.use(compression());

  // Webhooks mount BEFORE the JSON parser. Razorpay signs the exact request
  // bytes, so the router needs the unparsed Buffer; once express.json() has
  // run, those bytes are gone and no signature could ever be verified. The
  // exception is scoped to this one path — every other route still gets
  // parsed JSON exactly as before.
  app.use('/api/webhooks', webhookRoutes);

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  if (env.swagger.enabled) {
    const spec = buildSpec();

    app.get('/api/docs.json', (req, res) => res.json(spec));
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(spec, {
        explorer: true,
        customSiteTitle: 'QBusto API Docs',
        swaggerOptions: { persistAuthorization: true },
      })
    );

    logger.debug('Swagger UI mounted at /api/docs');
  }

  // Probes live at the root and are skipped by the rate limiter.
  app.use('/', healthRoutes);
  app.use('/api', apiLimiter, apiRoutes);

  app.use(notFound());
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
