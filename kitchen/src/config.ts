/**
 * Operational tuning for the kitchen display.
 *
 * Every number a screen's behaviour depends on lives here rather than being
 * spelled out at the point of use. A cinema that finds popcorn goes amber too
 * early changes one line, not six components.
 */

/**
 * How often the board re-reads the server.
 *
 * The KDS has no push channel - the backend has no WebSocket or SSE
 * infrastructure, and adding one for a screen that needs second-level, not
 * millisecond-level, freshness would be a large piece of infrastructure for a
 * small gain. Polling is the honest choice here.
 *
 * Ten seconds is chosen against the human process rather than against the
 * network: a cook glances up, and an order that appeared eight seconds ago is
 * indistinguishable from one that appeared instantly. A poll is one indexed
 * query returning at most a page of orders, so at one display per cinema this
 * is negligible load.
 *
 * Polls never overlap - see useKitchenBoard, which will not start a request
 * while one is in flight.
 */
export const POLL_INTERVAL_MS = 10_000;

/**
 * How often the elapsed-time clocks re-render.
 *
 * Separate from the poll on purpose: the times on screen keep counting up
 * between polls, so the board never looks frozen. This only recomputes
 * durations from timestamps already held in memory - it makes no requests.
 */
export const CLOCK_TICK_MS = 1_000;

/**
 * When an order stops being routine.
 *
 * WARNING at 10 minutes, LATE at 15. These are the thresholds the reference
 * board calls "delayed", split into two so a screen can escalate rather than
 * flipping straight from normal to alarming.
 *
 * Measured from when the order was placed, not from when the kitchen started
 * it: the customer has been waiting since they paid, and an order that sat
 * unnoticed for twelve minutes is late regardless of when someone pressed
 * PREPARE.
 */
export const DELAY_WARNING_MS = 10 * 60 * 1000;
export const DELAY_LATE_MS = 15 * 60 * 1000;

/**
 * How long a delivered order stays on the completed lane.
 *
 * Long enough to answer "did that go out?", short enough that the lane does
 * not become a day's history. The server still holds everything; this is only
 * what the screen shows.
 */
export const COMPLETED_WINDOW_MS = 60 * 60 * 1000;

/**
 * Page size for a board request.
 *
 * The API caps `limit` at 100. A kitchen with more than 100 simultaneously
 * outstanding orders has a bigger problem than pagination, but the board still
 * reports honestly when there are more than it is showing rather than
 * pretending the page is the whole queue.
 */
export const BOARD_PAGE_SIZE = 100;

/** Where the JWT is kept. sessionStorage, so closing the browser signs out. */
export const TOKEN_STORAGE_KEY = 'qbusto.kitchen.token';
