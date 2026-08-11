/**
 * Pick a screen within a cinema.
 *
 * Built the same way as CinemaSelect: one page at a time, typing re-queries
 * the server through the `search` parameter GET /api/screens already
 * supports (partial match against the screen name).
 *
 * A screen has no chain of its own - tenant scope reaches it through its
 * cinema - so this always narrows by `cinemaId`. There is no cross-cinema
 * screen picker; callers disable this until a cinema is chosen.
 */

import { useEffect, useState } from 'react';
import { InputNumber, Select, Spin } from 'antd';

import type { Screen } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as screensService from '@/services/screens.service';

/** One page of suggestions. Enough to scroll, small enough to be quick. */
const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

interface ScreenSelectProps {
  /** Supplied by Form.Item, or by the caller when used as a filter. */
  value?: number | null;
  onChange?: (value: number | null) => void;
  /** Narrows the list to one cinema; required for a meaningful result. */
  cinemaId?: number | null;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function ScreenSelect({
  value,
  onChange,
  cinemaId,
  placeholder = 'Select a screen',
  allowClear = false,
  disabled = false,
  style,
}: ScreenSelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Screen[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Screen | null>(null);

  const known = selected?.id === value || options.some((option) => option.id === value);

  useEffect(() => {
    let active = true;

    const handle = window.setTimeout(
      () => {
        if (!active) return;

        if (!cinemaId) {
          setOptions([]);
          setLoading(false);
          return;
        }

        screensService
          .listScreens({
            search: term || undefined,
            limit: PAGE_SIZE,
            sort: 'name',
            order: 'asc',
            cinemaId,
          })
          .then((page) => {
            if (!active) return;
            setOptions(page.screens);
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
  }, [term, cinemaId]);

  // Only runs when the value is not among the loaded options, so choosing from
  // the dropdown costs no extra request.
  useEffect(() => {
    if (typeof value !== 'number' || known) return;

    let active = true;

    screensService
      .getScreen(value)
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
        placeholder="Screen id"
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
      // Matching happens on the server, so the browser must not also filter
      // the page it was sent.
      filterOption={false}
      value={value ?? undefined}
      onChange={(next) => onChange?.(next ?? null)}
      onSearch={(next) => {
        setLoading(true);
        setTerm(next);
      }}
      placeholder={placeholder}
      allowClear={allowClear}
      disabled={disabled || !cinemaId}
      style={style}
      notFoundContent={loading ? <Spin size="small" /> : 'No screens found'}
      options={merged.map((screen) => ({
        value: screen.id,
        label: `${screen.name}${screen.isActive === false ? ' - inactive' : ''}`,
      }))}
    />
  );
}
