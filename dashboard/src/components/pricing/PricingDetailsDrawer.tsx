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
import { Alert, Descriptions, Drawer, Tag, Typography } from 'antd';

import DetailsSkeleton from '@/components/DetailsSkeleton';

import type { ProductPricing } from '@/api/generated/cinemaOrderingAPI.schemas';
import { WEEKDAY_PRICE_FIELDS, dayDiscountFields } from '@/components/pricing/days';
import { formatDiscount, formatMoney } from '@/components/pricing/money';
import { toApiError } from '@/services/api';
import * as pricingService from '@/services/pricing.service';
import { formatDateTime } from '@/utils/datetime';

const { Text } = Typography;

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

  /** One day's discount, as {type, value, onQr, onKiosk, onSeatQr, onCounter} - or null. */
  const dayDiscount = (field: (typeof WEEKDAY_PRICE_FIELDS)[number]['field']) => {
    if (!pricing) return null;

    const fields = dayDiscountFields(field);
    const type = (pricing as Record<string, unknown>)[fields.type] as 'P' | 'F' | null;

    if (!type) return null;

    const amount = (key: keyof typeof fields) =>
      formatDiscount((pricing as Record<string, unknown>)[fields[key]] as number | null, type);

    return {
      type,
      value: amount('value'),
      onQr: amount('onQr'),
      onKiosk: amount('onKiosk'),
      onSeatQr: amount('onSeatQr'),
      onCounter: amount('onCounter'),
    };
  };

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

      {loading ? <DetailsSkeleton rows={6} /> : null}

      {pricing ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Cinema">{cinemaLabel}</Descriptions.Item>
          <Descriptions.Item label="Product">{productLabel}</Descriptions.Item>
          {WEEKDAY_PRICE_FIELDS.map(({ field, label }) => {
            const discount = dayDiscount(field);

            return (
              <Descriptions.Item label={label} key={field}>
                {/* Blank is not zero: it means the product is not sold that
                    day. Saying so beats showing a dash the reader has to
                    interpret. */}
                {pricing[field] === null || pricing[field] === undefined ? (
                  <Text type="secondary">Not sold</Text>
                ) : (
                  <>
                    {formatMoney(pricing[field])}
                    {discount ? (
                      <Tag color="processing" style={{ marginLeft: 8 }}>
                        {discount.type === 'P' ? 'Percentage' : 'Flat'} off: {discount.value}
                        {discount.onQr !== '-' ? ` | QR ${discount.onQr}` : ''}
                        {discount.onKiosk !== '-' ? ` | Kiosk ${discount.onKiosk}` : ''}
                        {discount.onSeatQr !== '-' ? ` | Seat QR ${discount.onSeatQr}` : ''}
                        {discount.onCounter !== '-' ? ` | Counter ${discount.onCounter}` : ''}
                      </Tag>
                    ) : null}
                  </>
                )}
              </Descriptions.Item>
            );
          })}

          <Descriptions.Item label="Status">
            {pricing.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {pricing.createdAt ? formatDateTime(pricing.createdAt) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {pricing.updatedAt ? formatDateTime(pricing.updatedAt) : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
