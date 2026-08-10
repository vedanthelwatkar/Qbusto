/**
 * The navigation menu, rendered inside a Sider on desktop and a Drawer on
 * mobile.
 *
 * Entries are filtered by read permission. That is presentation only: the
 * routes are guarded separately and the backend authorises every request.
 */

import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

import { NAV_MODULES } from '@/routes/modules';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';

interface SidebarNavProps {
  /** Hide the wordmark when the rail is collapsed. */
  collapsed?: boolean;
  onNavigate?: () => void;
}

export default function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();

  const items = NAV_MODULES.filter((entry) => hasPermission(user, entry.module)).map((entry) => ({
    key: entry.path,
    icon: entry.icon,
    label: entry.label,
  }));

  // Longest matching prefix, so /products/12 keeps Products highlighted. '/' is
  // excluded from prefix matching or it would match everything.
  const selected =
    items
      .map((item) => item.key)
      .filter((key) => key !== '/' && location.pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] ?? (location.pathname === '/' ? '/' : '');

  return (
    <>
      <div className="sidebar__brand">
        <span className="sidebar__mark">Q</span>
        {collapsed ? null : <span className="sidebar__wordmark">QBusto</span>}
      </div>

      <Menu
        mode="inline"
        theme="dark"
        items={items}
        selectedKeys={selected ? [selected] : []}
        onClick={({ key }) => {
          navigate(key);
          onNavigate?.();
        }}
      />
    </>
  );
}
