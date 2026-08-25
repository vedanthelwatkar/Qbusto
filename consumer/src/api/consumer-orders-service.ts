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
  PostApiConsumerCinemasCinemaIdCouponsValidate200,
  PostApiConsumerCinemasCinemaIdCouponsValidateBody,
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
 * Preview a coupon's discount before placing an order. Creates nothing - the
 * backend recomputes the subtotal from the same items/source an order would
 * actually be created with, so the discount matches what `createOrder` would
 * apply for an identical cart.
 * @param cinemaId Cinema the coupon is being checked against
 * @param body code + items + source
 */
export function validateCoupon(
  cinemaId: number,
  body: PostApiConsumerCinemasCinemaIdCouponsValidateBody
): AxiosPromise<PostApiConsumerCinemasCinemaIdCouponsValidate200> {
  return customInstance<PostApiConsumerCinemasCinemaIdCouponsValidate200>({
    url: `/api/consumer/cinemas/${cinemaId}/coupons/validate`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * Initialize a gateway payment session (idempotent)
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
 * Confirm the payment with the gateway (idempotent)
 * @param orderId Order ID
 * @param body Request body (empty - the backend asks the gateway directly)
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
