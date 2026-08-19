/**
 * Conversions between the API's show-time format and the `datetime-local`
 * input format.
 *
 * The backend stores `Order.showTime` as a DATETIME and the documented payload
 * uses an absolute ISO instant (e.g. "2026-08-11T19:30:00Z"). A
 * `datetime-local` control, by contrast, only accepts and emits a *local
 * wall-clock* string with no offset ("2026-08-11T19:30").
 *
 * Feeding an ISO instant straight into the control makes it reject the value
 * silently, which is how QR-supplied show times were being dropped. These
 * helpers convert in both directions and preserve the instant: the value is
 * rendered in the device's local timezone and converted back to UTC on submit,
 * so a round trip returns the same point in time.
 */

/**
 * Plausible range for a cinema show time. Deliberately wide: a show time in
 * the recent past is legitimate — customers order during a running show — so
 * this rejects only corrupted values (a mistyped "0202", a stray century),
 * never a real showing.
 */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Pad to two digits for the datetime-local wire format. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * ISO instant (or any Date-parseable string) -> "YYYY-MM-DDTHH:mm" in local time.
 * Returns '' when the input is missing or unparseable, so the control renders
 * empty rather than silently holding a value the browser will discard.
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * "YYYY-MM-DDTHH:mm" local wall-clock -> absolute ISO instant (UTC, with Z).
 *
 * A datetime string without an offset is interpreted as local time per the
 * ECMAScript spec, so `toISOString()` yields the correct absolute instant.
 * Returns null when the value is missing or unparseable.
 */
export function localInputToIso(local: string | null | undefined): string | null {
  if (!local) return null;

  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

/** True when the value is a complete, real, parseable local datetime. */
export function isValidLocalDateTime(local: string | null | undefined): boolean {
  if (!local) return false;

  // The control emits YYYY-MM-DDTHH:mm (optionally with seconds); reject
  // anything else outright rather than relying on Date's lenient parsing.
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?$/);
  if (!match) return false;

  const [, year, month, day, hour, minute] = match.map(Number);

  // A corrupted year still round-trips consistently ("0202" parses to year 202
  // and matches itself), so the range has to be checked separately.
  if (year < MIN_YEAR || year > MAX_YEAR) return false;

  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return false;

  // Date silently rolls impossible dates over (Feb 30 becomes Mar 2), so
  // confirm the parsed value still describes the date that was entered.
  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute
  );
}
