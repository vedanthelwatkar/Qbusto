/**
 * The weekly pricing editor: ONE product at ONE cinema, all seven days.
 *
 * WHAT THIS REPLACED
 *
 * Pricing used to be one row per day. Giving a product a weekend price meant
 * opening this form again, choosing Saturday, typing the price, saving, then
 * doing the whole thing once more for Sunday - and reading a product's week
 * back meant finding up to eight rows in the table and holding the
 * "specific day beats every day" rule in your head. The week is now seven
 * columns on one row, so it is one form, opened once.
 *
 * One modal for create and edit. Creating asks for the cinema and the product;
 * editing offers neither, because together they are the natural key
 * (UQ_product_pricing_cinema_product) - changing one names a different row
 * rather than editing this one. The spec leaves them off the update body, and
 * they are shown as read-only text instead so the form still says what is being
 * priced.
 *
 * DISCOUNTS ARE PER DAY, not shared by the week. A Wednesday-only discount
 * (cinema 1's live data before the day-discount migration) must never apply on
 * Thursday, so each day's discount fields live in that day's own Popover in
 * WeeklyPriceFields - this file only has to load and submit all 42 of them
 * without inventing any cross-day sharing.
 *
 * A day's discount amount is only asked for once that SAME day's discount type
 * is chosen. That is not decoration: the frozen ProductPricing beforeSave hook
 * rejects an amount with no type, for that day, as a 400 - so clearing a day's
 * type clears that day's amounts on the way out rather than sending a payload
 * that contradicts itself.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Divider, Form, Modal, Spin, Switch, Typography } from 'antd';

import type {
  PostApiProductPricingBody,
  ProductPricing,
  PutApiProductPricingIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { WEEKDAY_PRICE_FIELDS, dayDiscountFields } from '@/components/pricing/days';
import WeeklyPriceFields from '@/components/pricing/WeeklyPriceFields';
import ProductSelect from '@/components/products/ProductSelect';
import { toApiError } from '@/services/api';
import * as pricingService from '@/services/pricing.service';
import { fieldErrorsFrom } from '@/utils/validation';

const { Text } = Typography;

/** Every per-day discount field name, flattened - for load/submit only. */
const ALL_DISCOUNT_FIELDS = WEEKDAY_PRICE_FIELDS.flatMap((day) =>
  Object.values(dayDiscountFields(day.field))
);

type FormValues = Record<string, unknown> & {
  cinemaId?: number;
  productId?: number;
  isActive: boolean;
};

interface PricingFormModalProps {
  /** Omitted for a new price row. Only `id` is read - the rest is refetched. */
  pricing?: ProductPricing;
  /** Preselected on the create form when the list is already filtered. */
  defaultCinemaId?: number;
  defaultProductId?: number;
  /** Names by id, resolved by the page for the rows it is showing. */
  cinemaNames?: Map<number, string>;
  productNames?: Map<number, string>;
  onClose: () => void;
  onSaved: () => void;
}

export default function PricingFormModal({
  pricing,
  defaultCinemaId,
  defaultProductId,
  cinemaNames,
  productNames,
  onClose,
  onSaved,
}: PricingFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const pricingId = pricing?.id;
  const isEdit = pricingId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What is being priced. Shown but not editable while editing. */
  const [key, setKey] = useState<Pick<ProductPricing, 'cinemaId' | 'productId'>>({
    cinemaId: pricing?.cinemaId,
    productId: pricing?.productId,
  });

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (pricingId === undefined) return;

    let active = true;

    pricingService
      .getPricing(pricingId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          /*
           * The decimal columns arrive as numbers, which is what the form works
           * in, so they are set straight through - INCLUDING null, which has to
           * survive the round trip as null rather than becoming 0. A day the
           * cinema does not sell on must come back blank, not free; a day with
           * no discount must come back with no type, not a leftover from
           * another day.
           */
          ...Object.fromEntries(
            WEEKDAY_PRICE_FIELDS.map(({ field }) => [
              field,
              (full as Record<string, unknown>)[field] ?? null,
            ])
          ),
          ...Object.fromEntries(
            ALL_DISCOUNT_FIELDS.map((field) => [
              field,
              (full as Record<string, unknown>)[field] ?? null,
            ])
          ),
          isActive: full.isActive !== false,
        });

        setKey({ cinemaId: full.cinemaId, productId: full.productId });
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* price row, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, pricingId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    /*
     * Every day's price AND every day's discount fields are sent explicitly,
     * null included. Omitting a key means "leave it as it was", which is not
     * what an emptied field means - the user cleared it, and that has to reach
     * the server. A day with no discount type sends null for its own amount
     * fields too, so a discount left behind under a cleared type cannot slip
     * through - the model hook would reject it anyway, but there is no reason
     * to round-trip a 400 for something the form already knows.
     */
    const week = Object.fromEntries(
      WEEKDAY_PRICE_FIELDS.map(({ field }) => [field, values[field] ?? null])
    );
    const discounts = Object.fromEntries(
      WEEKDAY_PRICE_FIELDS.flatMap((day) => {
        const fields = dayDiscountFields(day.field);
        const hasType = Boolean(values[fields.type]);

        return Object.values(fields).map((field) => [
          field,
          hasType ? (values[field] ?? null) : null,
        ]);
      })
    );

    try {
      if (pricingId !== undefined) {
        const body: PutApiProductPricingIdBody = {
          ...week,
          ...discounts,
          isActive: values.isActive,
        };

        await pricingService.updatePricing(pricingId, body);
        message.success('Price updated');
      } else {
        const body: PostApiProductPricingBody = {
          // Both are required by the spec, and by the required rules below.
          cinemaId: values.cinemaId as number,
          productId: values.productId as number,
          ...week,
          ...discounts,
          isActive: values.isActive,
        };

        await pricingService.createPricing(body);
        message.success('Price created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // Only on create. While editing, a 404 is about the price row itself -
      // "Product pricing not found" - which names no field on this form and
      // happens to contain the word "product".
      if (!isEdit && apiError.status === 404) {
        const field = apiError.message.toLowerCase().includes('cinema') ? 'cinemaId' : 'productId';

        form.setFields([{ name: field, errors: [apiError.message] }]);
      }

      /*
       * Two different 409s share this status and neither names a field. Both
       * are now about the (cinema, product) pair: a duplicate arrives from
       * UQ_product_pricing_cinema_product as "A record with these values
       * already exists", and the cross-tenant case as "The cinema and product
       * belong to different chains". Either way the product is the half the
       * user is most likely to want to change, so both pin there - and a
       * duplicate now means "this product already has a week at this cinema;
       * edit that instead of creating a second one".
       */
      if (!isEdit && apiError.status === 409) {
        form.setFields([{ name: 'productId', errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  const cinemaLabel =
    key.cinemaId === undefined ? '-' : (cinemaNames?.get(key.cinemaId) ?? `#${key.cinemaId}`);
  const productLabel =
    key.productId === undefined ? '-' : (productNames?.get(key.productId) ?? `#${key.productId}`);

  return (
    <Modal
      open={visible}
      title={isEdit ? 'Weekly pricing' : 'New weekly pricing'}
      okText={isEdit ? 'Save changes' : 'Create pricing'}
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || loadFailed }}
      width={760}
      centered
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Spin spinning={loading}>
        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          disabled={submitting || loading || loadFailed}
          initialValues={{
            isActive: true,
            cinemaId: defaultCinemaId,
            productId: defaultProductId,
          }}
        >
          {isEdit ? (
            <>
              <Form.Item
                label="Cinema"
                extra="The cinema and product cannot be changed after the pricing is created."
              >
                <Text>{cinemaLabel}</Text>
              </Form.Item>

              <Form.Item label="Product">
                <Text>{productLabel}</Text>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                name="cinemaId"
                label="Cinema"
                extra="The cinema and the product must belong to the same chain."
                rules={[{ required: true, message: 'Choose a cinema' }]}
              >
                <CinemaSelect />
              </Form.Item>

              <Form.Item
                name="productId"
                label="Product"
                extra="One weekly pricing per cinema and product. Cannot be changed afterwards."
                rules={[{ required: true, message: 'Choose a product' }]}
              >
                <ProductSelect />
              </Form.Item>
            </>
          )}

          <Divider titlePlacement="start" plain>
            Prices &amp; discounts
          </Divider>

          <WeeklyPriceFields form={form} disabled={submitting || loading || loadFailed} />

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
