/**
 * Route table.
 *
 * The module routes are generated from NAV_MODULES so a menu entry and its
 * route cannot disagree, and each is wrapped in its own permission guard.
 * Dashboard is the index route; everything else is a placeholder until its
 * vertical slice is built.
 */

import { Route, Routes } from 'react-router-dom';

import ComingSoonPage from '@/pages/ComingSoonPage';
import DashboardPage from '@/pages/DashboardPage';
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';
import ProtectedRoute, { RequireModule } from '@/routes/ProtectedRoute';
import { NAV_MODULES } from '@/routes/modules';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        {NAV_MODULES.map((entry) => {
          const element = (
            <RequireModule module={entry.module}>
              {entry.path === '/' ? <DashboardPage /> : <ComingSoonPage title={entry.label} />}
            </RequireModule>
          );

          return entry.path === '/' ? (
            <Route index element={element} key={entry.path} />
          ) : (
            <Route path={entry.path} element={element} key={entry.path} />
          );
        })}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
