/**
 * Read-only view of one category.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Tag, Typography } from 'antd';

import type { Category } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as categoriesService from '@/services/categories.service';

const { Text, Paragraph } = Typography;

interface CategoryDetailsDrawerProps {
  categoryId: number;
  onClose: () => void;
}

export default function CategoryDetailsDrawer({ categoryId, onClose }: CategoryDetailsDrawerProps) {
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    categoriesService
      .getCategory(categoryId)
      .then((loaded) => {
        if (!active) return;
        setCategory(loaded);
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
  }, [categoryId]);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={category?.name ?? 'Category'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : null}

      {category ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Name">{category.name}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {category.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Description">
            {category.description ? (
              <Paragraph className="details-drawer__text">{category.description}</Paragraph>
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Image">
            {category.imageUrl ? (
              <Text copyable>{category.imageUrl}</Text>
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Chain">#{category.chainId}</Descriptions.Item>
          <Descriptions.Item label="Created">
            {category.createdAt ? new Date(category.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {category.updatedAt ? new Date(category.updatedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
