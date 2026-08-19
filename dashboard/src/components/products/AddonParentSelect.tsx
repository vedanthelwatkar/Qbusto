/**
 * Pick the product an add-on attaches to.
 *
 * Same server-side search as CategorySelect, over GET /api/products. The query
 * is pinned to `isAddon: false` because the backend refuses an add-on as a
 * parent ("An add-on cannot be the parent of another add-on"), so those are
 * never offered, and `excludeId` drops the product being edited - a product
 * cannot be its own parent either.
 */

import { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';

import type { Product } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as productsService from '@/services/products.service';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface AddonParentSelectProps {
  /** Supplied by Form.Item. */
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  /** The product being edited, which may not be its own parent. */
  excludeId?: number;
}

export default function AddonParentSelect({
  value,
  onChange,
  disabled = false,
  excludeId,
}: AddonParentSelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Product | null>(null);

  const known = selected?.id === value || options.some((option) => option.id === value);

  useEffect(() => {
    let active = true;

    const handle = window.setTimeout(
      () => {
        productsService
          .listAddonParents({ search: term || undefined, limit: PAGE_SIZE })
          .then((loaded) => {
            if (!active) return;
            setOptions(loaded);
            setLoading(false);
          })
          .catch(() => {
            if (!active) return;
            setOptions([]);
            setLoading(false);
          });
      },
      term ? SEARCH_DEBOUNCE_MS : 0
    );

    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [term]);

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
      allowClear
      value={value ?? undefined}
      onChange={(next) => onChange?.(next ?? null)}
      onSearch={(next) => {
        setLoading(true);
        setTerm(next);
      }}
      placeholder="Any product"
      disabled={disabled}
      notFoundContent={loading ? <Spin size="small" /> : 'No products found'}
      options={merged
        .filter((parent) => parent.id !== excludeId)
        .map((parent) => ({ value: parent.id, label: parent.name }))}
    />
  );
}
