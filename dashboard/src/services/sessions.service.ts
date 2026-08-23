/**
 * Calls against /api/sessions.
 *
 * Read-only. The schedule lives in the client's `session` table and is synced
 * from their source system, so there is nothing to create or edit here.
 *
 * A session is addressed by the source system's numeric session id, which is
 * unique within a cinema. Tenant scope is applied by the backend through the
 * session's cinema.
 */

import type { GetApiSessionsParams, Session } from '@/api/generated/cinemaOrderingAPI.schemas';
import { getSessions } from '@/api/generated/sessions/sessions';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const sessionsApi = getSessions();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface SessionPage {
  sessions: Session[];
  pagination: Pagination | null;
}

export async function listSessions(params: GetApiSessionsParams): Promise<SessionPage> {
  const response = await sessionsApi.getApiSessions(params);

  return { sessions: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getSession(id: number): Promise<Session> {
  const { data } = await sessionsApi.getApiSessionsId(id);

  if (!data) throw MALFORMED;

  return data;
}
