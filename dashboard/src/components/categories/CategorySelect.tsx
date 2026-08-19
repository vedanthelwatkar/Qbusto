/**
 * Pick a category.
 *
 * The list is fetched a page at a time and typing re-queries the server through
 * the `search` parameter GET /api/categories already supports, so this does not
 * depend on the whole catalogue fitting in one response.
 *
 * Two cases need care and are why this is a component rather than an inline
 * Select:
 *
 *   - The selected category is usually not in the first page. Editing a product
 *     filed under the two-hundredth category would otherwise show a bare id, so
 *     that one category is fetched by id and prepended.
 *   - Categories are authorised as their own module, so a product editor without
 *     Categories read gets a 403. The field falls back to entering the id, which
 *     the API accepts just the same.
 */

import { useEffect, useState } from 'react';
import { InputNumber, Select, Spin } from 'antd';

import type { Category } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as categoriesService from '@/services/categories.service';

/** One page of suggestions. Enough to scroll, small enough to be quick. */
const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

interface CategorySelectProps {
  /** Supplied by Form.Item, or by the caller when used as a filter. */
  value?: number | null;
  onChange?: (value: number | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Filters want deactivated categories too; the product form does not. */
  includeInactive?: boolean;
}

export default function CategorySelect({
  value,
  onChange,
  placeholder = 'Select a category',
  allowClear = false,
  disabled = false,
  style,
  includeInactive = false,
}: CategorySelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Category | null>(null);

  const known = selected?.id === value || options.some((option) => option.id === value);

  useEffect(() => {
    let active = true;

    // Debounced while typing; immediate on the first load so the field is not
    // empty for a third of a second on open.
    const handle = window.setTimeout(
      () => {
        categoriesService
          .listCategories({
            search: term || undefined,
            limit: PAGE_SIZE,
            sort: 'name',
            order: 'asc',
            ...(includeInactive ? {} : { isActive: true }),
          })
          .then((page) => {
            if (!active) return;
            setOptions(page.categories);
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

    categoriesService
      .getCategory(value)
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
        placeholder="Category id"
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
      notFoundContent={loading ? <Spin size="small" /> : 'No categories found'}
      options={merged.map((category) => ({
        value: category.id,
        label: category.isActive === false ? `${category.name} (inactive)` : category.name,
      }))}
    />
  );
}
