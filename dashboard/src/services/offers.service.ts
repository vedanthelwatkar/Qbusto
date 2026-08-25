/**
 * Calls against /api/offers.
 *
 * Same shape as categories.service: the orval-generated client makes the
 * request and this file unwraps the envelope. No URL, query parameter or body
 * type is written by hand - they all come from shared/openapi.json.
 *
 * These are QBusto-side coupons only. Cashfree has no visibility into offers
 * at all - a coupon's discount is computed and subtracted from an order here,
 * before payment-init is ever called, so the gateway only ever sees the final
 * amount.
 */

import type {
  Offer,
  GetApiOffersParams,
  PostApiOffersBody,
  PutApiOffersIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getOffers } from '@/api/generated/offers/offers';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const offersApi = getOffers();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface OfferPage {
  offers: Offer[];
  pagination: Pagination | null;
}

export async function listOffers(params: GetApiOffersParams): Promise<OfferPage> {
  const response = await offersApi.getApiOffers(params);

  return { offers: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getOffer(id: number): Promise<Offer> {
  const { data } = await offersApi.getApiOffersId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createOffer(body: PostApiOffersBody): Promise<Offer> {
  const { data } = await offersApi.postApiOffers(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateOffer(id: number, body: PutApiOffersIdBody): Promise<Offer> {
  const { data } = await offersApi.putApiOffersId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Genuine delete, not soft - the backend refuses with a 409 if the coupon has
 * ever been redeemed, so this only ever succeeds for a coupon nothing used.
 */
export async function deleteOffer(id: number): Promise<Offer> {
  const { data } = await offersApi.deleteApiOffersId(id);

  if (!data) throw MALFORMED;

  return data;
}
