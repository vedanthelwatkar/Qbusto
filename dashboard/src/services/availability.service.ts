/**
 * Calls against /api/product-availability-hours.
 *
 * Same shape as pricing.service: the orval-generated client makes the request
 * and this file unwraps the envelope.
 *
 * A window belongs to a cinema_product, so `cinemaProductId` is absent from the
 * update body - a window cannot be moved to another cinema after it is created.
 * Both times are required on the update even though it edits one row: half a
 * range has no meaning, and the backend validates them against each other.
 *
 * Deletion is a hard delete. product_availability_hours has no `is_active`
 * column, so unlike every other module in the dashboard the row is removed
 * outright and does not come back deactivated.
 */

import type {
  GetApiProductAvailabilityHoursParams,
  PostApiProductAvailabilityHoursBody,
  ProductAvailabilityHour,
  PutApiProductAvailabilityHoursIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getProductAvailabilityHours } from '@/api/generated/product-availability-hours/product-availability-hours';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const availabilityApi = getProductAvailabilityHours();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface AvailabilityPage {
  availabilityHours: ProductAvailabilityHour[];
  pagination: Pagination | null;
}

export async function listAvailabilityHours(
  params: GetApiProductAvailabilityHoursParams
): Promise<AvailabilityPage> {
  const response = await availabilityApi.getApiProductAvailabilityHours(params);

  return {
    availabilityHours: response.data ?? [],
    pagination: response.meta?.pagination ?? null,
  };
}

export async function getAvailabilityHour(id: number): Promise<ProductAvailabilityHour> {
  const { data } = await availabilityApi.getApiProductAvailabilityHoursId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createAvailabilityHour(
  body: PostApiProductAvailabilityHoursBody
): Promise<ProductAvailabilityHour> {
  const { data } = await availabilityApi.postApiProductAvailabilityHours(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateAvailabilityHour(
  id: number,
  body: PutApiProductAvailabilityHoursIdBody
): Promise<ProductAvailabilityHour> {
  const { data } = await availabilityApi.putApiProductAvailabilityHoursId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/** Hard delete: the row is removed. There is no `is_active` to unset. */
export async function deleteAvailabilityHour(id: number): Promise<ProductAvailabilityHour> {
  const { data } = await availabilityApi.deleteApiProductAvailabilityHoursId(id);

  if (!data) throw MALFORMED;

  return data;
}
