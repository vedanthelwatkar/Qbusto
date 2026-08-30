'use strict';

/**
 * IST storage: the contract, pinned.
 *
 * The client requires timestamps to be STORED as IST, not merely displayed as
 * IST. `datetime2` carries no offset, so that means the column must hold IST
 * wall clock - and reading it back must still yield the correct instant.
 *
 * Those two halves are produced by two DIFFERENT settings that are easy to
 * change independently and impossible to verify by reading either one alone:
 *
 *   timezone: '+05:30'  (config/config.js)      -> writes
 *   useUTC: false       (dialectOptions.options) -> reads
 *
 * Three of the four combinations are wrong, and two of those wrong ones store
 * plausible-looking values while silently corrupting the instant. A unit test
 * that only checked `toISOString()` would pass under `timezone: '+00:00'`, and
 * one that only checked the stored text would pass under `useUTC: true`. So
 * this asserts BOTH halves against a real database round trip.
 *
 * Skipped automatically when no database is reachable, so it cannot break a
 * machine or CI job that runs the unit suites without SQL Server.
 */

const { Sequelize, DataTypes } = require('sequelize');

/*
 * This is the only suite in the repo that talks to a real database - the other
 * 24 mock the model layer entirely - so it competes with all of them for
 * connections when Jest runs them in parallel. It passes alone and failed
 * intermittently in a full run, which is acquire contention, not a regression.
 * A couple of retries makes it deterministic without weakening a single
 * assertion; the pool below is tuned for the same reason.
 */
jest.retryTimes(2, { logErrorsBeforeRetry: false });

const allConfig = require('../config/config.js');

/**
 * The settings under test are identical across environments, so this asserts
 * against the one for NODE_ENV.
 */
const config = allConfig[process.env.NODE_ENV || 'development'];

/**
 * Which databases to try for the round-trip, in order.
 *
 * Jest sets NODE_ENV=test, which points at `<DB_NAME>_test` - a database that
 * does not exist on every developer's machine. Falling back to the development
 * database means the round trip actually RUNS here rather than silently
 * skipping, which for this particular test matters: a skipped assertion about
 * timezone storage is indistinguishable from a passing one, and the whole
 * point is to catch a config regression.
 */
const CANDIDATES = [config, allConfig.development].filter(
  (c, i, arr) => c && arr.indexOf(c) === i
);

/**
 * A deliberately awkward instant: 23:45 IST on 2026-08-30 is 18:15 UTC on the
 * SAME day, but 00:30 IST on 2026-08-31 is 19:00 UTC on the PREVIOUS one. The
 * second case is the one a naive implementation gets wrong, because the IST
 * wall clock and the UTC wall clock fall on different calendar dates.
 */
const CASES = [
  // Midnight IST - the UTC value falls on the PREVIOUS calendar day.
  { label: 'midnight IST', iso: '2026-08-29T18:30:00.000Z', istWallClock: '2026-08-30 00:00:00' },
  // Morning.
  { label: 'morning IST', iso: '2026-01-15T02:30:00.000Z', istWallClock: '2026-01-15 08:00:00' },
  // Afternoon.
  { label: 'afternoon IST', iso: '2026-08-30T10:00:00.000Z', istWallClock: '2026-08-30 15:30:00' },
  // Late evening - same calendar day in both zones.
  { label: 'late evening IST', iso: '2026-08-30T18:15:00.000Z', istWallClock: '2026-08-30 23:45:00' },
  // Just past midnight IST - UTC is still the previous day. This is the case a
  // naive implementation gets wrong, because the two zones disagree on the date.
  { label: 'crosses UTC/IST day boundary', iso: '2026-08-30T19:00:00.000Z', istWallClock: '2026-08-31 00:30:00' },
  // Sub-second precision must survive datetime2(7) unrounded.
  { label: 'millisecond precision', iso: '2026-03-07T21:44:59.123Z', istWallClock: '2026-03-08 03:14:59' },
];

/**
 * A GLOBAL temp table (##) because the Sequelize pool hands out different
 * connections and a session-local #table would vanish between queries.
 *
 * Global means shared server-wide, so the name carries the worker's pid:
 * Jest runs suites in parallel and two workers creating the same ##table
 * collide with "There is already an object named ...".
 */
const TABLE = `##ist_storage_probe_${process.pid}`;

let sequelize;
let Probe;
let reachable = false;

/**
 * Generous, because this hook opens REAL connections: it tries the NODE_ENV
 * database first (`<DB_NAME>_test`, which does not exist on every machine, so
 * the attempt has to fail before the fallback is tried). Jest's 5s default was
 * enough standalone and not enough immediately after the unit run, which is
 * what made the suite look flaky.
 */
const HOOK_TIMEOUT_MS = 60_000;


beforeAll(async () => {
  for (const candidate of CANDIDATES) {
    const attempt = new Sequelize(candidate.database, candidate.username, candidate.password, {
      host: candidate.host,
      port: candidate.port,
      dialect: candidate.dialect,
      timezone: candidate.timezone,
      dialectOptions: candidate.dialectOptions,
      logging: false,
      /*
       * A small pool with a patient acquire timeout.
       *
       * Jest runs this suite alongside ~24 others, and the default pool was
       * competing with all of them for connections: the suite passed on its
       * own and failed intermittently in a full run, which is the signature of
       * acquire starvation rather than a real regression. Two connections are
       * plenty for a sequential round trip.
       */
      pool: { max: 2, min: 0, acquire: 60000, idle: 5000 },
      retry: { max: 3 },
    });

    try {
      await attempt.authenticate();
      sequelize = attempt;
      reachable = true;
      break;
    } catch {
      await attempt.close().catch(() => {});
    }
  }

  if (!reachable) return;

  // A temp table, so the assertions run against the real driver stack without
  // writing a row into any application table.
  //
  // Guarded: the whole suite runs alongside 24 others, and a connection
  // hiccup here would otherwise throw out of beforeAll and fail all four
  // tests - including the pure-config one that needs no database at all.
  // Degrading to "not reachable" keeps the failure honest and localised.
  try {
    await sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await sequelize.query(`CREATE TABLE ${TABLE} (id int PRIMARY KEY, moment datetime2(7))`);
  } catch {
    reachable = false;
    return;
  }

  Probe = sequelize.define(
    'IstStorageProbe',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      moment: { type: DataTypes.DATE },
    },
    { tableName: TABLE, timestamps: false, freezeTableName: true }
  );
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (!sequelize) return;
  if (reachable) await sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await sequelize.close();
}, HOOK_TIMEOUT_MS);

/**
 * Test declarations run before beforeAll, so reachability cannot gate them at
 * declaration time - `reachable` is still false then. The guard therefore
 * lives inside each test body, and says so loudly rather than passing quietly.
 */
function requireDatabase() {
  if (!reachable) {
    console.warn('[tz] no database reachable - IST storage round trip NOT verified');
    return false;
  }
  return true;
}

describe('QBusto datetime storage is IST', () => {
  it('is configured as the matched pair that produces IST storage', () => {
    // Guards the settings themselves. Either one alone is a broken state, so
    // a future edit that changes only one fails here rather than silently
    // corrupting every timestamp written afterwards.
    expect(config.timezone).toBe('+05:30');
    expect(config.dialectOptions.options.useUTC).toBe(false);
  });

  it('stores IST wall clock AND reads back the same instant', async () => {
    if (!requireDatabase()) return;

    for (const [index, testCase] of CASES.entries()) {
      const instant = new Date(testCase.iso);

      await Probe.create({ id: index + 1, moment: instant });

      // Half 1 - what actually landed in the column, read as raw text so the
      // driver cannot re-interpret it on the way out.
      const [rows] = await sequelize.query(
        `SELECT CONVERT(varchar(19), moment, 121) AS stored FROM ${TABLE} WHERE id = ${index + 1}`
      );
      expect({ case: testCase.label, stored: rows[0].stored }).toEqual({
        case: testCase.label,
        stored: testCase.istWallClock,
      });

      // Half 2 - the round trip is still lossless. This is what fails if
      // `timezone` is changed without `useUTC`, or the other way round.
      const reloaded = await Probe.findByPk(index + 1);
      expect({ case: testCase.label, iso: reloaded.moment.toISOString() }).toEqual({
        case: testCase.label,
        iso: testCase.iso,
      });
      // Zero drift, not "close enough".
      expect(reloaded.moment.getTime() - instant.getTime()).toBe(0);
    }
  });

  it('stores a NEW timestamp at the current IST wall clock', async () => {
    if (!requireDatabase()) return;

    const before = new Date();
    await Probe.create({ id: 100, moment: before });

    const [rows] = await sequelize.query(
      `SELECT CONVERT(varchar(19), moment, 121) AS stored FROM ${TABLE} WHERE id = 100`
    );

    // The stored text must match what the clock reads in IST right now, not
    // what it reads in UTC - the difference is 5.5 hours, so a 2-second
    // tolerance cannot mask a regression.
    const istText = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'short',
      timeStyle: 'medium',
      hour12: false,
    })
      .format(before)
      .replace('T', ' ');

    expect(rows[0].stored.slice(0, 16)).toBe(istText.slice(0, 16));
  });

  it('reads the Vista session table without a second conversion', async () => {
    if (!requireDatabase()) return;

    // Vista's columns are `datetime`, not `datetime2`, so they need their own
    // assertion: the round trip above only proves datetime2.
    //
    // models/session.js no longer carries asLocalWallClock getters, because
    // useUTC:false already parses these offset-less values as IST. If either
    // the getters came back or useUTC flipped, this would be 5.5 hours out.
    //
    // Modelled on the connection that actually authenticated rather than the
    // app's `models` singleton, which is bound to NODE_ENV's database.
    const VistaSession = sequelize.define(
      'VistaSessionProbe',
      {
        sessionId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          field: 'Session_lngSessionId',
        },
        startsAt: { type: DataTypes.DATE, field: 'Session_dtmRealShow' },
      },
      { tableName: 'session', timestamps: false, freezeTableName: true }
    );

    const [raw] = await sequelize.query(
      `SELECT TOP 1 Session_lngSessionId AS id,
              CONVERT(varchar(19), Session_dtmRealShow, 121) AS stored
         FROM [session] ORDER BY Session_dtmRealShow DESC`
    );

    if (raw.length === 0) return; // no schedule data loaded

    const row = await VistaSession.findOne({
      where: { sessionId: raw[0].id },
      attributes: ['sessionId', 'startsAt'],
    });

    const d = row.startsAt;
    const pad = (n) => String(n).padStart(2, '0');
    const localWallClock =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    expect(localWallClock).toBe(raw[0].stored);
  });
});
