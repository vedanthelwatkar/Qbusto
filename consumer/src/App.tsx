import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useContextStore } from '@/stores/context.store';
import { parseUrlParams } from '@/utils/parseUrlParams';

/**
 * Phase 4 minimal placeholder pages (no implementation, just route shells).
 * Phase 5+ will implement actual page functionality.
 */
function ScreensaverPage() {
  return <div className="page-screensaver">Screensaver - Phase 5</div>;
}

function CatalogPage() {
  return <div className="page-catalog">Catalog - Phase 5</div>;
}

function CheckoutPage() {
  return <div className="page-checkout">Checkout - Phase 6</div>;
}

function PaymentPage() {
  return <div className="page-payment">Payment - Phase 7</div>;
}

function ConfirmationPage() {
  return <div className="page-confirmation">Confirmation - Phase 8</div>;
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

  // On app load, parse QR parameters and initialize context
  useEffect(() => {
    const qrContext = parseUrlParams();
    setContext(qrContext);
  }, [setContext]);

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
