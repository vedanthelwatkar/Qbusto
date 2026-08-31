import { useEffect, useRef, useState } from 'react';

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
  { value: 'all', label: 'All Orders' },
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

  /**
   * The connection status, cinema name and sign-out control, tucked behind one
   * menu button rather than spread across the bar. Closes on an outside
   * click or Escape, same as the focus view's overlay convention.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <img className="topbar__mark" src="/favicon-192x192.png" alt="" aria-hidden="true" />
        <span className="topbar__name">
          <strong>QBusto</strong>
          <span className="topbar__sub">Kitchen Display System</span>
        </span>
      </div>

      <div className="topbar__controls">
        <label className="pill">
          <span className="pill__icon" aria-hidden="true">
            ▤
          </span>
          <span className="sr-only">Filter by status</span>
          <select
            className="pill__select"
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

        <label className="pill">
          <span className="pill__icon" aria-hidden="true">
            ⇅
          </span>
          <span className="sr-only">Sort orders</span>
          <select
            className="pill__select"
            value={sort}
            onChange={(event) => onSort(event.target.value as SortKey)}
          >
            <option value="placedAt">Sort by: Order Time</option>
            <option value="showTime">Sort by: Show Time</option>
          </select>
        </label>

        <label className="pill pill--search">
          <span className="sr-only">Search by order number, seat or film</span>
          <input
            className="pill__input"
            type="search"
            value={draft}
            placeholder="Search Order / Seat / Booking ID"
            onChange={(event) => setDraft(event.target.value)}
          />
          <span className="pill__icon pill__icon--trailing" aria-hidden="true">
            ⌕
          </span>
        </label>
      </div>

      <div className="topbar__menu" ref={menuRef}>
        <button
          type="button"
          className="topbar__menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-label="Screen menu"
        >
          <span
            className={`topbar__dot${refreshing ? ' topbar__dot--busy' : ''}${stale ? ' topbar__dot--stale' : ''}`}
            aria-hidden="true"
          />
          <span aria-hidden="true">☰</span>
        </button>

        {menuOpen && (
          <div className="topbar__panel" role="menu">
            {cinemaName && <p className="topbar__panel-title">{cinemaName}</p>}

            {/* Label/value rows rather than a run of sentences, so the panel
                can be read by scanning the left column. */}
            <p className="topbar__panel-row" role="status" aria-live="polite">
              <span className="topbar__panel-label">Connection</span>
              <span className={`topbar__panel-value${stale ? ' topbar__panel-value--stale' : ''}`}>
                {stale
                  ? 'Check connection'
                  : lastSyncedAt
                    ? `Updated ${formatClock(new Date(lastSyncedAt).toISOString())}`
                    : 'Connecting…'}
              </span>
            </p>

            <p className="topbar__panel-row">
              <span className="topbar__panel-label">Time</span>
              <span className="topbar__panel-value">{formatClock(new Date(now).toISOString())}</span>
            </p>

            <p className="topbar__panel-row">
              <span className="topbar__panel-label">Date</span>
              <span className="topbar__panel-value">{formatDate(new Date(now))}</span>
            </p>

            <button type="button" className="topbar__signout" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
