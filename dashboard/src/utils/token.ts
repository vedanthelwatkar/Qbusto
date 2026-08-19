/**
 * Access token storage.
 *
 * localStorage, because the backend hands the JWT back in the login response
 * body rather than setting a cookie (see backend/src/controllers/auth.controller.js),
 * so the browser has nowhere else to put it that survives a reload. The
 * trade-off is that any script running on this origin can read it; the backend
 * bounds the exposure with a short token lifetime and no refresh token, and
 * there is no server-side blacklist to fall back on.
 *
 * Reads and writes are guarded because a browser in private mode with storage
 * disabled throws rather than returning null.
 */

const TOKEN_KEY = 'qbusto.dashboard.token';

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable. The session still works until the tab is reloaded.
  }
}

export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do: there was nothing readable to clear.
  }
}
