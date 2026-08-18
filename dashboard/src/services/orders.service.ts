/**
 * Orders API communication layer.
 *
 * Wraps generated Orval client, unwraps envelopes following the
 * pattern established by pricing.service and users.service.
 * No URL, query param type, body type or response type is written by hand.
 */

import type {
  GetApiOrdersParams,
  Order,
  OrderDetail,
  OrderStatus,
  PutApiOrdersIdStatusBody,
  PutApiOrdersIdPaymentStatusBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getOrders } from '@/api/generated/orders/orders';
import { getOrderStatuses as getOrderStatusesApi } from '@/api/generated/order-statuses/order-statuses';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const ordersApi = getOrders();
const orderStatusesApi = getOrderStatusesApi();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface OrdersPage {
  orders: Order[];
  pagination: Pagination | null;
}

export async function listOrders(params: GetApiOrdersParams): Promise<OrdersPage> {
  const response = await ordersApi.getApiOrders(params);
  return {
    orders: response.data ?? [],
    pagination: response.meta?.pagination ?? null,
  };
}

export async function getOrder(id: number): Promise<OrderDetail> {
  const { data } = await ordersApi.getApiOrdersId(id);
  if (!data) throw MALFORMED;
  return data;
}

/**
 * Move an order to a new fulfilment status.
 *
 * `status` is the generated union rather than a bare string, so a status the
 * API does not accept is a compile error here instead of a 400 at runtime.
 * The endpoint returns the order as it now stands; callers should render that
 * rather than assuming the transition produced the status they asked for.
 *
 * @param reason Free text stored on the audit log entry. Optional.
 */
export async function updateOrderStatus(
  id: number,
  status: PutApiOrdersIdStatusBody['status'],
  reason?: string
): Promise<OrderDetail> {
  const { data } = await ordersApi.putApiOrdersIdStatus(id, {
    status,
    ...(reason ? { reason } : {}),
  });
  if (!data) throw MALFORMED;
  return data;
}

/**
 * Move an order's payment to a new status.
 *
 * This is the staff-operated path only — cash taken at the counter, a refund
 * granted, a failed attempt written off. It carries no gateway identifiers and
 * performs no Razorpay verification; the backend owns that entirely.
 *
 * @param reason Free text stored on the audit log entry. Optional.
 */
export async function updatePaymentStatus(
  id: number,
  paymentStatus: PutApiOrdersIdPaymentStatusBody['paymentStatus'],
  reason?: string
): Promise<OrderDetail> {
  const { data } = await ordersApi.putApiOrdersIdPaymentStatus(id, {
    paymentStatus,
    ...(reason ? { reason } : {}),
  });
  if (!data) throw MALFORMED;
  return data;
}

export async function getOrderStatuses(): Promise<OrderStatus[]> {
  const { data } = await orderStatusesApi.getApiOrderStatuses();
  return data ?? [];
}

export async function getPaymentStatuses(): Promise<OrderStatus[]> {
  const { data } = await orderStatusesApi.getApiPaymentStatuses();
  return data ?? [];
}
