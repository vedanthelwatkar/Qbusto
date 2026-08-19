import axios from 'axios';
import type { AxiosRequestConfig, AxiosPromise } from 'axios';

import { TOKEN_STORAGE_KEY } from '../config';

/**
 * The mutator every generated Orval function calls.
 *
 * It attaches the bearer token. It deliberately does NOT retry, refresh or
 * redirect: a 401 is surfaced to the caller, and the auth store decides what
 * that means. An interceptor that silently signs a kitchen screen out mid-shift
 * because one poll came back 401 is worse than showing the error.
 */

/** Read at call time, not at module load - the token changes on sign-in. */
function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Private-mode browsers can throw on storage access. An unauthenticated
    // request is a better outcome than a blank screen.
    return null;
  }
}

export const customInstance = <T>(config: AxiosRequestConfig): AxiosPromise<T> => {
  const token = readToken();

  return axios({
    baseURL: import.meta.env.VITE_API_URL,
    // A kitchen display on a venue LAN should fail fast and show a stale-data
    // warning rather than hanging with a spinner until the browser gives up.
    timeout: 15_000,
    ...config,
    headers: {
      ...config.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};
