import { useEffect, useRef } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import { parseUrlParams } from '@/utils/parseUrlParams';
import ScreensaverPage from '@/pages/ScreensaverPage';
import CatalogPage from '@/pages/CatalogPage';
import CheckoutPage from '@/pages/CheckoutPage';
import PaymentPage from '@/pages/PaymentPage';
import ConfirmationPage from '@/pages/ConfirmationPage';
import NotFoundPage from '@/pages/NotFoundPage';

/**
 * Protected route wrapper: ensures cinemaId is set before allowing navigation.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const cinemaId = useContextStore((state) => state.cinemaId) as number | null;
  if (!cinemaId) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Idle before the session is abandoned and handed back to the next customer. */
const IDLE_MS = 60_000;

/**
 * Activity that counts as "someone is still here".
 *
 * `scroll` is listened for in the capture phase because the catalog's product
 * list and category rail are their own scroll containers, and scroll does not
 * bubble to window — without capture, a customer browsing the menu by
 * scrolling would be reset mid-browse.
 */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
  // Checkout's Show Time is a datetime-local control, which opens a native
  // picker. Time spent in that picker produces no pointer or key events on the
  // page, so without these a customer choosing a show time could be reset
  // mid-checkout. `focusin` covers autofill and tabbing for the same reason.
  'input',
  'change',
  'focusin',
] as const;

/**
 * Returns an abandoned session to the screensaver and forgets the customer.
 *
 * A kiosk is shared, so a customer who walks away mid-order would otherwise
 * hand the next person their cart, seat, film and show time. The same rule is
 * applied on phones deliberately: it costs a phone customer nothing, because a
 * QR scan re-supplies everything, and one behaviour is far easier to keep
 * correct than two.
 *
 * NEVER runs on the payment page. Razorpay's checkout is an iframe, so a
 * customer typing their card details generates no events we can see and the
 * timer would fire while they are actively paying. Resetting there would also
 * discard the order id and attempt record that recovery depends on, at the
 * exact moment money may have moved.
 *
 * The screensaver is excluded too: there is nothing to abandon there.
 */
function IdleReset() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const clearCustomerData = useContextStore((state) => state.clearCustomerData);
  const clearCart = useCartStore((state) => state.clear);

  const enabled = pathname !== '/' && !pathname.startsWith('/payment');

  useEffect(() => {
    if (!enabled) return;

    let timerId: number;

    const abandon = () => {
      clearCart();
      clearCheckoutSession();
      // Keeps cinemaId/screenId/source, so a kiosk never needs re-provisioning.
      clearCustomerData();
      navigate('/', { replace: true });
    };

    const restart = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(abandon, IDLE_MS);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, restart, { passive: true, capture: true });
    }
    restart();

    return () => {
      window.clearTimeout(timerId);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, restart, { capture: true });
      }
    };
  }, [enabled, pathname, navigate, clearCart, clearCustomerData]);

  return null;
}

/**
 * Moves focus to the top of the new page after a route change.
 *
 * A client-side navigation swaps the whole screen but leaves focus wherever it
 * was — usually on a button that no longer exists, at which point the browser
 * drops focus to <body>. A screen-reader or keyboard user then gets no signal
 * that the page changed and has to hunt for the new content. Focusing the
 * routed container puts the reading cursor at the start of it, so the new
 * page's heading is the next thing announced.
 *
 * `tabIndex={-1}` makes the wrapper programmatically focusable without adding
 * it to the tab order. The first render is skipped: on initial load focus is
 * already in the right place and stealing it would fight the browser.
 */
function RoutedView({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    ref.current?.focus();
  }, [pathname]);

  return (
    <div ref={ref} tabIndex={-1} className="routed-view">
      {children}
    </div>
  );
}

export default function App() {
  const setContext = useContextStore((state) => state.setContext);
  const loadFromLocalStorage = useContextStore((state) => state.loadFromLocalStorage);

  // On app load, parse QR parameters; if none, load from localStorage
  useEffect(() => {
    const qrContext = parseUrlParams();
    // cinemaId is the only parameter required in every documented QR scenario
    // (README §9), and setContext replaces the whole context. Accepting a URL
    // without it — a plain refresh, or a stray param like ?seatNumber=A5 —
    // would persist a context of nulls, wipe the stored cinemaId and eject the
    // user. `source` can never signal presence: it always defaults to 'qr'.
    if (qrContext.cinemaId !== null) {
      setContext(qrContext);
    } else {
      // Otherwise, load from localStorage (if available)
      loadFromLocalStorage();
    }
  }, [setContext, loadFromLocalStorage]);

  return (
    <Router>
      <IdleReset />
      <RoutedView>
        <Routes>
        <Route path="/" element={<ScreensaverPage />} />
        <Route
          path="/catalog"
          element={
            <ProtectedRoute>
              <CatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkout"
          element={
            <ProtectedRoute>
              <CheckoutPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payment"
          element={
            <ProtectedRoute>
              <PaymentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/confirmation/:orderId"
          element={
            <ProtectedRoute>
              <ConfirmationPage />
            </ProtectedRoute>
          }
        />
        {/* Catch-all. Not wrapped in ProtectedRoute: an unknown URL should say
            so, not silently bounce to the screensaver, which reads as the link
            having worked. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </RoutedView>
    </Router>
  );
}
