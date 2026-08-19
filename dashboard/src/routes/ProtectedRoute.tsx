/**
 * Route guards.
 *
 * ProtectedRoute answers "is there a session"; RequireModule answers "should
 * this user see this screen". Both are UX: a user who defeats them reaches an
 * endpoint that checks the same thing server-side and returns 401 or 403.
 */

import { Navigate, useLocation } from 'react-router-dom';

import AppLoader from '@/components/AppLoader';
import DashboardLayout from '@/layouts/DashboardLayout';
import ForbiddenPage from '@/pages/ForbiddenPage';
import { useAuthStore } from '@/stores/auth.store';
import type { ModuleName } from '@/types/auth';
import { hasPermission } from '@/utils/permissions';

export default function ProtectedRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  // 'idle' and 'loading' both mean the session is still unknown. Redirecting
  // now would sign out anyone who reloaded the page.
  if (status === 'idle' || status === 'loading') {
    return <AppLoader tip="Restoring your session" />;
  }

  if (status !== 'authenticated') {
    // `from` is what sends the user back where they were headed after login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <DashboardLayout />;
}

export function RequireModule({
  module,
  children,
}: {
  module: ModuleName;
  children: React.ReactNode;
}) {
  const user = useAuthStore((state) => state.user);

  if (!hasPermission(user, module)) return <ForbiddenPage />;

  return children;
}
