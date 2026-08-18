import { useCallback, useEffect, useMemo, useState } from 'react';

import { BoardLane } from './components/BoardLane';
import { OrderDetail } from './components/OrderDetail';
import { SignIn } from './components/SignIn';
import { SummaryBar } from './components/SummaryBar';
import { TopBar } from './components/TopBar';
import { useNow } from './hooks/useNow';
import { usePolling } from './hooks/usePolling';
import { useAuthStore } from './stores/auth.store';
import { useBoardStore } from './stores/board.store';
import type { BoardOrder, FulfilmentStatus } from './types/kitchen';
import { COMPLETED_WINDOW_MS } from './config';
import { nextAction } from './utils/workflow';
import './styles/app.scss';

/** The lanes the board shows, in workflow order. */
const LANES: FulfilmentStatus[] = ['confirmed', 'preparing', 'ready'];

export default function App() {
  const token = useAuthStore((state) => state.token);
  const restoring = useAuthStore((state) => state.restoring);
  const restore = useAuthStore((state) => state.restore);
  const signOut = useAuthStore((state) => state.signOut);
  const user = useAuthStore((state) => state.user);

  // Validate a token carried over from a previous page load before showing
  // anything, so a reloaded display returns to the board rather than flashing
  // a board it is not actually authorised for.
  useEffect(() => {
    void restore();
  }, [restore]);

  if (restoring) {
    return (
      <main className="boot">
        <p className="boot__text">Starting kitchen display…</p>
      </main>
    );
  }

  if (!token) return <SignIn />;

  return <Board onSignOut={signOut} cinemaName={user?.username ?? null} />;
}

function Board({ onSignOut, cinemaName }: { onSignOut: () => void; cinemaName: string | null }) {
  const now = useNow();

  const active = useBoardStore((state) => state.active);
  const completed = useBoardStore((state) => state.completed);
  const activeTotal = useBoardStore((state) => state.activeTotal);
  const initialLoading = useBoardStore((state) => state.initialLoading);
  const refreshing = useBoardStore((state) => state.refreshing);
  const error = useBoardStore((state) => state.error);
  const lastSyncedAt = useBoardStore((state) => state.lastSyncedAt);
  const search = useBoardStore((state) => state.search);
  const statusFilter = useBoardStore((state) => state.statusFilter);
  const sort = useBoardStore((state) => state.sort);
  const pending = useBoardStore((state) => state.pending);
  const setSearch = useBoardStore((state) => state.setSearch);
  const setStatusFilter = useBoardStore((state) => state.setStatusFilter);
  const setSort = useBoardStore((state) => state.setSort);
  const transition = useBoardStore((state) => state.transition);
  const resetBoard = useBoardStore((state) => state.reset);

  const [openOrderId, setOpenOrderId] = useState<number | null>(null);

  usePolling(true);

  /**
   * Trim the completed lane to a recent window.
   *
   * The server returns delivered orders newest-first; the kitchen only needs
   * enough to answer "did that go out?". Filtering here rather than asking the
   * server for a time range keeps the query simple, and the volume is one page
   * either way.
   */
  const recentCompleted = useMemo(
    () =>
      completed.filter((order) => {
        const stamp = order.deliveredAt ?? order.placedAt;
        return now - new Date(stamp).getTime() <= COMPLETED_WINDOW_MS;
      }),
    [completed, now]
  );

  const byStatus = useMemo(() => {
    const groups: Record<FulfilmentStatus, BoardOrder[]> = {
      confirmed: [],
      preparing: [],
      ready: [],
      delivered: recentCompleted,
    };

    for (const order of active) {
      if (order.status !== 'delivered') groups[order.status].push(order);
    }

    return groups;
  }, [active, recentCompleted]);

  /**
   * The order shown in the focus view.
   *
   * Looked up from the live board on every render rather than copied into
   * state, so a poll or another screen's transition updates the open detail
   * view too. When the order leaves the board entirely, the view closes itself
   * (see below) instead of showing a frozen copy.
   */
  const openOrder = useMemo(() => {
    if (openOrderId === null) return null;
    return (
      active.find((order) => order.id === openOrderId) ??
      completed.find((order) => order.id === openOrderId) ??
      null
    );
  }, [openOrderId, active, completed]);

  /*
   * When an order leaves the board - refunded, rejected, or aged out of the
   * completed window - `openOrder` becomes null and the overlay simply stops
   * rendering. That needs no effect.
   *
   * What does need handling is the stale id left behind: if the user then
   * changes a filter and the order comes back into the result set, the overlay
   * would reappear on its own. So the id is cleared when the query changes,
   * in the event handler that changes it, rather than by an effect watching
   * for the order to disappear.
   */
  const handleSearch = useCallback(
    (value: string) => {
      setOpenOrderId(null);
      setSearch(value);
    },
    [setSearch]
  );

  const handleStatusFilter = useCallback(
    (value: FulfilmentStatus | 'all') => {
      setOpenOrderId(null);
      setStatusFilter(value);
    },
    [setStatusFilter]
  );

  const handleAdvance = useCallback(
    (order: BoardOrder) => {
      const action = nextAction(order.status);
      // Belt and braces: the button is only rendered when an action exists, so
      // this cannot fire an invalid transition even if that changes.
      if (!action) return;
      void transition(order.id, action.status);
    },
    [transition]
  );

  const handleSignOut = useCallback(() => {
    // Clear the board first so a signed-out screen cannot briefly show the
    // previous user's orders.
    resetBoard();
    onSignOut();
  }, [resetBoard, onSignOut]);

  return (
    <div className="app">
      <TopBar
        search={search}
        statusFilter={statusFilter}
        sort={sort}
        refreshing={refreshing}
        lastSyncedAt={lastSyncedAt}
        now={now}
        cinemaName={cinemaName}
        onSearch={handleSearch}
        onStatusFilter={handleStatusFilter}
        onSort={setSort}
        onSignOut={handleSignOut}
      />

      {/*
        An error never replaces the board. A cook needs the last known orders
        more than an empty screen, so this is a banner over live (if stale)
        data.
      */}
      {error && (
        <p className="app__error" role="status">
          {error}
        </p>
      )}

      <main className="app__board">
        {initialLoading ? (
          <p className="app__state">Loading the kitchen board…</p>
        ) : active.length === 0 && recentCompleted.length === 0 ? (
          <p className="app__state">
            {search || statusFilter !== 'all'
              ? 'No orders match this filter.'
              : 'No orders waiting. New paid orders appear here automatically.'}
          </p>
        ) : (
          <>
            <div className="app__lanes">
              {LANES.map((status) => (
                <BoardLane
                  key={status}
                  status={status}
                  orders={byStatus[status]}
                  now={now}
                  pending={pending}
                  onOpen={setOpenOrderId}
                  onAdvance={handleAdvance}
                />
              ))}
            </div>

            {recentCompleted.length > 0 && (
              <BoardLane
                status="delivered"
                orders={recentCompleted}
                now={now}
                pending={pending}
                onOpen={setOpenOrderId}
                onAdvance={handleAdvance}
              />
            )}
          </>
        )}
      </main>

      <SummaryBar
        active={active}
        completed={recentCompleted}
        now={now}
        activeTotal={activeTotal}
      />

      {openOrder && (
        <OrderDetail
          order={openOrder}
          now={now}
          pending={pending.has(openOrder.id)}
          onClose={() => setOpenOrderId(null)}
          onAdvance={handleAdvance}
        />
      )}
    </div>
  );
}
