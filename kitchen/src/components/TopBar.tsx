import { useEffect, useState } from 'react';

import type { FulfilmentStatus } from '../types/kitchen';
import type { SortKey } from '../stores/board.store';
import { STATUS_LABEL } from '../utils/workflow';
import { formatClock, formatDate } from '../utils/time';

interface TopBarProps {
  search: string;
  statusFilter: FulfilmentStatus | 'all';
  sort: SortKey;
  refreshing: boolean;
  lastSyncedAt: number | null;
  now: number;
  cinemaName: string | null;
  onSearch: (value: string) => void;
  onStatusFilter: (value: FulfilmentStatus | 'all') => void;
  onSort: (value: SortKey) => void;
  onSignOut: () => void;
}

/**
 * How stale the board may get before it is worth saying so.
 *
 * Three missed polls. One failure is a blip a cook should not be interrupted
 * for; three in a row means the screen is probably showing yesterday's truth
 * and someone needs to look at the network.
 */
const STALE_AFTER_MS = 35_000;

const FILTERS: Array<{ value: FulfilmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All orders' },
  { value: 'confirmed', label: STATUS_LABEL.confirmed },
  { value: 'preparing', label: STATUS_LABEL.preparing },
  { value: 'ready', label: STATUS_LABEL.ready },
];

export function TopBar({
  search,
  statusFilter,
  sort,
  refreshing,
  lastSyncedAt,
  now,
  cinemaName,
  onSearch,
  onStatusFilter,
  onSort,
  onSignOut,
}: TopBarProps) {
  /*
   * The input is locally controlled and debounced into the store.
   *
   * Without this, every keystroke fires a request; with a plain controlled
   * input bound straight to the store, the field also fights the user whenever
   * a poll lands mid-typing.
   */
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    if (draft === search) return;

    const id = window.setTimeout(() => onSearch(draft), 300);
    return () => window.clearTimeout(id);
  }, [draft, search, onSearch]);

  /*
   * There is deliberately no effect syncing `draft` back from `search`.
   *
   * The only thing that changes `search` without the user typing is the
   * sign-out reset, and that unmounts this component - so the local state is
   * discarded anyway. An effect mirroring a prop into state would be a
   * cascading render on every keystroke to solve a case that cannot happen.
   */

  const stale = lastSyncedAt !== null && now - lastSyncedAt > STALE_AFTER_MS;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark" aria-hidden="true">
          Q
        </span>
        <span className="topbar__name">
          <strong>QBusto</strong>
          <span className="topbar__sub">Kitchen Display</span>
        </span>
      </div>

      <div className="topbar__controls">
        <label className="field">
          <span className="sr-only">Filter by status</span>
          <select
            className="field__select"
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.target.value as FulfilmentStatus | 'all')}
          >
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="sr-only">Sort orders</span>
          <select
            className="field__select"
            value={sort}
            onChange={(event) => onSort(event.target.value as SortKey)}
          >
            <option value="placedAt">Sort: Order time</option>
            <option value="showTime">Sort: Show time</option>
          </select>
        </label>

        <label className="field field--search">
          <span className="sr-only">Search by order number, seat or film</span>
          <input
            className="field__input"
            type="search"
            value={draft}
            placeholder="Search order / seat / film"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      </div>

      <div className="topbar__meta">
        {/*
          Connection state is announced politely: a cook does not need a toast
          for every poll, but a board that has silently stopped updating is
          dangerous.
        */}
        <span
          className={`topbar__sync${stale ? ' topbar__sync--stale' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className={`topbar__dot${refreshing ? ' topbar__dot--busy' : ''}`} aria-hidden="true" />
          {stale
            ? 'Not updating — check connection'
            : lastSyncedAt
              ? `Updated ${formatClock(new Date(lastSyncedAt).toISOString())}`
              : 'Connecting…'}
        </span>

        <span className="topbar__clock">
          <span className="topbar__time">{formatClock(new Date(now).toISOString())}</span>
          <span className="topbar__date">{formatDate(new Date(now))}</span>
        </span>

        {cinemaName && <span className="topbar__cinema">{cinemaName}</span>}

        <button type="button" className="topbar__signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
