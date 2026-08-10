/**
 * Authentication state.
 *
 * `status` drives routing, so it distinguishes "we have not checked yet" from
 * "we checked and there is no session". Without that split, a reload would
 * bounce an authenticated user to the login page for the moment before /me
 * comes back.
 *
 * The user object - including their permissions - is whatever /api/auth/me
 * returned. It is never edited locally: a permission change takes effect when
 * the profile is reloaded, and the backend re-checks every request anyway.
 */

import { create } from 'zustand';

import { setUnauthorizedHandler } from '@/services/api';
import * as authService from '@/services/auth.service';
import type { LoginCredentials, User } from '@/types/auth';
import { clearStoredToken, getStoredToken, storeToken } from '@/utils/token';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: User | null;

  /** Restore a session from a stored token. Safe to call more than once. */
  bootstrap: () => Promise<void>;
  signIn: (credentials: LoginCredentials) => Promise<void>;
  signOut: () => Promise<void>;
  /** Forget the session locally, without calling the server. */
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,

  bootstrap: async () => {
    if (get().status === 'loading') return;

    if (!getStoredToken()) {
      set({ status: 'unauthenticated', user: null });
      return;
    }

    set({ status: 'loading' });

    try {
      const user = await authService.fetchCurrentUser();
      set({ status: 'authenticated', user });
    } catch {
      // Expired or invalid token, or a deactivated account. Either way there is
      // no session to restore, and the error surfaces on the login page instead
      // of blocking the app behind a dead spinner.
      clearStoredToken();
      set({ status: 'unauthenticated', user: null });
    }
  },

  signIn: async (credentials) => {
    const { token } = await authService.login(credentials);

    storeToken(token);

    try {
      // Login returns a user too, but /me is the endpoint that guarantees
      // permissions are loaded, and it proves the token we just stored works.
      const user = await authService.fetchCurrentUser();
      set({ status: 'authenticated', user });
    } catch (error) {
      clearStoredToken();
      set({ status: 'unauthenticated', user: null });
      throw error;
    }
  },

  signOut: async () => {
    try {
      await authService.logout();
    } catch {
      // The session is stateless, so a failed call changes nothing about
      // whether we can forget the token. Sign out locally either way.
    }

    clearStoredToken();
    set({ status: 'unauthenticated', user: null });
  },

  reset: () => {
    clearStoredToken();
    set({ status: 'unauthenticated', user: null });
  },
}));

// A 401 from any request means the stored token is no longer usable. Clearing
// state here is enough to redirect: the protected routes read `status`.
setUnauthorizedHandler(() => {
  if (useAuthStore.getState().status !== 'unauthenticated') {
    useAuthStore.getState().reset();
  }
});
