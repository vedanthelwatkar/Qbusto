/**
 * Times on an availability window.
 *
 * The API speaks `HH:MM:SS` in both directions. The backend formats its TIME
 * columns itself precisely so a client never sees the 1970-01-01 placeholder
 * date the driver pins them to, so there is no date half to strip here - these
 * are plain wall-clock strings and are treated as such.
 *
 * The pickers work in `HH:mm:ss` rather than `HH:mm` on purpose. Splitting
 * late-night hours across two days needs a window that ends at 23:59:59, and a
 * minutes-only picker would rewrite that to 23:59:00 on the next save - opening
 * a 59-second hole in the schedule without anyone asking for it. Reading is
 * where the friendlier form belongs, so `timeLabel` drops the seconds when they
 * are zero and keeps them when they are not.
 */

import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// Bare dayjs() ignores a format argument and hands the string to Date, which
// reads '09:00:00' as an invalid date. This is what makes strict parsing of a
// bare time work, and it is registered here rather than at app start-up because
// this module is the only thing that needs it.
dayjs.extend(customParseFormat);

/** What the pickers show, and what the API expects. */
export const TIME_FORMAT = 'HH:mm:ss';

/** The end of a day, for the first half of a late-night pair. */
export const END_OF_DAY = '23:59:59';

/** The start of a day, for the second half. */
export const START_OF_DAY = '00:00:00';

/**
 * How to express hours that run past midnight, given the backend requires
 * `startTime` to be earlier than `endTime`.
 *
 * BOTH HALVES GO ON THE SAME DAY, and that is the part worth getting right.
 * A QBusto day runs 6:00 am to 6:00 am, so Sunday already OWNS the small hours
 * of Monday morning - they are the back end of Sunday's trading night, not the
 * front of Monday's. Filing the second half under Monday, which is what this
 * hint used to advise, files it under Monday's 6:00 am to 6:00 am instead, and
 * it then covers the small hours of TUESDAY.
 *
 * Written once here because the form and the schedule both have to say the same
 * thing, and it is the one piece of the contract users will run into by
 * accident.
 */
export const LATE_NIGHT_HINT =
  'A window has to start and end on the same day, and a day runs 6:00 am to ' +
  '6:00 am. For hours that run past midnight, add one ending at ' +
  `${END_OF_DAY} and another starting at ${START_OF_DAY} on the SAME day - ` +
  'the small hours after midnight belong to the day that just ended.';

/**
 * `HH:MM` or `HH:MM:SS` as a dayjs, for a TimePicker value.
 *
 * The date part is today's and is never sent anywhere - TimePicker needs a full
 * Dayjs, and only the time half of it is ever read back out.
 */
export function parseTime(value: string | undefined): Dayjs | null {
  if (!value) return null;

  const parsed = dayjs(value, ['HH:mm:ss', 'HH:mm'], true);

  return parsed.isValid() ? parsed : null;
}

/** A TimePicker value as the `HH:MM:SS` the API expects. */
export function toApiTime(value: Dayjs): string {
  return value.format(TIME_FORMAT);
}

/**
 * A stored time for reading: `09:00`, but `23:59:59` rather than `23:59`.
 *
 * Anything that does not parse is shown as it arrived instead of being blanked,
 * so an unexpected value is visible rather than silently missing.
 */
export function timeLabel(value: string | undefined): string {
  const parsed = parseTime(value);

  if (!parsed) return value ?? '-';

  return parsed.second() === 0 ? parsed.format('HH:mm') : parsed.format(TIME_FORMAT);
}

/** Both ends of a window, for a tag or a confirmation dialog. */
export function windowLabel(startTime: string | undefined, endTime: string | undefined): string {
  return `${timeLabel(startTime)} - ${timeLabel(endTime)}`;
}

/**
 * Sort key for a window's start.
 *
 * Normalised to `HH:MM:SS` first: on equal-length strings lexicographic order
 * is chronological order, which is the same comparison the backend's overlap
 * check relies on. A malformed value sorts last rather than throwing.
 */
export function timeSortKey(value: string | undefined): string {
  const parsed = parseTime(value);

  return parsed ? parsed.format(TIME_FORMAT) : '99:99:99';
}
