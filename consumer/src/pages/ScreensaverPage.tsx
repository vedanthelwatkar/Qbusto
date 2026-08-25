import { useNavigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import { AlertIcon, FilmIcon, SeatIcon } from '@/components/icons';
import '../styles/pages/screensaver.scss';

export default function ScreensaverPage() {
  const navigate = useNavigate();
  const cinemaId = useContextStore((state) => state.cinemaId);
  const seatNumber = useContextStore((state) => state.seatNumber);
  const filmTitle = useContextStore((state) => state.filmTitle);
  const clearCustomerData = useContextStore((state) => state.clearCustomerData);
  const clearCart = useCartStore((state) => state.clear);
  const resetUI = useUIStore((state) => state.reset);

  /**
   * Starting an order is the one point where a genuinely new customer begins,
   * so it is where everything from the previous one is discarded.
   *
   * Doing it HERE rather than relying on the idle timer is deliberate. The
   * timer is only one of the ways this screen is reached - a customer can also
   * navigate back, finish a payment, or reload - and each of those left some
   * scrap of the last session behind. The most visible was the cart sheet:
   * abandonment cleared the cart's contents but not the flag saying the sheet
   * was open, so the next person was greeted by an open, empty cart.
   *
   * Resetting unconditionally on the way IN makes that class of bug
   * impossible, whatever route got the customer here.
   *
   * cinemaId, screenId and source are deliberately kept: they identify the
   * kiosk or the scanned QR, not the customer, and dropping them would make a
   * kiosk need re-provisioning between every order.
   */
  const handleOrderNow = () => {
    if (!cinemaId) return;

    clearCart();
    clearCheckoutSession();
    clearCustomerData();
    resetUI();

    navigate('/catalog');
  };

  const hasContext = Boolean(seatNumber || filmTitle);

  return (
    <div className="screensaver">
      <div className="screensaver__content">
        <span className="screensaver__eyebrow">QBusto</span>

        <h1 className="screensaver__title">Snacks, straight to your seat</h1>

        <p className="screensaver__subtitle">
          Order from the counter menu without missing a moment of the film.
        </p>

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

        {cinemaId ? (
          <button
            className="btn btn--primary btn--lg screensaver__cta"
            onClick={handleOrderNow}
          >
            Start your order
          </button>
        ) : (
          /* Without a cinema there is nothing to browse. Say so, rather than
             leaving a button that silently does nothing. */
          <div className="screensaver__notice" role="status">
            <AlertIcon size={20} />
            <div>
              <p className="screensaver__notice-title">No cinema selected</p>
              <p className="screensaver__notice-body">
                Scan the QR code at your seat or on the counter to start ordering.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
