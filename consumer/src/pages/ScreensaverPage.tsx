import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import { fetchCinema } from '@/services/catalog.service';
import { parseUrlParams } from '@/utils/parseUrlParams';
import { resolveImageUrl } from '@/utils/imageUrl';
import { AlertIcon, FilmIcon, SeatIcon } from '@/components/icons';
import '../styles/pages/screensaver.scss';

export default function ScreensaverPage() {
  const navigate = useNavigate();
  const cinemaId = useContextStore((state) => state.cinemaId);
  // Joined for display only; the store keeps row and seat apart.
  const seatNumber = useContextStore((state) => state.seatLabel());
  const filmTitle = useContextStore((state) => state.filmTitle);
  const clearCart = useCartStore((state) => state.clear);
  const resetUI = useUIStore((state) => state.reset);
  const clearCustomerData = useContextStore((state) => state.clearCustomerData);

  /**
   * The cinema's own screensaver artwork, configured per cinema in the
   * Dashboard. Null while it loads, and null for a cinema that has none - the
   * cinemas that predate the field, which fall back to the text hero below.
   */
  const [screensaverUrl, setScreensaverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cinemaId) return;

    let active = true;

    fetchCinema(cinemaId)
      .then((cinema) => {
        if (active) setScreensaverUrl(cinema.screensaverUrl ?? null);
      })
      // Deliberately silent: this screen's job is to let someone start an
      // order. A failed artwork fetch falls back to the text hero rather than
      // putting an error in front of a customer who has done nothing wrong.
      .catch(() => {
        if (active) setScreensaverUrl(null);
      });

    return () => {
      active = false;
    };
  }, [cinemaId]);

  /**
   * Forget the previous customer on the way IN - but only when this page load
   * is not itself supplying a seat.
   *
   * This screen is where one customer's session ends and the next begins, and
   * it is the ONLY place that can do it: IdleReset is disabled on '/' (see
   * App.tsx), so a customer who abandons at the payment step and lands back
   * here would otherwise leave their seat and film prefilled for whoever walks
   * up next.
   *
   * Clearing unconditionally is what the previous version did on the way OUT,
   * and it wiped the seat the customer's own QR had just supplied. Reading the
   * URL distinguishes the two: a scan carries row/seat and must be kept (on a
   * seat QR the seat is a property of the physical location), while a return
   * to a bare '/' - after an idle reset, a back navigation or a kiosk order -
   * carries nothing and should be cleared.
   */
  useEffect(() => {
    const { row, seat, filmTitle: urlFilm } = parseUrlParams();
    if (row || seat || urlFilm) return;

    clearCustomerData();
  }, [clearCustomerData]);

  /**
   * The cart sheet and its "open" flag are stale UI state from whatever route
   * got the customer back here (idle timeout, back navigation, a reload), so
   * they are cleared on the way out to the catalogue.
   */
  const handleOrderNow = () => {
    if (!cinemaId) return;

    clearCart();
    clearCheckoutSession();
    resetUI();

    navigate('/catalog');
  };

  const hasContext = Boolean(seatNumber || filmTitle);

  // Without a cinema there is nothing to browse, so the artwork layout would
  // be a poster with a dead button under it. Say so instead.
  if (!cinemaId) {
    return (
      <div className="screensaver">
        <div className="screensaver__content">
          <span className="screensaver__eyebrow">QBusto</span>
          <h1 className="screensaver__title">Snacks, straight to your seat</h1>

          <div className="screensaver__notice" role="status">
            <AlertIcon size={20} />
            <div>
              <p className="screensaver__notice-title">No cinema selected</p>
              <p className="screensaver__notice-body">
                Scan the QR code at your seat or on the counter to start ordering.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /**
   * The whole screen is the control.
   *
   * A customer walking up to a kiosk taps the artwork, not a button inside it,
   * so the button IS the layout: "Order Now" above the cinema's poster and
   * "Touch Here!" below it, with the poster between them. It stays a real
   * <button> so it is keyboard- and screen-reader-operable rather than a div
   * with a click handler.
   */
  return (
    <div className="screensaver screensaver--artwork">
      <button
        type="button"
        className="screensaver__stage"
        onClick={handleOrderNow}
        aria-label="Touch anywhere to start your order"
      >
        <span className="screensaver__cue screensaver__cue--top">Order Now</span>

        <span className="screensaver__art">
          {screensaverUrl ? (
            <img
              className="screensaver__art-image"
              src={resolveImageUrl(screensaverUrl)}
              alt=""
              // Decorative: the button's own label already says what to do, and
              // the artwork carries its own wording in the image.
              aria-hidden="true"
            />
          ) : (
            /* No artwork configured for this cinema - the original text hero,
               kept so an existing cinema is never left with a blank screen. */
            <span className="screensaver__fallback">
              <span className="screensaver__eyebrow">QBusto</span>
              <span className="screensaver__title">Snacks, straight to your seat</span>
              <span className="screensaver__subtitle">
                Order from the counter menu without missing a moment of the film.
              </span>
            </span>
          )}
        </span>

        <span className="screensaver__cue screensaver__cue--bottom">Touch Here!</span>
      </button>

      {hasContext && (
        <ul className="screensaver__context">
          {filmTitle && (
            <li className="screensaver__chip">
              <FilmIcon size={16} />
              {filmTitle}
            </li>
          )}
          {seatNumber && (
            <li className="screensaver__chip">
              <SeatIcon size={16} />
              Seat {seatNumber}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
