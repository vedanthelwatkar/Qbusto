/**
 * antd theme tokens.
 *
 * Kept small on purpose - only what makes the shell feel like one product.
 * Component-level styling belongs in the component, not here.
 */

import type { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1668dc',
    borderRadius: 6,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 56,
      headerPadding: '0 16px',
      bodyBg: '#f5f6f8',
    },
    Menu: {
      itemMarginInline: 8,
    },
  },
};
