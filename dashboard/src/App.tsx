import { useEffect } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import { BrowserRouter } from 'react-router-dom';

import ErrorBoundary from '@/components/ErrorBoundary';
import AppRoutes from '@/routes/AppRoutes';
import { useAuthStore } from '@/stores/auth.store';
import { theme } from '@/theme';

export default function App() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  // Restores a session from the stored token before any protected route
  // decides what to render.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ConfigProvider theme={theme}>
      {/* antd's App provides the message/modal context the static methods need. */}
      <AntApp>
        <ErrorBoundary>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  );
}
