#!/usr/bin/env node
/**
 * sync-shows
 *
 * Runs one POS show-sync pass for every active integration and exits.
 * No in-process timer here - this is Phase B5's chosen shape
 * (docs/pos-integration.md section 6.2/12.4): the on-premise instance stays
 * free of background scheduling, and an external scheduler (Windows Task
 * Scheduler, cron) invokes this on a fixed interval instead. That is a
 * documented current choice, not a permanent close-out of the alternative.
 *
 * Usage:
 *   node scripts/sync-shows.js
 *
 * Exit codes:
 *   0 - every active integration synced successfully (including "0 shows").
 *   1 - at least one integration failed (provider outage, misconfiguration,
 *       or an unsupported provider with no registered adapter). Per-
 *       integration detail is in the printed summary and the structured
 *       logs showSync.service already emits - this script only decides the
 *       process exit code an external scheduler can alert on.
 */

require('dotenv').config();

async function main() {
  const { sequelize } = require('../models');
  const showSync = require('../src/services/showSync.service');
  // Side-effecting require: registers every implemented POS adapter, same
  // as src/app.js does for the running server.
  require('../src/pos/registerAdapters');

  sequelize.options.logging = false;

  const results = await showSync.syncAllIntegrations();

  console.log('');
  for (const result of results) {
    const { integrationId, provider, failed } = result;
    if (failed) {
      console.log(`✗ integration ${integrationId} (${provider}): failed${result.posCode ? ` [${result.posCode}]` : ''}`);
    } else {
      console.log(
        `✓ integration ${integrationId} (${provider}): ` +
          `${result.inserted} inserted, ${result.updated} updated, ${result.cancelled} cancelled`
      );
    }
  }
  console.log('');

  const failures = results.filter((result) => result.failed);
  console.log(
    failures.length > 0
      ? `sync-shows: ${failures.length}/${results.length} integration(s) failed.`
      : `sync-shows: ${results.length} integration(s) synced.`
  );

  await sequelize.close();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('sync-shows failed unexpectedly');
  console.error(`  ${err.message}`);
  process.exit(1);
});
