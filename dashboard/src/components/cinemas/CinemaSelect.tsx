/**
 * Pick a cinema.
 *
 * Built the same way as ChainSelect: one page at a time, and typing re-queries
 * the server through the `search` parameter GET /api/cinemas already supports,
 * which matches on name, code or city.
 *
 * `chainId` narrows the list for owners, who can see more than one chain. It is
 * ignored by the backend for every other role, which is already scoped to one.
 *
 * Cinemas are authorised as Settings, so a user administrator without that
 * module gets a 403; the field falls back to entering the id, which the API
 * accepts just the same.
 */

import { useEffect, useState } from 'react';
import { InputNumber, Select, Spin } from 'antd';

import type { Cinema } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as cinemasService from '@/services/cinemas.service';

/** One page of suggestions. Enough to scroll, small enough to be quick. */
const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

interface CinemaSelectProps {
  /** Supplied by Form.Item, or by the caller when used as a filter. */
  value?: number | null;
  onChange?: (value: number | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Owners only; the backend ignores it for every other role. */
  chainId?: number;
  /** Filters want deactivated cinemas too; the create forms do not. */
  includeInactive?: boolean;
}

export default function CinemaSelect({
  value,
  onChange,
  placeholder = 'Select a cinema',
  allowClear = false,
  disabled = false,
  style,
  chainId,
  includeInactive = false,
}: CinemaSelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Cinema[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Cinema | null>(null);

  const known = selected?.id === value || options.some((option) => option.id === value);

  useEffect(() => {
    let active = true;

    const handle = window.setTimeout(
      () => {
        cinemasService
          .listCinemas({
            search: term || undefined,
            limit: PAGE_SIZE,
            sort: 'name',
            order: 'asc',
            chainId,
            ...(includeInactive ? {} : { isActive: true }),
          })
          .then((page) => {
            if (!active) return;
            setOptions(page.cinemas);
            setLoading(false);
          })
          .catch(() => {
            if (!active) return;
            setUnavailable(true);
            setLoading(false);
          });
      },
      term ? SEARCH_DEBOUNCE_MS : 0
    );

    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [term, chainId, includeInactive]);

  // Only runs when the value is not among the loaded options, so choosing from
  // the dropdown costs no extra request.
  useEffect(() => {
    if (typeof value !== 'number' || known) return;

    let active = true;

    cinemasService
      .getCinema(value)
      .then((loaded) => active && setSelected(loaded))
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [value, known]);

  if (unavailable) {
    return (
      <InputNumber
        min={1}
        value={value ?? undefined}
        onChange={(next) => onChange?.(next ?? null)}
        disabled={disabled}
        placeholder="Cinema id"
        style={{ width: '100%', ...style }}
      />
    );
  }

  const merged =
    selected && !options.some((option) => option.id === selected.id)
      ? [selected, ...options]
      : options;

  return (
    <Select
      showSearch
      // Matching happens on the server, so the browser must not also filter the
      // page it was sent.
      filterOption={false}
      value={value ?? undefined}
      onChange={(next) => onChange?.(next ?? null)}
      onSearch={(next) => {
        setLoading(true);
        setTerm(next);
      }}
      placeholder={placeholder}
      allowClear={allowClear}
      disabled={disabled}
      style={style}
      notFoundContent={loading ? <Spin size="small" /> : 'No cinemas found'}
      // The code is what appears in QR ordering URLs, and two cinemas in
      // different cities can share a name, so it is shown alongside.
      options={merged.map((cinema) => ({
        value: cinema.id,
        label: `${cinema.name} (${cinema.code})${cinema.isActive === false ? ' - inactive' : ''}`,
      }))}
    />
  );
}
