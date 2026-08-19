import { getKitchen } from '../api/generated/kitchen/kitchen';
import type {
  GetApiKitchenOrdersParams,
  PatchApiKitchenOrdersIdStatusBody,
} from '../api/generated/cinemaOrderingAPI.schemas';
import { toBoardOrder } from '../types/kitchen';
import type { BoardOrder, FulfilmentStatus } from '../types/kitchen';
import { BOARD_PAGE_SIZE } from '../config';

/**
 * The kitchen data layer.
 *
 * Every call goes through the generated Orval client - no hand-written URLs,
 * no hand-written request or response types. This file's only job is to unwrap
 * the response envelope and narrow the generated optional-everything schema
 * into the BoardOrder the UI renders.
 */

const kitchenApi = getKitchen();

export interface BoardPage {
  orders: BoardOrder[];
  /** Total matching orders on the server, which may exceed what we fetched. */
  total: number;
}

export interface BoardQuery {
  scope: 'active' | 'completed';
  status?: FulfilmentStatus;
  search?: string;
  sort?: 'placedAt' | 'showTime';
  order?: 'asc' | 'desc';
}

/**
 * Fetch one lane of the board.
 *
 * Filtering, searching and sorting are all server-side parameters - nothing
 * here pulls a large page and filters it in the browser. The eligibility rule
 * (paid, kitchen-owned status) is applied by the server regardless of what is
 * passed, so there is no client-side guard to forget.
 */
export async function fetchBoard(query: BoardQuery): Promise<BoardPage> {
  const params: GetApiKitchenOrdersParams = {
    scope: query.scope,
    limit: BOARD_PAGE_SIZE,
    page: 1,
    sort: query.sort ?? 'placedAt',
    order: query.order ?? (query.scope === 'completed' ? 'desc' : 'asc'),
    ...(query.status ? { status: query.status } : {}),
    // An empty search box must not become `search=`, which the validator would
    // reject; omit the parameter entirely instead.
    ...(query.search?.trim() ? { search: query.search.trim() } : {}),
  };

  const response = await kitchenApi.getApiKitchenOrders(params);
  const body = response.data;

  const orders = (body.data ?? [])
    .map(toBoardOrder)
    .filter((order): order is BoardOrder => order !== null);

  return {
    orders,
    total: body.meta?.pagination?.total ?? orders.length,
  };
}

/** One order in full, for the focus view. */
export async function fetchOrder(id: number): Promise<BoardOrder | null> {
  const response = await kitchenApi.getApiKitchenOrdersId(id);
  const raw = response.data.data;

  return raw ? toBoardOrder(raw) : null;
}

/**
 * Move an order along the workflow.
 *
 * Returns the order as the SERVER now sees it, which is what the caller must
 * store. That matters for the case where another screen moved it first: the
 * response is the authoritative state, not the state we optimistically hoped
 * for.
 */
export async function transitionOrder(
  id: number,
  status: FulfilmentStatus
): Promise<BoardOrder | null> {
  const body: PatchApiKitchenOrdersIdStatusBody = {
    status: status as PatchApiKitchenOrdersIdStatusBody['status'],
  };

  const response = await kitchenApi.patchApiKitchenOrdersIdStatus(id, body);
  const raw = response.data.data;

  return raw ? toBoardOrder(raw) : null;
}
