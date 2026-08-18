import { useEffect } from 'react';

import { POLL_INTERVAL_MS } from '../config';
import { useBoardStore } from '../stores/board.store';

/**
 * Keeps the board fresh.
 *
 * WHY POLLING
 *
 * The backend has no WebSocket or SSE infrastructure, and this is the only
 * screen that would need it. A push channel means a connection lifecycle,
 * reconnect/backoff, auth on the socket, and a second delivery path for state
 * that must agree with the REST one - a lot of moving parts for a screen whose
 * requirement is "a new order shows up within a few seconds". Polling one
 * indexed endpoint meets that, and it converges automatically after a network
 * drop with no reconnect logic at all.
 *
 * Overlap is prevented in the store, not here: `load()` returns immediately if
 * a request is already in flight. So a slow response cannot cause a pile-up
 * even though the interval keeps firing.
 *
 * A hidden tab is skipped. A kitchen display is usually the only thing on
 * screen, but a manager who leaves the KDS open in a background tab should not
 * generate a request every ten seconds all day. Coming back to the tab
 * refreshes immediately rather than waiting for the next tick.
 */
export function usePolling(enabled: boolean) {
  const load = useBoardStore((state) => state.load);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return;
      void load();
    };

    // Load once immediately so the board is not blank for a whole interval.
    tick();

    const id = window.setInterval(tick, POLL_INTERVAL_MS);

    // Returning to the tab should show current data at once, not data that is
    // up to one interval stale.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, load]);
}
