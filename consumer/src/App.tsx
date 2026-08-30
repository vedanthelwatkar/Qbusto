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
import { useUIStore } from '@/stores/ui.store';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import { parseUrlParams } from '@/utils/parseUrlParams';
import { armKioskFullscreen } from '@/utils/kioskFullscreen';
import ScreensaverPage from '@/pages/ScreensaverPage';
import CatalogPage from '@/pages/CatalogPage';
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

/**
 * Sends a legacy `/checkout` link to the catalogue with the sheet open.
 *
 * Opening it here rather than leaving the customer on the bare menu keeps the
 * old link meaning what it always did. The cart is untouched, so whatever was
 * in it is still there.
 */
function CheckoutRedirect() {
  useEffect(() => {
    // Read through getState rather than subscribing: this component exists
    // only to open the sheet on the way past, and reacting to `cartOpen` would
    // reopen it the moment the customer closed it.
    const { cartOpen, toggleCart } = useUIStore.getState();
    if (!cartOpen) toggleCart();
  }, []);

  return <Navigate to="/catalog" replace />;
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
  // Checkout's show picker is a native select, which opens its own overlay.
  // Time spent choosing in it produces no pointer or key events on the page,
  // so without these a customer picking their show could be reset
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
 * NEVER runs on the payment page. The gateway checkout is an iframe, so a
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
  const resetUI = useUIStore((state) => state.reset);

  const enabled = pathname !== '/' && !pathname.startsWith('/payment');

  useEffect(() => {
    if (!enabled) return;

    let timerId: number;

    const abandon = () => {
      clearCart();
      clearCheckoutSession();
      // Keeps cinemaId/screenId/source, so a kiosk never needs re-provisioning.
      clearCustomerData();
      // Close the cart sheet as well as emptying it. Without this the flag
      // survives the reset and the next customer is shown an open, empty cart.
      resetUI();
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
  }, [enabled, pathname, navigate, clearCart, clearCustomerData, resetUI]);

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
      // The store holds row and seat SEPARATELY, so the combined `seatNumber`
      // the parser also derives is dropped here - it exists only to keep the
      // legacy ?seatNumber=A5 form readable, and carrying both would leave two
      // copies of the same fact that could drift apart.
      const { seatNumber, ...context } = qrContext;
      void seatNumber;

      setContext(context);
    } else {
      // Otherwise, load from localStorage (if available)
      loadFromLocalStorage();
    }
  }, [setContext, loadFromLocalStorage]);

  // Kiosk deployments must not show the browser's address bar or tabs. See
  // kioskFullscreen.ts for why this has to wait for the first tap rather than
  // firing immediately on load.
  useEffect(() => armKioskFullscreen(), []);

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
          {/* Checkout is a sheet over the catalogue now, not a page. The route
            is kept rather than deleted: it is in browser histories and on any
            card a customer has already been shown, and a bare 404 there would
            look like the order was lost. It opens the sheet on the catalogue
            instead, which is where checkout actually is. */}
          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <CheckoutRedirect />
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
