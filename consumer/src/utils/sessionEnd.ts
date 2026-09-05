/**
 * Where a customer goes when their session ends, and what the last button says.
 *
 * THE SCREENSAVER IS A KIOSK THING.
 *
 * A kiosk is a shared machine standing in a lobby. When its customer finishes
 * or walks away it has to go back to attract mode, so the next person sees an
 * invitation rather than the last person's receipt. That is what the
 * screensaver at `/` is for.
 *
 * A phone is not shared. Sending a QR customer to a screensaver puts an
 * attract screen on their own device, which is meaningless at best - there is
 * no "next customer" walking up to their phone - and at worst looks like the
 * app crashed and forgot what they were doing. So a phone never sees it: it
 * goes back to the menu, which is the only place it could usefully be.
 *
 * `counter` is grouped with `kiosk`: it is staff-operated shared hardware,
 * serving one customer after another, which is the property that matters here.
 * It is the same split `context.store.DEVICE_SOURCES` already draws, for the
 * same underlying reason, but it is spelled out separately because the two
 * answer different questions - that one is "does this source survive between
 * customers", this one is "is this device shared".
 */

import type { OrderSource } from '@/stores/context.store';

/** Shared hardware: the session ends by handing the device to the next person. */
const SHARED_DEVICE_SOURCES: OrderSource[] = ['kiosk', 'counter'];

export function isSharedDevice(source: OrderSource): boolean {
  return SHARED_DEVICE_SOURCES.includes(source);
}

/**
 * The route a finished or abandoned session returns to.
 *
 * `/` is the screensaver; `/catalog` is the menu. Both clear the customer's
 * data first - what differs is only what they are left looking at.
 */
export function sessionEndPath(source: OrderSource): string {
  return isSharedDevice(source) ? '/' : '/catalog';
}

/**
 * The label on the last button of the confirmation screen.
 *
 * "Done" is right for a kiosk, where the button's job is to release the machine
 * for the next customer. On a phone nothing is being released, and the useful
 * next action is the one people actually take during a film - ordering
 * something else - so the button offers that instead of dismissing the screen.
 */
export function confirmationCtaLabel(source: OrderSource): string {
  return isSharedDevice(source) ? 'Done' : 'Order again';
}
