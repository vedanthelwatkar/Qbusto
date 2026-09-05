'use strict';

/**
 * Repairs the five live `product_availability_hours` rows that used the OLD
 * midnight-split pattern - a window that ran past midnight, entered as two
 * separate calendar-day rows because the API validator used to require
 * `endTime > startTime` and could not accept a single overnight window.
 *
 * THE FIVE ROWS (all at cinemas 5 and 9 - demo data; cinema 8 has none)
 *
 *   id 26  cinema_product 37 (cinema 5 / Large Popcorn)   Wed 00:00-23:59:59
 *   id 27  cinema_product 37 (cinema 5 / Large Popcorn)   Thu 00:00-02:00
 *   id 29  cinema_product 40 (cinema 5 / Nachos Grande)   Sun 00:00-02:00
 *   id 37  cinema_product 52 (cinema 9 / Badam Kulfi)     Mon 00:00-23:59:59
 *   id 38  cinema_product 52 (cinema 9 / Badam Kulfi)     Tue 00:00-05:59:59
 *
 * A sixth row, id 28 (cinema_product 40, Sat 18:00-23:59:59), is not one of
 * the five - it starts at 18:00, not before 06:00 - but it is the OTHER half
 * of id 29's pair and has to change too, or id 29's removal would shrink
 * availability rather than merely re-express it.
 *
 * WHY THESE BECAME WRONG, NOT JUST UGLY
 *
 * Once a day's rules are chosen by the 06:00 business day rather than by
 * `Date.getDay()` (the earlier business-day migration), a day's window is
 * checked whenever `businessDayOfWeek(now)` equals it - and a clock time
 * before 06:00 resolves to the PREVIOUS day's business day, never to "today".
 * So:
 *
 *   - id 26 (Wed, 00:00-23:59:59) is already checked at Thursday 01:00 clock
 *     time, because that instant's BUSINESS day is Wednesday. id 27 (Thu,
 *     00:00-02:00) can now never be reached at all: 00:00-02:00 clock time is
 *     always Wednesday's business day, never Thursday's. It became dead
 *     weight, not a fix - removing it changes nothing a customer experiences.
 *   - Same shape for id 37 / id 38 (Monday / Tuesday).
 *   - id 28+29 (Sat 18:00-23:59:59 + Sun 00:00-02:00) is different: id 28 does
 *     NOT run all day, so it does not already reach into Sunday's small hours
 *     the way an all-day window does. id 29 is still genuinely needed - it
 *     just needs to be ONE overnight window on Saturday's business day, which
 *     the validator can now express directly (22:00 -> 02:00-shaped windows
 *     are accepted since this task's validator change). id 28 becomes
 *     Sat 18:00 -> 02:00; id 29 is folded into it and removed.
 *
 * BEFORE / AFTER, IN REAL TIME (the thing that must not change)
 *
 *   Large Popcorn (cinema 5):  available Wed 00:00 clock -> Thu 02:00 clock,
 *     every week, before and after.
 *   Nachos Grande (cinema 5):  available Sat 18:00 clock -> Sun 02:00 clock,
 *     every week, before and after.
 *   Badam Kulfi (cinema 9):    available Mon 00:00 clock -> Tue 05:59:59
 *     clock, every week, before and after.
 *
 * Verified by running the actual `unavailableReason`/window-matching logic
 * against representative instants both before and after this migration - see
 * the migration's rehearsal, not asserted here from reasoning alone.
 *
 * NOT RE-RUNNABLE IN THE USUAL SENSE, THOUGH GUARDED
 *
 * Every step checks the row it targets still has its OLD shape before acting,
 * so running this twice is a no-op the second time rather than a further
 * change.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    // id 27: dead weight under the business day - id 26 already covers it.
    await sequelize.query(`
      DELETE FROM [dbo].[product_availability_hours]
      WHERE [id] = 27 AND [cinema_product_id] = 37 AND [day_of_week] = 4
        AND [start_time] = '00:00:00' AND [end_time] = '02:00:00'
    `);

    // id 38: same shape, dead weight - id 37 already covers it.
    await sequelize.query(`
      DELETE FROM [dbo].[product_availability_hours]
      WHERE [id] = 38 AND [cinema_product_id] = 52 AND [day_of_week] = 2
        AND [start_time] = '00:00:00' AND [end_time] = '05:59:59'
    `);

    // id 28: extend into an overnight window (Sat 18:00 -> Sun 02:00),
    // absorbing what id 29 used to cover as a separate Sunday row.
    await sequelize.query(`
      UPDATE [dbo].[product_availability_hours]
      SET [end_time] = '02:00:00'
      WHERE [id] = 28 AND [cinema_product_id] = 40 AND [day_of_week] = 6
        AND [start_time] = '18:00:00' AND [end_time] = '23:59:59'
    `);

    // id 29: folded into id 28 above - remove the now-redundant Sunday row.
    // Guarded on id 28 already having been extended, so a second run (where
    // id 28 no longer matches the old '23:59:59' end time) leaves this alone
    // rather than deleting Sunday coverage a re-run never actually restored.
    await sequelize.query(`
      DELETE FROM [dbo].[product_availability_hours]
      WHERE [id] = 29 AND [cinema_product_id] = 40 AND [day_of_week] = 7
        AND [start_time] = '00:00:00' AND [end_time] = '02:00:00'
        AND EXISTS (
          SELECT 1 FROM [dbo].[product_availability_hours]
          WHERE [id] = 28 AND [end_time] = '02:00:00'
        )
    `);
  },

  async down() {
    /*
     * Refused, not implemented.
     *
     * up() deletes two rows outright (id 27, id 38) and folds a third (id 29)
     * into an edit of id 28. Recreating deleted rows with their original IDs
     * needs IDENTITY_INSERT, which is fragile across separate query() calls on
     * a pooled connection and not worth the risk for what this migration
     * changes: three redundant/superseded rows at two demo cinemas, verified
     * behaviour-preserving before it ran. Restore from a backup if the
     * original five-row shape is genuinely needed back.
     */
    throw new Error(
      'Irreversible: 20260906000300-fix-overnight-availability removed superseded rows. Restore from a backup.'
    );
  },
};
