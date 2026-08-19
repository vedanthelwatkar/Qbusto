type OrderSource = 'qr' | 'seat_qr' | 'kiosk' | 'counter';

export interface QRContext {
  cinemaId: number | null;
  screenId: number | null;
  seatNumber: string | null;
  showTime: string | null;
  filmTitle: string | null;
  source: OrderSource;
}

export function parseUrlParams(): QRContext {
  const params = new URLSearchParams(window.location.search);

  const cinemaId = params.get('cinemaId');
  const screenId = params.get('screenId');
  const seatNumber = params.get('seatNumber');
  const showTime = params.get('showTime');
  const filmTitle = params.get('filmTitle');
  const source = params.get('source') as OrderSource | null;

  return {
    cinemaId: cinemaId ? parseInt(cinemaId, 10) : null,
    screenId: screenId ? parseInt(screenId, 10) : null,
    seatNumber: seatNumber || null,
    showTime: showTime || null,
    filmTitle: filmTitle || null,
    source: (source && ['qr', 'seat_qr', 'kiosk', 'counter'].includes(source)
      ? source
      : 'qr') as OrderSource,
  };
}
