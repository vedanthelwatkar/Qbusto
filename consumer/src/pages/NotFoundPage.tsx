import { useNavigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import StatePanel from '@/components/StatePanel';
import { SearchIcon } from '@/components/icons';
import '../styles/pages/not-found.scss';

/**
 * Catch-all for URLs the app has no route for.
 *
 * Previously these rendered nothing at all — a blank white screen, which is
 * indistinguishable from a crash. It is a reachable state in normal use: a
 * mistyped or truncated QR link (`/cinemaId=63` instead of `/?cinemaId=63`)
 * lands here, and so does any stale bookmark.
 *
 * The recovery action depends on what the app still knows. With a cinema in
 * context the customer can go straight back to the menu; without one there is
 * nothing to browse, so the only honest advice is to scan again.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  const cinemaId = useContextStore((state) => state.cinemaId);

  return (
    <div className="not-found">
      <StatePanel
        icon={<SearchIcon size={28} />}
        title="This page doesn't exist"
        body={
          cinemaId
            ? 'The link you followed does not lead anywhere. Your cart is still here — head back to the menu to carry on.'
            : 'The link you followed does not lead anywhere. Scan the QR code at your seat to start an order.'
        }
        actions={
          cinemaId ? (
            <button
              className="btn btn--primary"
              onClick={() => navigate('/catalog', { replace: true })}
            >
              Back to the menu
            </button>
          ) : (
            <button
              className="btn btn--primary"
              onClick={() => navigate('/', { replace: true })}
            >
              Back to start
            </button>
          )
        }
      />
    </div>
  );
}
