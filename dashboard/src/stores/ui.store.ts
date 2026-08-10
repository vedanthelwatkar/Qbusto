/**
 * Layout state that outlives a single component.
 *
 * Only the navigation open/collapsed state lives here, because the header
 * toggles it and the sidebar renders it. Anything a single component can own
 * should stay in that component.
 */

import { create } from 'zustand';

interface UiState {
  /** Desktop: the sidebar is collapsed to an icon rail. */
  siderCollapsed: boolean;
  /** Mobile: the navigation drawer is open. */
  navDrawerOpen: boolean;

  toggleSider: () => void;
  setNavDrawerOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  siderCollapsed: false,
  navDrawerOpen: false,

  toggleSider: () => set((state) => ({ siderCollapsed: !state.siderCollapsed })),
  setNavDrawerOpen: (navDrawerOpen) => set({ navDrawerOpen }),
}));
