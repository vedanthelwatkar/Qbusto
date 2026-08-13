import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import { parseUrlParams } from '@/utils/parseUrlParams';
import ScreensaverPage from '@/pages/ScreensaverPage';
import CatalogPage from '@/pages/CatalogPage';
import CheckoutPage from '@/pages/CheckoutPage';
import PaymentPage from '@/pages/PaymentPage';
import ConfirmationPage from '@/pages/ConfirmationPage';

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
      </Routes>
    </Router>
  );
}
