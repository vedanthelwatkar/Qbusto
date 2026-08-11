/**
 * Calls against /api/banners.
 *
 * Same shape as categories.service: the orval-generated client makes the
 * request and this file unwraps the envelope. No URL, query parameter or body
 * type is written by hand - they all come from shared/openapi.json.
 *
 * One row carries one image, so a cinema shows several banners by holding
 * several rows. `cinemaId` is absent from the update body on purpose: moving a
 * banner would sidestep the target cinema's sequence rule.
 */

import type {
  Banner,
  GetApiBannersParams,
  PostApiBannersBody,
  PutApiBannersIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getBanners } from '@/api/generated/banners/banners';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const bannersApi = getBanners();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface BannerPage {
  banners: Banner[];
  pagination: Pagination | null;
}

export async function listBanners(params: GetApiBannersParams): Promise<BannerPage> {
  const response = await bannersApi.getApiBanners(params);

  return { banners: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getBanner(id: number): Promise<Banner> {
  const { data } = await bannersApi.getApiBannersId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createBanner(body: PostApiBannersBody): Promise<Banner> {
  const { data } = await bannersApi.postApiBanners(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateBanner(id: number, body: PutApiBannersIdBody): Promise<Banner> {
  const { data } = await bannersApi.putApiBannersId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false, so its sequence stays
 * reserved and the banner can be brought back. Idempotent.
 */
export async function deactivateBanner(id: number): Promise<Banner> {
  const { data } = await bannersApi.deleteApiBannersId(id);

  if (!data) throw MALFORMED;

  return data;
}
