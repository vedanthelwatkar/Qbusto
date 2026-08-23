/**
 * Requests fullscreen on the first user interaction, for kiosk deployments
 * that must not show the browser chrome (address bar, tabs).
 *
 * Browsers refuse `requestFullscreen()` unless it is called synchronously
 * inside a genuine user gesture - a page cannot silently put itself into
 * fullscreen the instant it loads, with no tap or click at all. That is a
 * deliberate browser security rule (Chrome, Firefox and Safari all enforce
 * it) and cannot be worked around from the page itself.
 *
 * In this app the very first thing anyone does - on a kiosk or on a phone
 * that scanned a QR code - is tap the screensaver's "Start your order"
 * button, or land on it and touch the screen. That tap is the gesture this
 * hooks onto, so in practice fullscreen engages as soon as the kiosk is
 * touched, with no separate "enable fullscreen" step for staff to remember.
 *
 * A one-shot listener on the whole document rather than on one button: it
 * covers every entry path (QR scan, kiosk idle screen, a future page that
 * changes what the first tap lands on) without hard-coding one element.
 *
 * No-op, silently, where the Fullscreen API is unavailable (notably iOS
 * Safari, which does not support fullscreen for arbitrary elements) or where
 * the document is already fullscreen (kiosk launched with a `--kiosk` browser
 * flag already covers that case at the OS level).
 */
export function armKioskFullscreen(): () => void {
  const canFullscreen =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function';

  if (!canFullscreen) return () => {};

  const events: Array<keyof DocumentEventMap> = ['pointerdown', 'touchstart', 'keydown'];

  const requestOnce = () => {
    events.forEach((event) => document.removeEventListener(event, requestOnce));

    if (document.fullscreenElement) return;

    // Rejected silently if the browser decides this call does not count as
    // part of the gesture (e.g. it landed after a debounce). There is
    // nothing useful to do about that beyond letting the next gesture retry
    // - which does not happen here, since this only ever arms once. A kiosk
    // that needs a guarantee should launch Chrome with --kiosk instead.
    document.documentElement.requestFullscreen().catch(() => {});
  };

  events.forEach((event) => document.addEventListener(event, requestOnce, { passive: true }));

  return () => {
    events.forEach((event) => document.removeEventListener(event, requestOnce));
  };
}
