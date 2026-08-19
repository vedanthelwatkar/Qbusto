/**
 * The app shell every authenticated screen renders inside.
 *
 * Below the lg breakpoint the sidebar becomes a drawer rather than a narrower
 * rail: an icon-only rail costs width that a phone does not have, and the
 * drawer closes on navigation so it never sits over the content.
 */

import { useState } from 'react';
import { Drawer, Grid, Layout } from 'antd';
import { Outlet } from 'react-router-dom';

import ChangePasswordModal from '@/components/ChangePasswordModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import HeaderBar from '@/layouts/HeaderBar';
import SidebarNav from '@/layouts/SidebarNav';
import { useUiStore } from '@/stores/ui.store';

const { Header, Sider, Content } = Layout;

export default function DashboardLayout() {
  const screens = Grid.useBreakpoint();

  // Compared against false rather than negated: useBreakpoint returns {} on the
  // first render and fills in from an effect, so `!screens.lg` would report
  // mobile before anything has been measured - hiding the sidebar for a frame
  // on every desktop load.
  const isMobile = screens.lg === false;

  const siderCollapsed = useUiStore((state) => state.siderCollapsed);
  const toggleSider = useUiStore((state) => state.toggleSider);
  const navDrawerOpen = useUiStore((state) => state.navDrawerOpen);
  const setNavDrawerOpen = useUiStore((state) => state.setNavDrawerOpen);

  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <Layout className="app-shell">
      {isMobile ? (
        <Drawer
          placement="left"
          size={240}
          open={navDrawerOpen}
          onClose={() => setNavDrawerOpen(false)}
          closable={false}
          classNames={{ body: 'sidebar--drawer' }}
          styles={{ body: { padding: 0 } }}
        >
          <SidebarNav onNavigate={() => setNavDrawerOpen(false)} />
        </Drawer>
      ) : (
        <Sider collapsible collapsed={siderCollapsed} trigger={null} width={240}>
          <SidebarNav collapsed={siderCollapsed} />
        </Sider>
      )}

      <Layout>
        <Header className="app-shell__header">
          <HeaderBar
            onToggleNav={() => (isMobile ? setNavDrawerOpen(!navDrawerOpen) : toggleSider())}
            onChangePassword={() => setChangingPassword(true)}
          />
        </Header>

        <Content className="app-shell__content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Content>
      </Layout>

      <ChangePasswordModal open={changingPassword} onClose={() => setChangingPassword(false)} />
    </Layout>
  );
}
