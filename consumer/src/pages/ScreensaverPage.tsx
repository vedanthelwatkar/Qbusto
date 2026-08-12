import { useNavigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import '../styles/pages/screensaver.scss';

export default function ScreensaverPage() {
  const navigate = useNavigate();
  const cinemaId = useContextStore((state) => state.cinemaId);

  const handleOrderNow = () => {
    if (cinemaId) {
      navigate('/catalog');
    }
  };

  return (
    <div className="screensaver">
      <div className="screensaver-content">
        <h1 className="screensaver-title">Order Now</h1>
        <p className="screensaver-subtitle">Fresh food at your fingertips</p>

        <button
          className="screensaver-cta"
          onClick={handleOrderNow}
          aria-label="Start ordering"
        >
          ORDER NOW
        </button>
      </div>
    </div>
  );
}
