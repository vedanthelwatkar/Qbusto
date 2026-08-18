/**
 * Read-only view of one price row.
 *
 * The discount amounts are only shown once a discount type is set, because
 * without one they are not applied at all - the model refuses to store them.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Skeleton, Tag } from 'antd';

import type { ProductPricing } from '@/api/generated/cinemaOrderingAPI.schemas';
import { dayOfWeekLabel } from '@/components/pricing/days';
import { formatDiscount, formatMoney } from '@/components/pricing/money';
import { toApiError } from '@/services/api';
import * as pricingService from '@/services/pricing.service';

interface PricingDetailsDrawerProps {
  pricingId: number;
  /** Names by id, resolved by the page for the rows it is showing. */
  cinemaNames?: Map<number, string>;
  productNames?: Map<number, string>;
  onClose: () => void;
}

export default function PricingDetailsDrawer({
  pricingId,
  cinemaNames,
  productNames,
  onClose,
}: PricingDetailsDrawerProps) {
  const [pricing, setPricing] = useState<ProductPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    pricingService
      .getPricing(pricingId)
      .then((loaded) => {
        if (!active) return;
        setPricing(loaded);
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
  }, [pricingId]);

  const cinemaLabel =
    pricing?.cinemaId === undefined
      ? '-'
      : (cinemaNames?.get(pricing.cinemaId) ?? `#${pricing.cinemaId}`);

  const productLabel =
    pricing?.productId === undefined
      ? '-'
      : (productNames?.get(pricing.productId) ?? `#${pricing.productId}`);

  const amount = (value: number | null | undefined) =>
    formatDiscount(value, pricing?.discountType ?? null);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title="Price"
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {pricing ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Cinema">{cinemaLabel}</Descriptions.Item>
          <Descriptions.Item label="Product">{productLabel}</Descriptions.Item>
          <Descriptions.Item label="Day">{dayOfWeekLabel(pricing.dayOfWeek)}</Descriptions.Item>
          <Descriptions.Item label="Base price">{formatMoney(pricing.basePrice)}</Descriptions.Item>

          <Descriptions.Item label="Discount type">
            {pricing.discountType === 'P'
              ? 'Percentage'
              : pricing.discountType === 'F'
                ? 'Flat amount'
                : 'None'}
          </Descriptions.Item>

          {pricing.discountType ? (
            <>
              <Descriptions.Item label="Default discount">
                {amount(pricing.discountValue)}
              </Descriptions.Item>
              <Descriptions.Item label="On QR">{amount(pricing.discountOnQr)}</Descriptions.Item>
              <Descriptions.Item label="On kiosk">
                {amount(pricing.discountOnKiosk)}
              </Descriptions.Item>
              <Descriptions.Item label="On seat QR">
                {amount(pricing.discountOnSeatQr)}
              </Descriptions.Item>
              <Descriptions.Item label="On counter">
                {amount(pricing.discountOnCounter)}
              </Descriptions.Item>
            </>
          ) : null}

          <Descriptions.Item label="Status">
            {pricing.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {pricing.createdAt ? new Date(pricing.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {pricing.updatedAt ? new Date(pricing.updatedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
