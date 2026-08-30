'use strict';

/**
 * Development helper: put a few screenings in the window the Consumer's
 * session picker is actually looking at, right now.
 *
 * WHY THIS EXISTS
 *
 * The picker is deliberately narrow (see consumer.service.getSessions):
 *
 *   - only screenings starting within 3 hours either side of now, so at 03:00
 *     the window is 00:00 -> 06:00, not "the next 24 hours"
 *   - only `Session_strStatus = 'O'` (Open) is offered
 *   - at most 2 per screen
 *
 * The client's real data is a real cinema schedule, so outside opening hours
 * every one of those filters is doing its job and the picker is legitimately
 * empty. That is correct behaviour and not a bug - but it makes it impossible
 * to walk through checkout at 3am.
 *
 * This script inserts screenings positioned relative to the CURRENT time, so
 * it produces something visible whenever it is run.
 *
 * NOT FOR PRODUCTION. It writes rows into the client-owned `session` table.
 * Every row it creates uses a session id at or above DEV_ID_BASE, which is far
 * above anything the client's data uses, so its own rows are never touched and
 * re-running replaces only what this script created.
 *
 *   node scripts/seed-dev-sessions.js            # every active cinema
 *   node scripts/seed-dev-sessions.js PVRPHX     # one cinema, by code
 *   node scripts/seed-dev-sessions.js --clean    # remove seeded rows, add none
 */

require('dotenv').config();

const { sequelize } = require('../src/config/database');
const { toSqlDateTime } = require('../src/utils/sqlDate');

/**
 * Session ids from here up belong to this script. The client's data tops out
 * around 28,000, so this leaves an unmistakable gap - nothing here can be
 * confused with, or overwrite, a real screening.
 */
const DEV_ID_BASE = 900000;

/** Matches SESSION_WINDOW_HOURS in consumer.service.js. */
const SESSION_WINDOW_HOURS = 3;

/**
 * Minutes from now for each screening.
 *
 * The first is far enough out that it is still in the future by the time the
 * script finishes and a browser is refreshed, and they are spread so the
 * picker has something to sort. Two per screen is the picker's cap, so three
 * offsets across two screens fills it without being noise.
 */
const OFFSETS_MINUTES = [20, 50, 80, 110];

/** The near edge of the picker's window - it reaches back, not just forward. */
function windowStart(now) {
  return new Date(now.getTime() - SESSION_WINDOW_HOURS * 60 * 60 * 1000);
}

/** The far edge of the picker's window, as the picker computes it. */
function windowEnd(now) {
  return new Date(now.getTime() + SESSION_WINDOW_HOURS * 60 * 60 * 1000);
}

async function main() {
  const args = process.argv.slice(2);
  const cleanOnly = args.includes('--clean');
  const cinemaCode = args.find((arg) => !arg.startsWith('--')) || null;

  await sequelize.authenticate();

  const now = new Date();
  const windowEnds = windowEnd(now);

  // Always clear previously seeded rows first, so re-running does not pile up
  // stale screenings that have since drifted into the past.
  const [cleaned] = await sequelize.query(
    `DELETE FROM [session] WHERE Session_lngSessionId >= ${DEV_ID_BASE}`
  );
  void cleaned;
  console.log(`Removed any previously seeded dev sessions (id >= ${DEV_ID_BASE}).`);

  if (cleanOnly) {
    console.log('--clean given; nothing inserted.');
    return;
  }

  const [cinemas] = await sequelize.query(
    `SELECT id, code, name FROM cinemas
      WHERE is_active = 1 ${cinemaCode ? `AND code = '${cinemaCode.replace(/'/g, "''")}'` : ''}
      ORDER BY id`
  );

  if (cinemas.length === 0) {
    throw new Error(
      cinemaCode
        ? `No active cinema with code "${cinemaCode}".`
        : 'No active cinemas found. Run the dev data seeder first.'
    );
  }

  // Films with a title and a duration, so the picker has something to render.
  const [films] = await sequelize.query(
    `SELECT TOP 4 Film_strCode, Film_strTitle, Film_intDuration
       FROM film
      WHERE Film_strTitle IS NOT NULL AND Film_intDuration > 0
      ORDER BY Film_strCode`
  );

  if (films.length === 0) {
    throw new Error('No usable rows in `film`. The client schedule data is missing.');
  }

  let sessionId = DEV_ID_BASE;
  let inserted = 0;
  let skipped = 0;

  for (const cinema of cinemas) {
    for (let index = 0; index < OFFSETS_MINUTES.length; index += 1) {
      const startsAt = new Date(now.getTime() + OFFSETS_MINUTES[index] * 60 * 1000);

      // The picker will not show anything at or past the window's far edge, so
      // inserting one would be a confusing no-op rather than a test fixture.
      if (startsAt >= windowEnds) {
        skipped += 1;
        continue;
      }

      const film = films[index % films.length];
      const endsAt = new Date(startsAt.getTime() + film.Film_intDuration * 60 * 1000);

      // Two screens, so the picker's per-screen cap of 2 is exercised rather
      // than hidden.
      const screenNumber = (index % 2) + 1;
      const screenName = `Screen ${screenNumber}`;

      sessionId += 1;

      await sequelize.query(
        `INSERT INTO [session] (
           Code, Session_lngSessionId, Film_strCode, Screen_bytNum, Screen_strName,
           Session_strStatus, Session_strType, Session_dtmRealShow, Session_dtmFinishShow,
           PGroup_strCode, Session_intSeatsAvail, Session_intSeatsTotal,
           Session_strSeatAllocation, Session_strComments, Session_dtmStamp
         ) VALUES (
           :code, :sessionId, :filmCode, :screenNumber, :screenName,
           'O', 'N', :startsAt, :endsAt,
           'STD', 120, 150,
           'Y', '', :stamp
         )`,
        {
          replacements: {
            code: cinema.code,
            sessionId,
            filmCode: film.Film_strCode,
            screenNumber,
            screenName,
            startsAt: toSqlDateTime(startsAt),
            endsAt: toSqlDateTime(endsAt),
            stamp: toSqlDateTime(now),
          },
        }
      );

      inserted += 1;
      console.log(
        `  ${cinema.code.padEnd(8)} ${screenName.padEnd(9)} ` +
          `${toSqlDateTime(startsAt).slice(0, 16)}  ${film.Film_strTitle}`
      );
    }
  }

  console.log('');
  console.log(`Inserted ${inserted} Open session(s) across ${cinemas.length} cinema(s).`);
  if (skipped > 0) {
    console.log(
      `Skipped ${skipped} that would have fallen at or after ${toSqlDateTime(windowEnds).slice(0, 16)}, ` +
        'the far edge of the window the picker is currently showing.'
    );
  }
  console.log(
    `Picker window right now: ${toSqlDateTime(windowStart(now)).slice(0, 16)} -> ${toSqlDateTime(windowEnds).slice(0, 16)}.`
  );
}

main()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error('seed-dev-sessions failed:', error.message);
    await sequelize.close();
    process.exitCode = 1;
  });
