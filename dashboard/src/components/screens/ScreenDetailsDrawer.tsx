/**
 * Read-only view of one screen.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Tag } from 'antd';

import type { Screen } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as screensService from '@/services/screens.service';

interface ScreenDetailsDrawerProps {
  screenId: number;
  /** Cinema names by id, resolved by the page for the rows it is showing. */
  cinemaNames?: Map<number, string>;
  onClose: () => void;
}

export default function ScreenDetailsDrawer({
  screenId,
  cinemaNames,
  onClose,
}: ScreenDetailsDrawerProps) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    screensService
      .getScreen(screenId)
      .then((loaded) => {
        if (!active) return;
        setScreen(loaded);
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
  }, [screenId]);

  const cinemaLabel =
    screen?.cinemaId === undefined
      ? '-'
      : (cinemaNames?.get(screen.cinemaId) ?? `#${screen.cinemaId}`);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={screen?.name ?? 'Screen'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}

      {screen ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Name">{screen.name}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {screen.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Cinema">{cinemaLabel}</Descriptions.Item>
          <Descriptions.Item label="Created">
            {screen.createdAt ? new Date(screen.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {screen.updatedAt ? new Date(screen.updatedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
