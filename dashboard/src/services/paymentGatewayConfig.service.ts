/**
 * Calls against /api/payment-gateway-config - one cinema's Cashfree
 * credentials.
 *
 * `secretKey` is write-only end to end: accepted by `setCredentials`, never
 * present on anything this file returns. `getActiveConfig` returns null for
 * "no active config" (the backend answers 404 for that case) rather than
 * throwing, so a cinema that has not been set up yet is a normal state for a
 * caller to render, not an error to catch.
 */

import type {
  DeleteApiPaymentGatewayConfigParams,
  GetApiPaymentGatewayConfigParams,
  PaymentGatewayConfig,
  PutApiPaymentGatewayConfigBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getSettings } from '@/api/generated/settings/settings';
import { toApiError } from '@/services/api';
import { ERROR_CODES, type ApiError } from '@/types/api';

const settingsApi = getSettings();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export async function getActiveConfig(
  params: GetApiPaymentGatewayConfigParams
): Promise<PaymentGatewayConfig | null> {
  try {
    const { data } = await settingsApi.getApiPaymentGatewayConfig(params);
    return data ?? null;
  } catch (caught) {
    if (toApiError(caught).status === 404) return null;
    throw caught;
  }
}

export async function setCredentials(
  body: PutApiPaymentGatewayConfigBody
): Promise<PaymentGatewayConfig> {
  const { data } = await settingsApi.putApiPaymentGatewayConfig(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function deactivateConfig(
  params: DeleteApiPaymentGatewayConfigParams
): Promise<PaymentGatewayConfig> {
  const { data } = await settingsApi.deleteApiPaymentGatewayConfig(params);

  if (!data) throw MALFORMED;

  return data;
}
