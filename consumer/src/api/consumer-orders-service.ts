/**
 * Consumer Orders Service - wraps generated Orval client to handle Idempotency-Key
 */

import type { AxiosPromise } from 'axios';
import type {
  PostApiConsumerOrders201,
  PostApiConsumerOrdersBody,
  PostApiConsumerOrdersOrderIdPaymentInit200,
  PostApiConsumerOrdersOrderIdPaymentInitBody,
  PostApiConsumerOrdersOrderIdPaymentVerify200,
  PostApiConsumerOrdersOrderIdPaymentVerifyBody,
} from './generated/cinemaOrderingAPI.schemas';
import { customInstance } from './axios-instance';

/**
 * Create order with idempotency support
 * @param body Order creation request
 * @param idempotencyKey UUID v4 for idempotency (required)
 */
export function createOrder(
  body: PostApiConsumerOrdersBody,
  idempotencyKey: string
): AxiosPromise<PostApiConsumerOrders201> {
  return customInstance<PostApiConsumerOrders201>({
    url: '/api/consumer/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    data: body,
  });
}

/**
 * Initialize Razorpay payment (idempotent)
 * @param orderId Order ID from order creation
 * @param body Request body (empty)
 */
export function initPayment(
  orderId: number,
  body: PostApiConsumerOrdersOrderIdPaymentInitBody
): AxiosPromise<PostApiConsumerOrdersOrderIdPaymentInit200> {
  return customInstance<PostApiConsumerOrdersOrderIdPaymentInit200>({
    url: `/api/consumer/orders/${orderId}/payment-init`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * Verify payment signature (idempotent)
 * @param orderId Order ID
 * @param body Razorpay payment details
 */
export function verifyPayment(
  orderId: number,
  body: PostApiConsumerOrdersOrderIdPaymentVerifyBody
): AxiosPromise<PostApiConsumerOrdersOrderIdPaymentVerify200> {
  return customInstance<PostApiConsumerOrdersOrderIdPaymentVerify200>({
    url: `/api/consumer/orders/${orderId}/payment-verify`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}
