'use strict';

/**
 * Liveness, readiness and version endpoints.
 *
 * The split matters for orchestration:
 *   /health  - is the process alive? Reports database connectivity for
 *              visibility, but stays 200 during a database outage so the
 *              container is not killed and restarted for something a restart
 *              cannot fix.
 *   /ready   - should this instance receive traffic? Checks the database,
 *              migrations and seed data; returns 503 when not ready.
 *   /version - build and runtime identification.
 */

const healthService = require('../services/health.service');
const env = require('../config/env');
const { success, error } = require('../utils/response');
const { ERROR_CODES } = require('../constants');

const pkg = require('../../package.json');

async function health(req, res) {
  const database = await healthService.checkDatabase();

  // Reports database state but never fails on it. A 503 here would tell the
  // orchestrator to restart the process, which cannot fix a database outage -
  // that decision belongs to /ready.
  return success(res, {
    message: 'Service is alive',
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      database: database.ok
        ? { connected: true, latencyMs: database.latencyMs }
        : { connected: false, error: database.error },
    },
  });
}

async function ready(req, res) {
  const { ready: isReady, checks } = await healthService.getReadiness();

  if (!isReady) {
    return error(res, {
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Service is not ready to accept traffic',
      details: checks,
    });
  }

  return success(res, {
    message: 'Service is ready',
    data: { status: 'ready', checks },
  });
}

async function version(req, res) {
  const sqlServer = await healthService.getServerVersion();

  return success(res, {
    message: 'Version information',
    data: {
      name: pkg.name,
      version: pkg.version,
      environment: env.nodeEnv,
      node: process.version,
      sqlServer: sqlServer.ok
        ? { version: sqlServer.version, level: sqlServer.level, edition: sqlServer.edition }
        : { error: sqlServer.error },
    },
  });
}

module.exports = { health, ready, version };
