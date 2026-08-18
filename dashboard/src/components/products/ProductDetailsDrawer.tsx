/**
 * Read-only view of one product.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Tag, Typography } from 'antd';

import type { Product } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as productsService from '@/services/products.service';

const { Text, Paragraph } = Typography;

interface ProductDetailsDrawerProps {
  productId: number;
  /** Category names by id, so the drawer can name the category the list only numbers. */
  categoryNames: Map<number, string>;
  onClose: () => void;
}

export default function ProductDetailsDrawer({
  productId,
  categoryNames,
  onClose,
}: ProductDetailsDrawerProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    productsService
      .getProduct(productId)
      .then((loaded) => {
        if (!active) return;
        setProduct(loaded);
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
  }, [productId]);

  const categoryLabel =
    product?.categoryId === undefined
      ? '-'
      : (categoryNames.get(product.categoryId) ?? `#${product.categoryId}`);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={product?.name ?? 'Product'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {product ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Name">{product.name}</Descriptions.Item>
          <Descriptions.Item label="Category">{categoryLabel}</Descriptions.Item>
          <Descriptions.Item label="Status">
            {product.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Type">
            {product.isAddon ? <Tag color="processing">Add-on</Tag> : <Tag>Standalone</Tag>}
          </Descriptions.Item>
          {product.isAddon ? (
            <Descriptions.Item label="Attaches to">
              {product.addonParentId ? (
                `#${product.addonParentId}`
              ) : (
                <Text type="secondary">Any product</Text>
              )}
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Description">
            {product.description ? (
              <Paragraph className="details-drawer__text">{product.description}</Paragraph>
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Weight">
            {product.weight ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Tax slab">
            {product.taxSlabCode ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Image">
            {product.imageUrl ? (
              <Text copyable>{product.imageUrl}</Text>
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Chain">#{product.chainId}</Descriptions.Item>
          <Descriptions.Item label="Created">
            {product.createdAt ? new Date(product.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
