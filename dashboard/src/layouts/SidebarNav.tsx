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

  const visible = NAV_MODULES.filter((entry) => hasPermission(user, entry.module));

  // An entry with children becomes a submenu. Its own key is not navigable in
  // that case, which suits Settings: the module's own screen does not exist yet
  // and the entry is there to hold Chains, Cinemas and Screens.
  const items = visible.map((entry) => ({
    key: entry.path,
    icon: entry.icon,
    label: entry.label,
    children: entry.children?.map((child) => ({
      key: child.path,
      icon: child.icon,
      label: child.label,
    })),
  }));

  /** Every navigable key, children included, for the prefix match below. */
  const keys = visible.flatMap((entry) =>
    entry.children ? entry.children.map((child) => child.path) : [entry.path]
  );

  // Longest matching prefix, so /products/12 keeps Products highlighted. '/' is
  // excluded from prefix matching or it would match everything.
  const selected =
    keys
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
        // Read once, at mount, which is all that is needed: a submenu is
        // already open when its own entries are clicked, so this only matters
        // for arriving at a nested path directly.
        defaultOpenKeys={visible
          .filter((entry) => entry.children?.some((child) => child.path === selected))
          .map((entry) => entry.path)}
        onClick={({ key }) => {
          navigate(key);
          onNavigate?.();
        }}
      />
    </>
  );
}
