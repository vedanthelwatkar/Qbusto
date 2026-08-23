'use strict';

/**
 * Tops every active cinema up to a few header banners, so the Consumer's
 * banner rotation has something to rotate through.
 *
 * Writes only `banners`, unlike seed-dev-data.js, which purges and rebuilds
 * the whole sample set. Existing banners are left exactly as they are: this
 * adds rows only where a cinema has fewer header banners than the target, so
 * running it repeatedly does not pile up duplicates.
 *
 * `sequence` continues from the highest already used at that cinema. It orders
 * banners within a cinema rather than within a type, so new header banners can
 * sort after existing inner ones without disturbing either.
 *
 * Usage: npm run seed:banners
 */

require('dotenv').config();

const { models } = require('../src/config/database');

const OK = '✓';

/** Header banners each active cinema should end up with. */
const TARGET_HEADER_BANNERS = 3;

/** 'H' = header, 'I' = inner. Matches CK_banners_type. */
const HEADER = 'H';

/**
 * Placeholder artwork, at the aspect ratio the header strip crops to.
 *
 * The seed is derived from the cinema and slot so a given banner is the same
 * picture on every machine, which makes "did the banner change?" answerable by
 * looking at it.
 */
function imageUrl(cinemaId, slot) {
  return `https://picsum.photos/seed/qbusto-dev-banner-${cinemaId}-${slot}/1200/400`;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run: NODE_ENV is production. This seed is for development only.');
  }

  const cinemas = await models.Cinema.findAll({
    where: { isActive: true },
    attributes: ['id', 'name'],
    order: [['id', 'ASC']],
  });

  let created = 0;

  for (const cinema of cinemas) {
    const existing = await models.Banner.count({
      where: { cinemaId: cinema.id, type: HEADER, isActive: true },
    });

    const missing = TARGET_HEADER_BANNERS - existing;

    if (missing <= 0) {
      console.log(`  - ${cinema.name}: already has ${existing} header banner(s)`);
      continue;
    }

    // Continue the cinema's own numbering rather than restarting at 1, so the
    // new banners sort after everything already scheduled there.
    const highest = (await models.Banner.max('sequence', { where: { cinemaId: cinema.id } })) || 0;

    for (let offset = 0; offset < missing; offset += 1) {
      const sequence = highest + offset + 1;

      await models.Banner.create({
        cinemaId: cinema.id,
        imageUrl: imageUrl(cinema.id, sequence),
        type: HEADER,
        sequence,
        isActive: true,
      });

      created += 1;
    }

    console.log(`  ${OK} ${cinema.name}: ${existing} -> ${existing + missing} header banners`);
  }

  console.log('');
  console.log(`  ${OK} header banners created: ${created}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
