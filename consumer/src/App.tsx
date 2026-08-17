import { useEffect, useRef } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
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
