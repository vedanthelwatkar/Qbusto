'use strict';

/**
 * Health and readiness checks.
 *
 * This is the runtime counterpart to scripts/healthcheck.js, which performs the
 * same checks from the command line for deployment verification. The script is
 * frozen and cannot import from src/, so the check logic exists in both places;
 * if a check changes here, mirror it there. (See the recommendation in
 * docs/backend-verification.md about consolidating the two.)
 */

const fs = require('fs');
const path = require('path');

const { sequelize } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const MIGRATION_META_TABLE = 'SequelizeMeta';

/** Seed data application logic depends on. Codes must match docs/schema.md. */
const REQUIRED_SEEDS = {
  order_statuses: ['initiated', 'confirmed', 'preparing', 'ready', 'delivered', 'rejected'],
  payment_statuses: ['pending', 'paid', 'failed', 'refunded'],
};

/**
 * How long a connectivity check may take before it is reported as failed.
 *
 * config/config.js sets no connectTimeout, so the mssql driver falls back to
 * its own (15s). That is far too long for /health, which must answer promptly
 * or the orchestrator's liveness probe times out and kills a process whose only
 * problem is a slow database.
 */
const DB_CHECK_TIMEOUT_MS = 2000;

/**
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, latencyMs?: number, error?: string}>}
 */
async function checkDatabase({ timeoutMs = DB_CHECK_TIMEOUT_MS } = {}) {
  const startedAt = process.hrtime.bigint();
  let timer;

  try {
    const authenticated = sequelize.authenticate();

    // Whichever promise loses the race still settles. Without this the loser's
    // rejection surfaces as an unhandled rejection.
    authenticated.catch(() => {});

    await Promise.race([
      authenticated,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Database check timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);

    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return { ok: true, latencyMs: Number(latencyMs.toFixed(1)) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compares migration files on disk against the SequelizeMeta table. Reports
 * both directions: pending migrations, and migrations recorded in the database
 * but absent from this build (deployed code older than the database).
 */
async function checkMigrations() {
  try {
    const onDisk = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.js'))
      .sort();

    const [rows] = await sequelize.query(`SELECT [name] FROM [${MIGRATION_META_TABLE}]`);
    const applied = rows.map((row) => row.name);
    const appliedSet = new Set(applied);
    const onDiskSet = new Set(onDisk);

    const pending = onDisk.filter((file) => !appliedSet.has(file));
    const orphaned = applied.filter((name) => !onDiskSet.has(name));

    return {
      ok: pending.length === 0 && orphaned.length === 0,
      applied: applied.length,
      pending,
      orphaned,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** @returns {Promise<{ok: boolean, missing?: object, error?: string}>} */
async function checkSeedData() {
  const missing = {};

  try {
    for (const [table, requiredCodes] of Object.entries(REQUIRED_SEEDS)) {
      const [rows] = await sequelize.query(`SELECT [code] FROM [${table}]`);
      const present = new Set(rows.map((row) => row.code));
      const absent = requiredCodes.filter((code) => !present.has(code));
      if (absent.length > 0) missing[table] = absent;
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return { ok: Object.keys(missing).length === 0, missing };
}

/** @returns {Promise<{ok: boolean, version?: string, edition?: string, error?: string}>} */
async function getServerVersion() {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version,
        CAST(SERVERPROPERTY('ProductLevel')   AS nvarchar(128)) AS level,
        CAST(SERVERPROPERTY('Edition')        AS nvarchar(128)) AS edition
    `);
    return { ok: true, ...rows[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Full readiness report: is this instance fit to serve traffic?
 *
 * @returns {Promise<{ready: boolean, checks: object}>}
 */
async function getReadiness() {
  const database = await checkDatabase();

  // The remaining checks all need a working connection.
  if (!database.ok) {
    return {
      ready: false,
      checks: {
        database,
        migrations: { ok: false, error: 'Skipped - no database connection' },
        seedData: { ok: false, error: 'Skipped - no database connection' },
      },
    };
  }

  const [migrations, seedData] = await Promise.all([checkMigrations(), checkSeedData()]);

  return {
    ready: database.ok && migrations.ok && seedData.ok,
    checks: { database, migrations, seedData },
  };
}

module.exports = {
  checkDatabase,
  checkMigrations,
  checkSeedData,
  getServerVersion,
  getReadiness,
  REQUIRED_SEEDS,
};
