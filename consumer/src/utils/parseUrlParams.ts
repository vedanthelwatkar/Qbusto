type OrderSource = 'qr' | 'seat_qr' | 'kiosk' | 'counter';

export interface QRContext {
  cinemaId: number | null;
  screenId: number | null;
  /** Row and seat as separate values, e.g. 'A' and '5'. */
  row: string | null;
  seat: string | null;
  /**
   * The two joined, e.g. 'A5'.
   *
   * Still the canonical form: it is what the order is created with, what the
   * idempotency fingerprint hashes and what the database column holds. Splitting
   * the URL was a change to the QR contract, not to how a seat is stored.
   */
  seatNumber: string | null;
  showTime: string | null;
  filmTitle: string | null;
  source: OrderSource;
}

/** The shape a combined seat takes: one or two letters, then up to three digits. */
const COMBINED_SEAT = /^([A-Za-z]{1,2})\s*(\d{1,3})$/;

/**
 * Split a legacy combined seat such as 'A5' into its parts.
 *
 * Returns nulls for anything that does not match, so a malformed value is
 * ignored rather than half-applied.
 */
function splitCombined(value: string): { row: string | null; seat: string | null } {
  const match = value.trim().match(COMBINED_SEAT);
  if (!match) return { row: null, seat: null };

  return { row: match[1].toUpperCase(), seat: match[2] };
}

export function parseUrlParams(): QRContext {
  const params = new URLSearchParams(window.location.search);

  const cinemaId = params.get('cinemaId');
  const screenId = params.get('screenId');
  const showTime = params.get('showTime');
  const filmTitle = params.get('filmTitle');
  const source = params.get('source') as OrderSource | null;

  /**
   * Row and seat are separate parameters: `?row=A&seat=5`.
   *
   * BACKWARD COMPATIBILITY: QR codes already printed and stuck to seats carry
   * the old combined `?seatNumber=A5`, and those must keep working - they
   * cannot be reprinted on a deploy. The legacy value is therefore still read
   * and split, and is used only when the new parameters are absent, so a URL
   * carrying both is not ambiguous.
   */
  const rowParam = params.get('row');
  const seatParam = params.get('seat');
  const legacySeatNumber = params.get('seatNumber');

  let row: string | null = null;
  let seat: string | null = null;

  if (rowParam || seatParam) {
    row = rowParam ? rowParam.trim().toUpperCase() || null : null;
    seat = seatParam ? seatParam.trim() || null : null;
  } else if (legacySeatNumber) {
    ({ row, seat } = splitCombined(legacySeatNumber));
  }

  // Only a complete pair makes a seat. A row with no seat identifies nothing,
  // and joining a partial pair would produce a value like 'A' that the
  // checkout form could not split back apart.
  const seatNumber = row && seat ? `${row}${seat}` : null;

  return {
    cinemaId: cinemaId ? parseInt(cinemaId, 10) : null,
    screenId: screenId ? parseInt(screenId, 10) : null,
    row,
    seat,
    seatNumber,
    showTime: showTime || null,
    filmTitle: filmTitle || null,
    source: (source && ['qr', 'seat_qr', 'kiosk', 'counter'].includes(source)
      ? source
      : 'qr') as OrderSource,
  };
}
