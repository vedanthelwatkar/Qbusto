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
const uploadService = require('./services/upload.service');
const { NotFoundError } = require('./utils/errors');

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

  // Webhooks mount BEFORE the JSON parser. Cashfree signs the exact request
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

  /**
   * Uploaded images.
   *
   * Serves ONLY the configured upload root, and nothing above it: express
   * static resolves the request path against that single directory and refuses
   * anything that escapes it, so `../` sequences cannot reach the source tree
   * or the rest of the disk.
   *
   * `index: false` means a directory URL is a 404 rather than a listing, and
   * `dotfiles: 'deny'` keeps anything beginning with a dot unreachable.
   * `fallthrough: false` turns a miss into a 404 here instead of letting the
   * request continue into the API router and be answered by something else.
   *
   * Content types come from the stored extension, which the server chose from
   * the file's own magic bytes - a caller never names the file, so a mismatch
   * between name and content is not reachable. The headers below stop a
   * browser from second-guessing that type and from treating an image as a
   * document: `nosniff` disables content-type sniffing, and the sandbox CSP
   * means an HTML or SVG payload that somehow reached the directory could not
   * execute script or be framed.
   *
   * Nothing here executes: the directory holds static bytes and the process
   * never requires from it.
   */
  app.use(
    uploadService.PUBLIC_PREFIX,
    express.static(env.uploads.storagePath, {
      index: false,
      dotfiles: 'deny',
      fallthrough: false,
      redirect: false,
      // Filenames are content-addressed by random id and never reused, so a
      // cached copy can never be stale.
      immutable: true,
      maxAge: '30d',
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    })
  );

  /**
   * Turn a static-file miss into the API's own 404.
   *
   * With `fallthrough: false` express.static reports a missing file, a
   * directory URL or a path that escaped the root by calling next(err) with a
   * 404 or 403 error object. The shared handler does not recognise those, so
   * without this every such request answered 500 - wrong for the client, and
   * noisy enough to hide a real fault.
   *
   * A blocked traversal is reported as 404 rather than 403 on purpose: the
   * caller learns nothing about what does or does not exist outside the upload
   * directory. Anything that is not one of these two is a genuine server fault
   * and is passed along untouched.
   */
  app.use(uploadService.PUBLIC_PREFIX, (err, req, res, next) => {
    const status = err && (err.status || err.statusCode);

    if (status === 404 || status === 403) {
      next(new NotFoundError('Image'));
      return;
    }

    next(err);
  });

  // Probes live at the root and are skipped by the rate limiter.
  app.use('/', healthRoutes);
  app.use('/api', apiLimiter, apiRoutes);

  app.use(notFound());
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
