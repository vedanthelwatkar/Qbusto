/**
 * Pick a chain.
 *
 * Built the same way as CategorySelect: one page at a time, and typing
 * re-queries the server through the `search` parameter GET /api/chains already
 * supports, so this does not depend on every chain fitting in one response.
 *
 * Two cases need care and are why this is a component rather than an inline
 * Select:
 *
 *   - The selected chain is not necessarily in the first page, so that one chain
 *     is fetched by id and prepended.
 *   - Chains are authorised as Settings, so a user administrator without that
 *     module gets a 403. The field falls back to entering the id, which the API
 *     accepts just the same.
 */

import { useEffect, useState } from 'react';
import { InputNumber, Select, Spin } from 'antd';

import type { Chain } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as chainsService from '@/services/chains.service';

/** One page of suggestions. Enough to scroll, small enough to be quick. */
const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

interface ChainSelectProps {
  /** Supplied by Form.Item, or by the caller when used as a filter. */
  value?: number | null;
  onChange?: (value: number | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Filters want deactivated chains too; the create forms do not. */
  includeInactive?: boolean;
}

export default function ChainSelect({
  value,
  onChange,
  placeholder = 'Select a chain',
  allowClear = false,
  disabled = false,
  style,
  includeInactive = false,
}: ChainSelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Chain | null>(null);

  const known = selected?.id === value || options.some((option) => option.id === value);

  useEffect(() => {
    let active = true;

    // Debounced while typing; immediate on the first load so the field is not
    // empty for a third of a second on open.
    const handle = window.setTimeout(
      () => {
        chainsService
          .listChains({
            search: term || undefined,
            limit: PAGE_SIZE,
            sort: 'name',
            order: 'asc',
            ...(includeInactive ? {} : { isActive: true }),
          })
          .then((page) => {
            if (!active) return;
            setOptions(page.chains);
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
  }, [term, includeInactive]);

  // Only runs when the value is not among the loaded options, so choosing from
  // the dropdown costs no extra request.
  useEffect(() => {
    if (typeof value !== 'number' || known) return;

    let active = true;

    chainsService
      .getChain(value)
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
        placeholder="Chain id"
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
      // page it was sent - it would hide results the server chose to return.
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
      notFoundContent={loading ? <Spin size="small" /> : 'No chains found'}
      options={merged.map((chain) => ({
        value: chain.id,
        label: chain.isActive === false ? `${chain.name} (inactive)` : chain.name,
      }))}
    />
  );
}
