/**
 * Read-only view of one cinema.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Tag, Typography } from 'antd';

import type { Cinema } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as cinemasService from '@/services/cinemas.service';

const { Text } = Typography;

interface CinemaDetailsDrawerProps {
  cinemaId: number;
  /** Chain names by id, resolved by the page for the rows it is showing. */
  chainNames?: Map<number, string>;
  onClose: () => void;
}

export default function CinemaDetailsDrawer({
  cinemaId,
  chainNames,
  onClose,
}: CinemaDetailsDrawerProps) {
  const [cinema, setCinema] = useState<Cinema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    cinemasService
      .getCinema(cinemaId)
      .then((loaded) => {
        if (!active) return;
        setCinema(loaded);
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
  }, [cinemaId]);

  const chainLabel =
    cinema?.chainId === undefined ? '-' : (chainNames?.get(cinema.chainId) ?? `#${cinema.chainId}`);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={cinema?.name ?? 'Cinema'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {cinema ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Name">{cinema.name}</Descriptions.Item>
          <Descriptions.Item label="Code">
            <Text copyable>{cinema.code}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {cinema.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Chain">{chainLabel}</Descriptions.Item>
          <Descriptions.Item label="Location">
            {cinema.location ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="City">
            {cinema.city ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="GST number">
            {cinema.gstNumber ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="FSSAI number">
            {cinema.fssaiNumber ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Active since">
            {cinema.activeSince ? (
              new Date(cinema.activeSince).toLocaleDateString()
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Notifications">
            <Tag color={cinema.smsEnabled ? 'success' : 'default'}>
              SMS {cinema.smsEnabled ? 'on' : 'off'}
            </Tag>
            <Tag color={cinema.whatsappEnabled ? 'success' : 'default'}>
              WhatsApp {cinema.whatsappEnabled ? 'on' : 'off'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {cinema.createdAt ? new Date(cinema.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {cinema.updatedAt ? new Date(cinema.updatedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
