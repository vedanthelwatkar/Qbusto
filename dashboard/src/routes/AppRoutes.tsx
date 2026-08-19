/**
 * Route table.
 *
 * The module routes are generated from NAV_ROUTES so a menu entry and its route
 * cannot disagree, and each is wrapped in its own permission guard. Nested
 * entries - the chain, cinema and screen screens under Settings - are in that
 * list too, guarded by the module their parent declares. Dashboard is the index
 * route; everything else is a placeholder until its vertical slice is built.
 */

import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';

import BannersPage from '@/pages/BannersPage';
import CategoriesPage from '@/pages/CategoriesPage';
import ChainsPage from '@/pages/ChainsPage';
import CinemasPage from '@/pages/CinemasPage';
import ComingSoonPage from '@/pages/ComingSoonPage';
import DashboardPage from '@/pages/DashboardPage';
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';
import OrdersPage from '@/pages/OrdersPage';
import PricingPage from '@/pages/PricingPage';
import ProductsPage from '@/pages/ProductsPage';
import ScreensPage from '@/pages/ScreensPage';
import UsersPage from '@/pages/UsersPage';
import ProtectedRoute, { RequireModule } from '@/routes/ProtectedRoute';
import { NAV_ROUTES } from '@/routes/modules';

/**
 * The screens that exist, by path. A route with no entry here renders the
 * placeholder - which is what `implemented` on the same module records, so the
 * two are kept in step as each vertical slice lands.
 */
const PAGES: Record<string, ReactNode> = {
  '/': <DashboardPage />,
  '/users': <UsersPage />,
  '/orders': <OrdersPage />,
  '/categories': <CategoriesPage />,
  '/products': <ProductsPage />,
  '/pricing': <PricingPage />,
  '/banners': <BannersPage />,
  '/settings/chains': <ChainsPage />,
  '/settings/cinemas': <CinemasPage />,
  '/settings/screens': <ScreensPage />,
};

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        {NAV_ROUTES.map((entry) => {
          const element = (
            <RequireModule module={entry.module}>
              {PAGES[entry.path] ?? <ComingSoonPage title={entry.label} />}
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
