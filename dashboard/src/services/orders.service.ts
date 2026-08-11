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
  PutApiOrdersIdStatusBodyStatus,
  PutApiOrdersIdPaymentStatusBodyPaymentStatus,
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

export async function updateOrderStatus(
  id: number,
  status: PutApiOrdersIdStatusBodyStatus,
): Promise<Order> {
  const { data } = await ordersApi.putApiOrdersIdStatus(id, { status });
  if (!data) throw MALFORMED;
  return data;
}

export async function updatePaymentStatus(
  id: number,
  paymentStatus: PutApiOrdersIdPaymentStatusBodyPaymentStatus,
): Promise<Order> {
  const { data } = await ordersApi.putApiOrdersIdPaymentStatus(id, { paymentStatus });
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
