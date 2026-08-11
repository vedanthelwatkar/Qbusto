/**
 * Calls against /api/product-pricing.
 *
 * Same shape as categories.service: the orval-generated client makes the
 * request and this file unwraps the envelope. No URL, query parameter or body
 * type is written by hand - they all come from shared/openapi.json.
 *
 * Note what the update body is missing: `cinemaId`, `productId` and `dayOfWeek`.
 * Together they are the natural key (UQ_product_pricing), so changing one names
 * a different row rather than editing this one, and the spec leaves them off
 * the PUT accordingly.
 */

import type {
  GetApiProductPricingParams,
  PostApiProductPricingBody,
  ProductPricing,
  PutApiProductPricingIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getProductPricing } from '@/api/generated/product-pricing/product-pricing';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const pricingApi = getProductPricing();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface PricingPage {
  pricings: ProductPricing[];
  pagination: Pagination | null;
}

export async function listPricings(params: GetApiProductPricingParams): Promise<PricingPage> {
  const response = await pricingApi.getApiProductPricing(params);

  return { pricings: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getPricing(id: number): Promise<ProductPricing> {
  const { data } = await pricingApi.getApiProductPricingId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createPricing(body: PostApiProductPricingBody): Promise<ProductPricing> {
  const { data } = await pricingApi.postApiProductPricing(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updatePricing(
  id: number,
  body: PutApiProductPricingIdBody
): Promise<ProductPricing> {
  const { data } = await pricingApi.putApiProductPricingId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. It is never removed -
 * historical orders are priced from it. Idempotent.
 */
export async function deactivatePricing(id: number): Promise<ProductPricing> {
  const { data } = await pricingApi.deleteApiProductPricingId(id);

  if (!data) throw MALFORMED;

  return data;
}
