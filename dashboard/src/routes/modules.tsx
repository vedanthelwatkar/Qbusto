/**
 * The navigation map: one entry per permission module.
 *
 * `module` is the exact module_name the backend authorises against, so a menu
 * entry and the endpoints behind it can never drift apart. `implemented` marks
 * which ones have a real screen - the rest render a placeholder, and this flag
 * is what will be flipped as each vertical slice lands.
 */

import type { ReactNode } from 'react';
import {
  AppstoreOutlined,
  BarChartOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DesktopOutlined,
  DollarOutlined,
  PictureOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  TeamOutlined,
  ApiOutlined,
} from '@ant-design/icons';

import type { ModuleName } from '@/types/auth';

export interface NavModule {
  /** Route path, and the menu key. */
  path: string;
  label: string;
  module: ModuleName;
  icon: ReactNode;
  implemented: boolean;
  /**
   * Screens that hang off this entry and are authorised against the same
   * module. Chains, cinemas and screens sit under Settings because that is the
   * module the backend checks them against - the frozen
   * CK_user_permissions_module_name constraint has no entry of their own.
   */
  children?: NavChild[];
}

export interface NavChild {
  path: string;
  label: string;
  icon: ReactNode;
}

export const NAV_MODULES: NavModule[] = [
  {
    path: '/',
    label: 'Dashboard',
    module: 'Dashboard',
    icon: <DashboardOutlined />,
    implemented: true,
  },
  {
    path: '/orders',
    label: 'Orders',
    module: 'Orders',
    icon: <ShoppingCartOutlined />,
    implemented: true,
  },
  {
    path: '/categories',
    label: 'Categories',
    module: 'Categories',
    icon: <TagsOutlined />,
    implemented: true,
  },
  {
    path: '/products',
    label: 'Products',
    module: 'Products',
    icon: <AppstoreOutlined />,
    implemented: true,
  },
  {
    path: '/pricing',
    label: 'Pricing',
    module: 'Pricing',
    icon: <DollarOutlined />,
    implemented: true,
  },
  {
    path: '/banners',
    label: 'Banners',
    module: 'Banners',
    icon: <PictureOutlined />,
    implemented: true,
  },
  { path: '/users', label: 'Users', module: 'Users', icon: <TeamOutlined />, implemented: true },
  {
    path: '/reports',
    label: 'Reports',
    module: 'Reports',
    icon: <BarChartOutlined />,
    implemented: false,
  },
  {
    path: '/pos-integrations',
    label: 'POS Integrations',
    module: 'POS Integrations',
    icon: <ApiOutlined />,
    implemented: false,
  },
  {
    path: '/settings',
    label: 'Settings',
    module: 'Settings',
    icon: <SettingOutlined />,
    implemented: false,
    children: [
      { path: '/settings/chains', label: 'Chains', icon: <ClusterOutlined /> },
      { path: '/settings/cinemas', label: 'Cinemas', icon: <ShopOutlined /> },
      { path: '/settings/screens', label: 'Screens', icon: <DesktopOutlined /> },
    ],
  },
];

/**
 * Every navigable path, parents and children alike, paired with the module it
 * is authorised against. A child inherits its parent's module, which is what
 * keeps the chain, cinema and screen screens on Settings without repeating it.
 */
export const NAV_ROUTES: { path: string; label: string; module: ModuleName }[] =
  NAV_MODULES.flatMap((entry) => [
    { path: entry.path, label: entry.label, module: entry.module },
    ...(entry.children ?? []).map((child) => ({
      path: child.path,
      label: child.label,
      module: entry.module,
    })),
  ]);
