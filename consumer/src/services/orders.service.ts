/**
 * Wrapper around Orval-generated order endpoints and consumer-orders-service.
 * Reuses generated types for request/response shapes.
 */

import {
  createOrder,
  initPayment,
  verifyPayment,
  validateCoupon,
} from '@/api/consumer-orders-service';
import { orderFingerprint, getOrCreateIdempotencyKey } from '@/utils/checkoutSession';
import type {
  PostApiConsumerOrdersBody,
  PostApiConsumerOrders201Data,
  PostApiConsumerOrdersOrderIdPaymentInit200,
  PostApiConsumerOrdersOrderIdPaymentVerify200,
  PostApiConsumerCinemasCinemaIdCouponsValidate200Data,
} from '@/api/generated/cinemaOrderingAPI.schemas';

/**
 * Create an order (Phase 1: Local order creation, idempotent via Idempotency-Key).
 * Caller must provide idempotency key (typically generated at checkout start).
 *
 * @param orderData - Order creation request (cinema, products, customer info)
 * @param idempotencyKey - UUID v4 for idempotency
 * @returns Order response with orderId, items, totals (final from backend)
 */
export async function createOrderIdempotent(
  orderData: PostApiConsumerOrdersBody,
  idempotencyKey: string
): Promise<PostApiConsumerOrders201Data | undefined> {
  const response = await createOrder(orderData, idempotencyKey);
  // The envelope's `data` is optional in the contract, so it is returned as
  // possibly-undefined rather than cast away: a 2xx with no body would
  // otherwise surface as an order object with no orderId.
  return response.data.data;
}

/**
 * Preview a coupon code's discount against the current cart, before an order
 * exists. The backend recomputes the subtotal itself from `items`/`source`
 * against live pricing - never trusted from here - so the discount returned
 * is guaranteed to match what `placeOrder` would actually apply if the same
 * code is included when the order is created a moment later.
 */
export async function previewCoupon(
  cinemaId: number,
  code: string,
  items: Array<{ productId: number; quantity: number }>,
  source: PostApiConsumerOrdersBody['source'],
  /**
   * Evidence for a `seat_qr` source, the same field the order carries. The
   * preview derives its source exactly as order creation does, so omitting a
   * seat here quotes the lobby rate - which is what the order would charge.
   */
  seatNumber?: string | null
): Promise<PostApiConsumerCinemasCinemaIdCouponsValidate200Data> {
  const response = await validateCoupon(cinemaId, {
    code,
    items,
    source,
    seatNumber: seatNumber || undefined,
  });
  // The envelope's `data` is optional in the contract; a 2xx with no body is
  // treated the same as "not valid" rather than throwing on a shape the type
  // already says is possible.
  return (
    response.data.data ?? {
      valid: false,
      message: 'Could not check this coupon right now',
      discount: null,
      subtotal: 0,
    }
  );
}

/**
 * Initialize payment (creates or resumes the gateway order, idempotent).
 *
 * @param orderId - Local order ID from creation
 * @returns Payment init response with gatewayOrderId, paymentSessionId, amount (paise)
 */
export async function initializePayment(
  orderId: number
): Promise<PostApiConsumerOrdersOrderIdPaymentInit200> {
  const response = await initPayment(orderId, {});
  return response.data;
}

/**
 * Confirm payment with the gateway (idempotent; marks the order paid).
 *
 * Sends no payment identity. Cashfree's hosted checkout hands the browser no
 * cryptographic credential, so there is nothing a client could present that
 * would prove a payment happened - the backend asks Cashfree directly. The
 * request means only "my checkout finished, please look".
 *
 * @param orderId - Local order ID
 * @returns Updated order with paymentStatus: paid
 */
export async function verifyOrderPayment(
  orderId: number
): Promise<PostApiConsumerOrdersOrderIdPaymentVerify200> {
  const response = await verifyPayment(orderId, {});
  return response.data;
}

/**
 * Everything checkout needs to place one order.
 *
 * The show contributes most of these: an order carries `screenName`,
 * `filmTitle` and `showTime` separately, and the picker's job is to supply all
 * three from one choice rather than asking the customer for each. The
 * auditorium itself is never sent as an id - only `screenName` plus the
 * `seatRow` the customer entered, which the backend resolves to the real
 * `screens.id` itself (see consumer.service.resolveScreenId on the backend).
 */
export interface PlaceOrderInput {
  cinemaId: number;
  /** The session's own screen name. Null when no show was selected. */
  screenName: string | null;
  /**
   * The row the customer entered or picked, uppercased. Required only when
   * the selected session's `seatRows` was non-empty; ignored otherwise.
   */
  seatRow: string | null;
  filmTitle: string;
  /** ISO instant, as the API expects. */
  showTime: string;
  seatNumber: string;
  customerMobile: string;
  customerEmail: string | null;
  items: Array<{ productId: number; quantity: number }>;
  source: PostApiConsumerOrdersBody['source'];
  /**
   * Re-validated and applied server-side at order creation - this is not
   * trusted as already-correct just because `previewCoupon` accepted it a
   * moment earlier (the cart could have changed since, or the coupon could
   * have expired in between).
   */
  couponCode?: string | null;
}

/**
 * Build the order payload, derive its idempotency key and create it.
 *
 * Kept here rather than in the drawer so that placing an order is one
 * implementation with one idempotency rule, and the drawer is left owning
 * presentation. The key is derived from the payload actually being sent, so
 * resubmitting the same order reuses it and the backend replays the original
 * instead of creating a second one - while any correction to the cart or the
 * details is a different fingerprint and is therefore a genuinely new attempt.
 */
export async function placeOrder(
  input: PlaceOrderInput,
  newKey: () => string
): Promise<PostApiConsumerOrders201Data | undefined> {
  const orderData: PostApiConsumerOrdersBody = {
    cinemaId: input.cinemaId,
    screenName: input.screenName,
    seatRow: input.seatRow,
    seatNumber: input.seatNumber,
    source: input.source,
    customerMobile: input.customerMobile,
    customerEmail: input.customerEmail,
    filmTitle: input.filmTitle,
    showTime: input.showTime,
    items: input.items,
    couponCode: input.couponCode || null,
  };

  const idempotencyKey = getOrCreateIdempotencyKey(orderFingerprint(orderData), newKey);

  return createOrderIdempotent(orderData, idempotencyKey);
}
