/**
 * The QBusto palette, and the antd tokens derived from it.
 *
 * This file is the source of truth for colour. Components should not carry hex
 * values: antd reads everything below through ConfigProvider, and the handful of
 * rules that antd does not own read the same values as CSS custom properties,
 * which src/styles/global.scss declares from this list.
 *
 * antd computes its own hover, active and background shades from the base
 * tokens, so only the bases are set here - naming every step would fight the
 * algorithm rather than help it.
 */

import type { ThemeConfig } from 'antd';

export const PALETTE = {
  primary: {
    50: '#FFF4E9',
    100: '#FFE2C8',
    200: '#FFCB9C',
    300: '#FFB470',
    400: '#FFA14B',
    500: '#FF8C23',
    600: '#E67E20',
    700: '#C76D1B',
    800: '#A65B17',
    900: '#854912',
  },
  neutral: {
    /** Sidebar, and anything else that needs to read as the product's frame. */
    ink: '#0D0D0D',
    text: '#1A1A1A',
    muted: '#6B7280',
    border: '#E5E7EB',
    pageBg: '#F5F6F8',
    surface: '#FFFFFF',
  },
  semantic: {
    success: '#52C41A',
    warning: '#FAAD14',
    error: '#FF4D4F',
    info: '#638aca',
  },
} as const;

export const theme: ThemeConfig = {
  token: {
    colorPrimary: PALETTE.primary[500],
    colorSuccess: PALETTE.semantic.success,
    colorWarning: PALETTE.semantic.warning,
    colorError: PALETTE.semantic.error,
    colorInfo: PALETTE.semantic.info,

    colorText: PALETTE.neutral.text,
    colorTextSecondary: PALETTE.neutral.muted,
    colorBorder: PALETTE.neutral.border,
    colorBorderSecondary: PALETTE.neutral.border,
    colorBgLayout: PALETTE.neutral.pageBg,
    colorBgContainer: PALETTE.neutral.surface,

    // Links are the brand colour rather than antd's blue, so a link in a table
    // cell and a primary button read as the same product.
    colorLink: PALETTE.primary[600],
    colorLinkHover: PALETTE.primary[500],
    colorLinkActive: PALETTE.primary[700],

    borderRadius: 6,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: PALETTE.neutral.surface,
      headerHeight: 56,
      headerPadding: '0 16px',
      bodyBg: PALETTE.neutral.pageBg,
      siderBg: PALETTE.neutral.ink,
      triggerBg: PALETTE.neutral.ink,
    },
    Menu: {
      itemMarginInline: 8,
      // The sidebar runs on the dark palette, so these are the tokens that
      // matter; the light equivalents are never rendered.
      darkItemBg: PALETTE.neutral.ink,
      darkSubMenuItemBg: PALETTE.neutral.ink,
      darkPopupBg: PALETTE.neutral.ink,
      darkItemColor: 'rgba(255, 255, 255, 0.72)',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
      darkItemHoverColor: PALETTE.neutral.surface,
      darkItemSelectedBg: PALETTE.primary[500],
      darkItemSelectedColor: PALETTE.neutral.surface,
    },
    Table: {
      headerBg: PALETTE.neutral.pageBg,
      headerColor: PALETTE.neutral.muted,
      headerSplitColor: PALETTE.neutral.border,
      rowHoverBg: PALETTE.primary[50],
      borderColor: PALETTE.neutral.border,
    },
    Card: {
      colorBorderSecondary: PALETTE.neutral.border,
    },
    Modal: {
      headerBg: PALETTE.neutral.surface,
      contentBg: PALETTE.neutral.surface,
    },
    Drawer: {
      colorBgElevated: PALETTE.neutral.surface,
    },
    Input: {
      hoverBorderColor: PALETTE.primary[300],
      activeBorderColor: PALETTE.primary[500],
    },
    Select: {
      hoverBorderColor: PALETTE.primary[300],
      activeBorderColor: PALETTE.primary[500],
      optionSelectedBg: PALETTE.primary[50],
      optionActiveBg: PALETTE.primary[50],
    },
    Button: {
      primaryShadow: 'none',
    },
    Tabs: {
      itemSelectedColor: PALETTE.primary[600],
      inkBarColor: PALETTE.primary[500],
    },
    Pagination: {
      itemActiveBg: PALETTE.primary[50],
    },
  },
};
