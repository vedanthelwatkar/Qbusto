// config/config.js
require('dotenv').config();

/**
 * IST STORAGE - THE TWO SETTINGS BELOW ARE A MATCHED PAIR
 *
 * The client requires timestamps to be stored as IST, not UTC. SQL Server's
 * `datetime2` carries no offset, so "stored as IST" means the column holds IST
 * WALL CLOCK, and every read has to interpret it the same way.
 *
 * Two independent levers produce that, and they are not interchangeable:
 *
 *   timezone: '+05:30'   drives WRITES. Sequelize's mssql dialect renders a
 *                        DATE as an offset-bearing literal itself, applying
 *                        this option - the driver below never sees the write.
 *
 *   useUTC: false        drives READS. tedious parses an offset-less column
 *                        as process-local rather than as UTC.
 *
 * Verified against this database by writing 2026-08-30T18:15:00Z (23:45 IST)
 * into a real datetime2(7) column and reading it back:
 *
 *   timezone   useUTC   stored in DB      instant preserved
 *   +00:00     true     18:15  (UTC)      yes     <- the old behaviour
 *   +00:00     false    18:15  (UTC)      NO
 *   +05:30     true     23:45  (IST)      NO
 *   +05:30     false    23:45  (IST)      yes     <- this configuration
 *
 * Setting only one of them stores the right digits while corrupting the
 * instant, or vice versa. They change together or not at all.
 *
 * A fixed offset rather than an IANA name on purpose: India has not changed
 * offset since 1945 and observes no DST, so '+05:30' is exact and does not
 * depend on ICU's zone aliasing (which already surfaced once, resolving
 * Asia/Kolkata to Asia/Calcutta).
 *
 * `useUTC: false` means "parse as PROCESS-local", so it only yields IST while
 * the process itself is on IST. That is guaranteed by APP_TIMEZONE in
 * src/config/env.js, which pins process.env.TZ and refuses to boot if the
 * runtime resolves anywhere else.
 *
 * This file is read by the Sequelize CLI as well as the application, so
 * migrations run under the same convention.
 */
const IST_OFFSET = '+05:30';

const dialectOptions = () => ({
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    useUTC: false,
  },
});

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mssql',
    timezone: IST_OFFSET,
    dialectOptions: dialectOptions(),
  },
  test: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME + '_test',
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mssql',
    timezone: IST_OFFSET,
    dialectOptions: dialectOptions(),
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mssql',
    timezone: IST_OFFSET,
    dialectOptions: dialectOptions(),
  },
};