/**
 * Pick a product.
 *
 * Built the same way as CinemaSelect: one page at a time, and typing re-queries
 * the server through the `search` parameter GET /api/products already supports.
 *
 * Unlike AddonParentSelect this offers add-ons too - an add-on is ordered and
 * therefore priced like anything else, so pinning `isAddon: false` here would
 * hide half the catalogue from the pricing screen.
 *
 * Products are authorised as their own module, so a pricing editor without
 * Products read gets a 403; the field falls back to entering the id, which the
 * API accepts just the same.
 */

import { useEffect, useState } from 'react';
import { InputNumber, Select, Spin } from 'antd';

import type { Product } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as productsService from '@/services/products.service';

/** One page of suggestions. Enough to scroll, small enough to be quick. */
const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

interface ProductSelectProps {
  /** Supplied by Form.Item, or by the caller when used as a filter. */
  value?: number | null;
  onChange?: (value: number | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Filters want deactivated products too; the create forms do not. */
  includeInactive?: boolean;
}

export default function ProductSelect({
  value,
  onChange,
  placeholder = 'Select a product',
  allowClear = false,
  disabled = false,
  style,
  includeInactive = false,
}: ProductSelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Product | null>(null);

  const known = selected?.id === value || options.some((option) => option.id === value);

  useEffect(() => {
    let active = true;

    const handle = window.setTimeout(
      () => {
        productsService
          .listProducts({
            search: term || undefined,
            limit: PAGE_SIZE,
            sort: 'name',
            order: 'asc',
            ...(includeInactive ? {} : { isActive: true }),
          })
          .then((page) => {
            if (!active) return;
            setOptions(page.products);
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

    productsService
      .getProduct(value)
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
        placeholder="Product id"
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
      notFoundContent={loading ? <Spin size="small" /> : 'No products found'}
      options={merged.map((product) => ({
        value: product.id,
        label: `${product.name}${product.isActive === false ? ' - inactive' : ''}`,
      }))}
    />
  );
}
