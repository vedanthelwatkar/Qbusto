/**
 * Pick a film.
 *
 * Built the same way as CinemaSelect: one page at a time, and typing re-queries
 * the server through the `search` parameter GET /api/films already supports,
 * which matches on title.
 *
 * Films are authorised as Settings, so a user without that module gets a 403;
 * the field falls back to entering the code, which the API accepts just the same.
 */

import { useEffect, useState } from 'react';
import { Input, Select, Spin } from 'antd';

import type { Film } from '@/api/generated/cinemaOrderingAPI.schemas';
import * as filmsService from '@/services/films.service';

/** One page of suggestions. Enough to scroll, small enough to be quick. */
const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

interface FilmSelectProps {
  /** Supplied by Form.Item, or by the caller when used as a filter. */
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function FilmSelect({
  value,
  onChange,
  placeholder = 'Select a film',
  allowClear = false,
  disabled = false,
  style,
}: FilmSelectProps) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  /** The current value when it is not in the page of options on screen. */
  const [selected, setSelected] = useState<Film | null>(null);

  const known = selected?.code === value || options.some((option) => option.code === value);

  useEffect(() => {
    let active = true;

    const handle = window.setTimeout(
      () => {
        filmsService
          .listFilms({
            search: term || undefined,
            limit: PAGE_SIZE,
            sort: 'title',
            order: 'asc',
          })
          .then((page) => {
            if (!active) return;
            setOptions(page.films);
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
  }, [term]);

  // Only runs when the value is not among the loaded options, so choosing from
  // the dropdown costs no extra request.
  useEffect(() => {
    if (typeof value !== 'string' || !value || known) return;

    let active = true;

    filmsService
      .getFilm(value)
      .then((loaded) => active && setSelected(loaded))
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [value, known]);

  if (unavailable) {
    return (
      <Input
        value={value ?? undefined}
        onChange={(event) => onChange?.(event.target.value || null)}
        disabled={disabled}
        placeholder="Film code"
        style={{ width: '100%', ...style }}
      />
    );
  }

  const merged =
    selected && !options.some((option) => option.code === selected.code)
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
      notFoundContent={loading ? <Spin size="small" /> : 'No films found'}
      // Certification is shown alongside because re-releases and remakes share
      // a title, and it is usually what tells them apart in a list.
      options={merged.map((film) => ({
        value: film.code,
        label: [film.title ?? film.code, film.certification ? `(${film.certification})` : null]
          .filter(Boolean)
          .join(' '),
      }))}
    />
  );
}
