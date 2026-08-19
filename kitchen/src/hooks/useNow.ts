import { useEffect, useState } from 'react';

import { CLOCK_TICK_MS } from '../config';

/**
 * A ticking "now", so elapsed times keep counting between polls.
 *
 * One timer for the whole board rather than one per card: with forty orders on
 * screen, forty independent intervals is forty times the work for exactly the
 * same output, and they drift out of step with each other so the seconds on
 * different cards change at different moments.
 *
 * This makes no network requests. It only re-derives durations from timestamps
 * already in memory, which is what keeps the board from looking frozen while
 * the poll interval elapses.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);

    // Cleared on unmount: a timer left running against an unmounted tree keeps
    // setting state forever.
    return () => window.clearInterval(id);
  }, []);

  return now;
}
