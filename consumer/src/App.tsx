import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import { parseUrlParams } from '@/utils/parseUrlParams';
import ScreensaverPage from '@/pages/ScreensaverPage';
import CatalogPage from '@/pages/CatalogPage';

/**
 * Placeholder pages for Phase 6+ (not implemented in Phase 5).
 */
function CheckoutPage() {
  return <div className="page-placeholder">Checkout - Phase 6</div>;
}

function PaymentPage() {
  return <div className="page-placeholder">Payment - Phase 7</div>;
}

function ConfirmationPage() {
  return <div className="page-placeholder">Confirmation - Phase 8</div>;
}

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
    // If URL params provide context (especially cinemaId), use them
    if (Object.values(qrContext).some((v) => v !== null && v !== undefined)) {
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
          path="/confirmation"
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
