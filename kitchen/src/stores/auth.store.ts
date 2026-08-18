import { create } from 'zustand';

import { getAuth } from '../api/generated/auth/auth';
import type { User } from '../api/generated/cinemaOrderingAPI.schemas';
import { TOKEN_STORAGE_KEY } from '../config';
import { formatApiError } from '../utils/apiError';

/**
 * Kitchen authentication.
 *
 * The KDS is a staff application: it signs in with a real account and carries
 * that account's permissions. There is no kitchen-specific credential and no
 * shared key - the backend authorises every request against the Orders module,
 * and this store holds nothing the backend would trust on its own.
 *
 * The token lives in sessionStorage rather than localStorage. A kitchen display
 * is a shared terminal; closing the browser should end the session rather than
 * leave a signed-in screen for whoever opens it next.
 */

const authApi = getAuth();

interface AuthState {
  token: string | null;
  user: User | null;
  /** True while a sign-in request is in flight. */
  signingIn: boolean;
  /** True during the initial "is the stored token still good?" check. */
  restoring: boolean;
  error: string | null;

  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => void;
  restore: () => Promise<void>;
  clearError: () => void;
}

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable. The session still works for as long as this tab
    // lives; it simply will not survive a reload.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: readStoredToken(),
  user: null,
  signingIn: false,
  // Starts true when a token exists: the app must not flash the board before
  // the token has been shown to be valid.
  restoring: Boolean(readStoredToken()),
  error: null,

  clearError: () => set({ error: null }),

  signIn: async (username, password) => {
    set({ signingIn: true, error: null });

    try {
      const response = await authApi.postApiAuthLogin({ username, password });
      const result = response.data.data;

      if (!result?.token) {
        set({ signingIn: false, error: 'The server did not return a session.' });
        return false;
      }

      // Written before the state update so the very next request - including
      // any the board fires on mount - already carries the token.
      writeStoredToken(result.token);
      set({
        token: result.token,
        user: result.user ?? null,
        signingIn: false,
        error: null,
      });
      return true;
    } catch (error) {
      set({ signingIn: false, error: formatApiError(error) });
      return false;
    }
  },

  signOut: () => {
    writeStoredToken(null);
    set({ token: null, user: null, error: null, restoring: false });
  },

  /**
   * Validate a token left over from a previous page load.
   *
   * A kitchen display gets reloaded, power-cycled and reopened constantly, and
   * it must come back to the board rather than to a login form. Any failure
   * here clears the token: an expired session must not leave the app in a
   * state where every poll 401s.
   */
  restore: async () => {
    if (!readStoredToken()) {
      set({ restoring: false });
      return;
    }

    try {
      const response = await authApi.getApiAuthMe();
      set({ user: response.data.data ?? null, restoring: false });
    } catch {
      writeStoredToken(null);
      set({ token: null, user: null, restoring: false });
    }
  },
}));
