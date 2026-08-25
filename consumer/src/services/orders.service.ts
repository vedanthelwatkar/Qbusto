/**
 * Wrapper around Orval-generated order endpoints and consumer-orders-service.
 * Reuses generated types for request/response shapes.
 */

import { createOrder, initPayment, verifyPayment } from '@/api/consumer-orders-service';
import { orderFingerprint, getOrCreateIdempotencyKey } from '@/utils/checkoutSession';
import type {
  PostApiConsumerOrdersBody,
  PostApiConsumerOrders201Data,
  PostApiConsumerOrdersOrderIdPaymentInit200,
  PostApiConsumerOrdersOrderIdPaymentVerify200,
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
 * The show contributes three of these: an order carries `screenId`,
 * `filmTitle` and `showTime` separately, and the picker's job is to supply all
 * three from one choice rather than asking the customer for each.
 */
export interface PlaceOrderInput {
  cinemaId: number;
  /**
   * The auditorium, from the entry context. Nullable: a lobby QR does not name
   * one, and the schedule does not supply one either.
   */
  screenId: number | null;
  filmTitle: string;
  /** ISO instant, as the API expects. */
  showTime: string;
  seatNumber: string;
  customerMobile: string;
  customerEmail: string | null;
  items: Array<{ productId: number; quantity: number }>;
  source: PostApiConsumerOrdersBody['source'];
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
    screenId: input.screenId,
    seatNumber: input.seatNumber,
    source: input.source,
    customerMobile: input.customerMobile,
    customerEmail: input.customerEmail,
    filmTitle: input.filmTitle,
    showTime: input.showTime,
    items: input.items,
  };

  const idempotencyKey = getOrCreateIdempotencyKey(orderFingerprint(orderData), newKey);

  return createOrderIdempotent(orderData, idempotencyKey);
}
