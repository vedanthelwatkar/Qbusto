/**
 * The selector CheckoutDrawer has always used to find what can hold focus.
 *
 * Lifted out of that component so a second dialog does not have to restate it
 * and quietly drift - two different definitions of "focusable" is exactly how
 * a trap starts leaking.
 */
export const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside `panel`, wrapping at both ends.
 *
 * Returns true when the event was handled, so a caller can decide what else a
 * keydown means. Mirrors the behaviour CheckoutDrawer implements inline,
 * including pulling focus back when the focused node has been unmounted.
 */
export function trapTab(event: KeyboardEvent, panel: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;

  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return false;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !panel.contains(active);

  if (outside) {
    event.preventDefault();
    first.focus();
    return true;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }

  return false;
}
