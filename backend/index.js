'use strict';

const app = require('./src/app');
const logger = require('./src/config/logger');
const env = require('./src/config/env');
const { sequelize, connect, disconnect } = require('./src/config/database');

const PORT = env.port;

/**
 * Startup diagnostics.
 *
 * The database check is deliberately non-fatal. If it were, a database blip
 * during a deploy would leave a process that is dead with the reason buried in
 * a crash log. Instead the port still binds, so /health and /ready stay
 * reachable and can report *why* the service is degraded.
 */
async function reportStartup() {
  logger.info('Starting QBusto backend', {
    environment: env.nodeEnv,
    node: process.version,
    pid: process.pid,
    logLevel: env.log.level,
  });

  logger.info('Configuration loaded', {
    port: PORT,
    apiBaseUrl: env.apiBaseUrl,
    swagger: env.swagger.enabled ? `${env.apiBaseUrl}/api/docs` : 'disabled',
    corsAllowedOrigins: env.cors.allowedOrigins,
    corsAllowCredentials: env.cors.allowCredentials,
    rateLimit: `${env.rateLimit.max} req / ${env.rateLimit.windowMs}ms`,
  });

  try {
    // connect() logs the target host/database and handshake latency on success.
    await connect();
    return true;
  } catch (err) {
    logger.error('Database connection FAILED - starting in a degraded state', {
      dialect: sequelize.getDialect(),
      host: sequelize.config.host,
      port: sequelize.config.port,
      database: sequelize.config.database,
      error: err.message,
    });
    return false;
  }
}

async function start() {
  const dbConnected = await reportStartup();

  const server = app().listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`, {
      url: env.apiBaseUrl,
      health: `${env.apiBaseUrl}/health`,
      ready: `${env.apiBaseUrl}/ready`,
      database: dbConnected ? 'connected' : 'DISCONNECTED',
    });
  });

  // Graceful shutdown: stop accepting connections, then release the pool.
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);

    server.close(async () => {
      logger.info('Server closed');
      try {
        await disconnect();
      } catch (err) {
        logger.error('Error closing database connection', { error: err.message });
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Fatal error during startup', { error: err.message, stack: err.stack });
  process.exit(1);
});
