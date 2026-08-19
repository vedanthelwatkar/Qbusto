#!/usr/bin/env node
/**
 * healthcheck
 *
 * Deployment-readiness verification. Run after deploying, or before pointing
 * traffic at an environment.
 *
 * Checks, in order:
 *   1. Required environment variables
 *   2. Database connectivity
 *   3. No pending migrations (migrations/ vs the SequelizeMeta table)
 *   4. Required seed data (order_statuses, payment_statuses)
 *   5. SQL Server version
 *
 * Checks 2, 3, 4 and 5 are the same functions the running server exposes at
 * GET /ready - see src/services/health.service.js. This script only decides how
 * to print them and what exit code to use.
 *
 * Environment variables are checked first and directly against process.env, so
 * that a missing variable is reported as a failed check rather than crashing
 * the script when src/config/env.js validates the environment on import.
 *
 * Exits 0 when all critical checks pass, 1 otherwise.
 */

require('dotenv').config();

const OK = '✓';
const FAIL = '✗';
const SKIP = '-';

const REQUIRED_ENV = {
  APP: ['PORT'],
  DATABASE: ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'],
  JWT: ['JWT_SECRET'],
};

const RAZORPAY_ENV = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];

const results = [];

function record(passed, label, details = []) {
  results.push({ passed, label, details });
}

/**
 * Razorpay is treated as enabled when RAZORPAY_ENABLED says so explicitly, or -
 * when that flag is absent - when any RAZORPAY_* variable has been configured.
 * That way a deployment that half-configures Razorpay is caught rather than
 * silently skipped.
 */
function razorpayEnabled() {
  if (process.env.RAZORPAY_ENABLED !== undefined) {
    return process.env.RAZORPAY_ENABLED === 'true';
  }
  return RAZORPAY_ENV.some((name) => (process.env[name] || '').trim() !== '');
}

// ---- Environment variables (no imports, so nothing can crash first) --------

function checkEnvironment() {
  const groups = { ...REQUIRED_ENV };
  if (razorpayEnabled()) {
    groups.RAZORPAY = RAZORPAY_ENV;
  }

  const details = [];
  let passed = true;

  for (const [group, names] of Object.entries(groups)) {
    const missing = names.filter((name) => (process.env[name] || '').trim() === '');
    if (missing.length > 0) {
      passed = false;
      details.push(`${group}: missing ${missing.join(', ')}`);
    }
  }

  if (passed && !razorpayEnabled()) {
    details.push('Razorpay not enabled - RAZORPAY_* not required');
  }

  record(passed, 'Environment variables valid', details);
  return passed;
}

// ---- Runner ----------------------------------------------------------------

async function main() {
  const envOk = checkEnvironment();

  if (!envOk) {
    // Importing the service validates the environment and would throw. Report
    // what we know and stop rather than crash with a stack trace.
    record(false, 'Database connected', ['Skipped - environment is incomplete']);
    record(false, 'Migrations up to date', ['Skipped - environment is incomplete']);
    record(false, 'Seed data present', ['Skipped - environment is incomplete']);
    return report(null);
  }

  const healthService = require('../src/services/health.service');
  const { sequelize } = require('../models');

  // Keep the report readable - config/config.js leaves Sequelize's default
  // query logging on, which is useful in the app but noise here.
  sequelize.options.logging = false;

  const { checks } = await healthService.getReadiness();
  const { database, migrations, seedData } = checks;

  // 1. Database connectivity
  if (database.ok) {
    record(true, `Database connected (${database.latencyMs}ms)`);
  } else {
    record(false, 'Database connected', [
      `Cannot reach ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
      database.error,
    ]);
  }

  // 2. Pending migrations
  if (migrations.ok) {
    record(true, `Migrations up to date (${migrations.applied} applied)`);
  } else if (migrations.error) {
    record(false, 'Migrations up to date', [
      'Could not compare migrations - has "make migrate" ever run?',
      migrations.error,
    ]);
  } else {
    const details = [];
    if (migrations.pending.length > 0) {
      details.push(`${migrations.pending.length} pending migration(s) - run "make migrate":`);
      migrations.pending.forEach((file) => details.push(`    ${file}`));
    }
    // A migration recorded in the DB but missing from disk means the deployed
    // code is older than the database, which is just as broken as a pending one.
    if (migrations.orphaned.length > 0) {
      details.push(`${migrations.orphaned.length} migration(s) applied but missing from disk:`);
      migrations.orphaned.forEach((name) => details.push(`    ${name}`));
    }
    record(false, 'Migrations up to date', details);
  }

  // 3. Seed data
  if (seedData.ok) {
    record(true, 'Seed data present');
  } else if (seedData.error) {
    record(false, 'Seed data present', [seedData.error]);
  } else {
    record(
      false,
      'Seed data present',
      Object.entries(seedData.missing).map(
        ([table, codes]) => `${table}: missing ${codes.join(', ')} - run "make seed"`
      )
    );
  }

  // 5. SQL Server version - informational, never blocks a deployment.
  if (database.ok) {
    const server = await healthService.getServerVersion();
    record(
      true,
      server.ok
        ? `SQL Server version: ${server.version} (${server.level}, ${server.edition})`
        : 'SQL Server version: unavailable',
      server.ok ? [] : [server.error]
    );
  } else {
    results.push({ passed: null, label: 'SQL Server version: unknown', details: [] });
  }

  return report(sequelize);
}

async function report(sequelize) {
  console.log('');
  for (const { passed, label, details } of results) {
    const mark = passed === null ? SKIP : passed ? OK : FAIL;
    console.log(`${mark} ${label}`);
    for (const line of details) {
      console.log(`    ${line}`);
    }
  }
  console.log('');

  if (sequelize) {
    try {
      await sequelize.close();
    } catch {
      // Closing a connection that never opened is not itself a failure.
    }
  }

  const failures = results.filter((result) => result.passed === false);

  if (failures.length > 0) {
    console.error(`Healthcheck FAILED - ${failures.length} check(s) did not pass.`);
    process.exit(1);
  }

  console.log('Healthcheck passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`${FAIL} healthcheck failed unexpectedly`);
  console.error(`  ${err.message}`);
  process.exit(1);
});
