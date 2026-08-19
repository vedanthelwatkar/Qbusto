import { useNavigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import { AlertIcon, FilmIcon, SeatIcon } from '@/components/icons';
import '../styles/pages/screensaver.scss';

export default function ScreensaverPage() {
  const navigate = useNavigate();
  const cinemaId = useContextStore((state) => state.cinemaId);
  const seatNumber = useContextStore((state) => state.seatNumber);
  const filmTitle = useContextStore((state) => state.filmTitle);

  const handleOrderNow = () => {
    if (cinemaId) {
      navigate('/catalog');
    }
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
