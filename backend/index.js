'use strict';

/**
 * Server entry point.
 *
 * Verifies the database is reachable before binding a port, then starts
 * listening. Shuts down gracefully on SIGTERM/SIGINT so in-flight requests are
 * allowed to finish during a rolling deploy.
 *
 * The Express app itself is built in src/app.js.
 */

const createApp = require('./src/app');
const env = require('./src/config/env');
const logger = require('./src/config/logger');
const { connect, disconnect } = require('./src/config/database');

const SHUTDOWN_TIMEOUT_MS = 10000;

async function start() {
  // Fail fast: a process that cannot reach its database should not accept
  // traffic, and the error is far clearer here than on the first request.
  await connect();

  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info(`QBusto backend listening on http://localhost:${env.port}`, {
      environment: env.nodeEnv,
      docs: env.swagger.enabled ? `http://localhost:${env.port}/api/docs` : 'disabled',
    });
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);

    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async (err) => {
      if (err) {
        logger.error('Error while closing HTTP server', { error: err.message });
        process.exit(1);
      }

      try {
        await disconnect();
      } catch (dbErr) {
        logger.error('Error while closing database connection', { error: dbErr.message });
      }

      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A rejection that reaches here means a bug escaped the error handler. Log it
  // loudly rather than letting Node terminate the process silently.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.stack : String(reason),
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception - shutting down', { error: err.stack });
    shutdown('uncaughtException');
  });

  return server;
}

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
