/**
 * Wrapper around Orval-generated order endpoints and consumer-orders-service.
 * Reuses generated types for request/response shapes.
 */

import { createOrder, initPayment, verifyPayment } from '@/api/consumer-orders-service';
import type {
  PostApiConsumerOrdersBody,
  PostApiConsumerOrders201Data,
  PostApiConsumerOrdersOrderIdPaymentInit200,
  PostApiConsumerOrdersOrderIdPaymentVerifyBody,
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
 * Initialize payment (Phase 2: Create Razorpay order, idempotent).
 *
 * @param orderId - Local order ID from creation
 * @returns Payment init response with razorpayOrderId, razorpayKeyId, amount (paise)
 */
export async function initializePayment(
  orderId: number
): Promise<PostApiConsumerOrdersOrderIdPaymentInit200> {
  const response = await initPayment(orderId, {});
  return response.data;
}

/**
 * Verify payment (Phase 3: Verify Razorpay signature, idempotent, marks order paid).
 *
 * @param orderId - Local order ID
 * @param paymentData - Razorpay payment ID and signature
 * @returns Updated order with paymentStatus: paid
 */
export async function verifyOrderPayment(
  orderId: number,
  paymentData: PostApiConsumerOrdersOrderIdPaymentVerifyBody
): Promise<PostApiConsumerOrdersOrderIdPaymentVerify200> {
  const response = await verifyPayment(orderId, paymentData);
  return response.data;
}
