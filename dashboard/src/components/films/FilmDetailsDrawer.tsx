/**
 * Read-only view of one film, as the source system supplies it.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Typography } from 'antd';

import type { Film } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as filmsService from '@/services/films.service';
import { resolveImageUrl } from '@/utils/imageUrl';

const { Text } = Typography;

interface FilmDetailsDrawerProps {
  /** The source system's film code. */
  filmCode: string;
  onClose: () => void;
}

export default function FilmDetailsDrawer({ filmCode, onClose }: FilmDetailsDrawerProps) {
  const [film, setFilm] = useState<Film | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    filmsService
      .getFilm(filmCode)
      .then((loaded) => {
        if (!active) return;
        setFilm(loaded);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filmCode]);

  const poster = resolveImageUrl(film?.imageUrl);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={film?.title ?? 'Film'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}

      {film ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Title">
            {film.title ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Code">{film.code}</Descriptions.Item>
          <Descriptions.Item label="Certification">
            {film.certification ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Running time">
            {film.durationMinutes ? `${film.durationMinutes} min` : <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Now showing">
            {film.nowShowingFlag ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {film.status ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Opening date">
            {film.openingDate ? (
              new Date(film.openingDate).toLocaleDateString()
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Poster">
            {poster ? (
              <img src={poster} alt="" className="image-field__preview" />
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
