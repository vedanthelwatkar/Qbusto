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
  DashboardOutlined,
  DollarOutlined,
  PictureOutlined,
  SettingOutlined,
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
    implemented: false,
  },
  {
    path: '/categories',
    label: 'Categories',
    module: 'Categories',
    icon: <TagsOutlined />,
    implemented: false,
  },
  {
    path: '/products',
    label: 'Products',
    module: 'Products',
    icon: <AppstoreOutlined />,
    implemented: false,
  },
  {
    path: '/pricing',
    label: 'Pricing',
    module: 'Pricing',
    icon: <DollarOutlined />,
    implemented: false,
  },
  {
    path: '/banners',
    label: 'Banners',
    module: 'Banners',
    icon: <PictureOutlined />,
    implemented: false,
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
  },
];
