/**
 * Date and time formatting, pinned to the cinema's timezone.
 *
 * WHY NOT `toLocaleString()` ON ITS OWN
 *
 * The bare call formats in the VIEWER's timezone, taken from whatever the
 * browser is set to. For a business that runs in one country that is not a
 * feature: a laptop left on the wrong zone, or a kiosk imaged abroad, silently
 * renders every show time and order timestamp shifted, and looks completely
 * normal while doing it.
 *
 * The backend already pins its own process to APP_TIMEZONE for the same
 * reason. This is the display half of that rule.
 *
 * WHAT IS BEING CONVERTED
 *
 * QBusto's own timestamps (createdAt, showTime, ...) cross the wire as UTC
 * instants, which is what makes this conversion well-defined - an instant can
 * be rendered in any zone, and here it is always rendered in the cinema's.
 */

/**
 * The cinema's timezone. Mirrors APP_TIMEZONE in the backend's environment.
 *
 * A constant rather than a per-deployment setting: a Vite variable is baked in
 * at build time, so it could not follow a chain operating across zones anyway,
 * and pretending otherwise would suggest a flexibility that is not there. If
 * QBusto ever runs outside one zone, the timezone belongs on the cinema record
 * and gets threaded through from there.
 */
export const CINEMA_TIME_ZONE = 'Asia/Kolkata';

type DateInput = string | number | Date | null | undefined;

/** Parses anything the API hands back; null for a value that is not a date. */
function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date and time, e.g. "30/08/2026, 11:45:00 pm". Empty string when absent. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '';

  return date.toLocaleString(undefined, { timeZone: CINEMA_TIME_ZONE });
}

/** Date only, e.g. "30/08/2026". Empty string when absent. */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '';

  return date.toLocaleDateString(undefined, { timeZone: CINEMA_TIME_ZONE });
}

/** Time only, e.g. "11:45 pm". Empty string when absent. */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '';

  return date.toLocaleTimeString(undefined, {
    timeZone: CINEMA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}
