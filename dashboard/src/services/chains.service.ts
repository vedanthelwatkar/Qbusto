/**
 * Calls against /api/chains.
 *
 * Same shape as categories.service and products.service: the orval-generated
 * client makes the request and this file unwraps the envelope. No URL, query
 * parameter or body type is written by hand - they all come from
 * shared/openapi.json.
 *
 * Authorised through the Settings module, not a module of its own: the frozen
 * CK_user_permissions_module_name constraint has no entry for chains.
 */

import { getChains } from '@/api/generated/chains/chains';
import type {
  Chain,
  GetApiChainsParams,
  PostApiChainsBody,
  PutApiChainsIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const chainsApi = getChains();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface ChainPage {
  chains: Chain[];
  pagination: Pagination | null;
}

export async function listChains(params: GetApiChainsParams): Promise<ChainPage> {
  const response = await chainsApi.getApiChains(params);

  return { chains: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getChain(id: number): Promise<Chain> {
  const { data } = await chainsApi.getApiChainsId(id);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Owners only. Every other role is pinned to their own chain by tenant scope,
 * so a chain they created would be a row they could never read back - the
 * backend answers them with a 403.
 */
export async function createChain(body: PostApiChainsBody): Promise<Chain> {
  const { data } = await chainsApi.postApiChains(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateChain(id: number, body: PutApiChainsIdBody): Promise<Chain> {
  const { data } = await chainsApi.putApiChainsId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. Cinemas, users,
 * categories and products all reference it, and none of them are cascaded.
 * Idempotent.
 */
export async function deactivateChain(id: number): Promise<Chain> {
  const { data } = await chainsApi.deleteApiChainsId(id);

  if (!data) throw MALFORMED;

  return data;
}
