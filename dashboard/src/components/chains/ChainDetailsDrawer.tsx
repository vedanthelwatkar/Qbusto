/**
 * Read-only view of one chain.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Tag, Typography } from 'antd';

import type { Chain } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as chainsService from '@/services/chains.service';

const { Text } = Typography;

interface ChainDetailsDrawerProps {
  chainId: number;
  onClose: () => void;
}

export default function ChainDetailsDrawer({ chainId, onClose }: ChainDetailsDrawerProps) {
  const [chain, setChain] = useState<Chain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    chainsService
      .getChain(chainId)
      .then((loaded) => {
        if (!active) return;
        setChain(loaded);
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
  }, [chainId]);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={chain?.name ?? 'Chain'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : null}

      {chain ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Name">{chain.name}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {chain.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Logo">
            {chain.logoImageUrl ? (
              <Text copyable>{chain.logoImageUrl}</Text>
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {chain.createdAt ? new Date(chain.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {chain.updatedAt ? new Date(chain.updatedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
