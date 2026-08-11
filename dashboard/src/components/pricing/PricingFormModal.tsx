/**
 * Create and edit a price row.
 *
 * One modal for both. Creating asks for the cinema, the product and the day;
 * editing does not offer any of the three, because together they are the
 * natural key (UQ_product_pricing) - changing one names a different row rather
 * than editing this one. The spec leaves them off the update body, and they are
 * shown as read-only text instead so the form still says what is being priced.
 *
 * The discount amounts are only asked for once a discount type is chosen. That
 * is not decoration: the frozen ProductPricing beforeSave hook rejects an
 * amount with no type as a 400, so clearing the type clears the amounts on the
 * way out rather than sending a payload that contradicts itself.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Form, InputNumber, Modal, Select, Spin, Switch, Typography } from 'antd';

import type {
  PostApiProductPricingBody,
  PostApiProductPricingBodyDiscountType,
  ProductPricing,
  PutApiProductPricingIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { DAY_OF_WEEK_OPTIONS, dayOfWeekLabel } from '@/components/pricing/days';
import ProductSelect from '@/components/products/ProductSelect';
import { toApiError } from '@/services/api';
import * as pricingService from '@/services/pricing.service';
import { fieldErrorsFrom } from '@/utils/validation';

const { Text } = Typography;

interface FormValues {
  cinemaId?: number;
  productId?: number;
  dayOfWeek: number;
  basePrice: number;
  discountType?: PostApiProductPricingBodyDiscountType;
  discountValue?: number | null;
  discountOnQr?: number | null;
  discountOnKiosk?: number | null;
  discountOnSeatQr?: number | null;
  discountOnCounter?: number | null;
  isActive: boolean;
}

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
  const [key, setKey] = useState<Pick<ProductPricing, 'cinemaId' | 'productId' | 'dayOfWeek'>>({
    cinemaId: pricing?.cinemaId,
    productId: pricing?.productId,
    dayOfWeek: pricing?.dayOfWeek,
  });

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  const discountType = Form.useWatch('discountType', form);

  useEffect(() => {
    if (pricingId === undefined) return;

    let active = true;

    pricingService
      .getPricing(pricingId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          // The decimal columns arrive as numbers, which is what the form
          // works in, so they are set straight through.
          basePrice: full.basePrice ?? 0,
          discountType: full.discountType,
          discountValue: full.discountValue ?? null,
          discountOnQr: full.discountOnQr ?? null,
          discountOnKiosk: full.discountOnKiosk ?? null,
          discountOnSeatQr: full.discountOnSeatQr ?? null,
          discountOnCounter: full.discountOnCounter ?? null,
          isActive: full.isActive !== false,
        });

        setKey({
          cinemaId: full.cinemaId,
          productId: full.productId,
          dayOfWeek: full.dayOfWeek,
        });
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

    // An amount without a type is rejected by the model hook, so dropping the
    // type drops every amount with it rather than leaving one behind.
    const discounts = values.discountType
      ? {
          discountType: values.discountType,
          discountValue: values.discountValue ?? null,
          discountOnQr: values.discountOnQr ?? null,
          discountOnKiosk: values.discountOnKiosk ?? null,
          discountOnSeatQr: values.discountOnSeatQr ?? null,
          discountOnCounter: values.discountOnCounter ?? null,
        }
      : {
          discountType: null,
          discountValue: null,
          discountOnQr: null,
          discountOnKiosk: null,
          discountOnSeatQr: null,
          discountOnCounter: null,
        };

    try {
      if (pricingId !== undefined) {
        const body: PutApiProductPricingIdBody = {
          basePrice: values.basePrice,
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
          dayOfWeek: values.dayOfWeek,
          basePrice: values.basePrice,
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

      // Two different 409s share this status and neither names a field: the
      // duplicate (cinema, product, day) arrives from UQ_product_pricing as "A
      // record with these values already exists", and the cross-tenant case as
      // "The cinema and product belong to different chains". The day is the
      // part of the key most likely to be the one that is wrong, so a duplicate
      // is pinned there.
      if (!isEdit && apiError.status === 409) {
        const field = apiError.message.toLowerCase().includes('different chains')
          ? 'productId'
          : 'dayOfWeek';

        form.setFields([{ name: field, errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  const cinemaLabel =
    key.cinemaId === undefined ? '-' : (cinemaNames?.get(key.cinemaId) ?? `#${key.cinemaId}`);
  const productLabel =
    key.productId === undefined ? '-' : (productNames?.get(key.productId) ?? `#${key.productId}`);

  /** A percentage cannot exceed 100; a flat amount is capped by the column. */
  const amountMax = discountType === 'P' ? 100 : 99999999.99;
  const amountSuffix = discountType === 'P' ? '%' : '';

  return (
    <Modal
      open={visible}
      title={isEdit ? 'Edit price' : 'New price'}
      okText={isEdit ? 'Save changes' : 'Create price'}
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || loadFailed }}
      width={720}
      centered
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Spin spinning={loading}>
        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
          disabled={submitting || loading || loadFailed}
          initialValues={{
            isActive: true,
            dayOfWeek: 0,
            cinemaId: defaultCinemaId,
            productId: defaultProductId,
          }}
        >
          {isEdit ? (
            <>
              <Form.Item
                label="Cinema"
                extra="The cinema, product and day cannot be changed after the price is created."
              >
                <Text>{cinemaLabel}</Text>
              </Form.Item>

              <Form.Item label="Product">
                <Text>{productLabel}</Text>
              </Form.Item>

              <Form.Item label="Day">
                <Text>{dayOfWeekLabel(key.dayOfWeek)}</Text>
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
                rules={[{ required: true, message: 'Choose a product' }]}
              >
                <ProductSelect />
              </Form.Item>

              <Form.Item
                name="dayOfWeek"
                label="Day"
                extra="One price per cinema, product and day. Cannot be changed afterwards."
                rules={[{ required: true, message: 'Choose a day' }]}
              >
                <Select options={DAY_OF_WEEK_OPTIONS} />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="basePrice"
            label="Base price"
            rules={[{ required: true, message: 'Enter a base price' }]}
          >
            <InputNumber min={0} max={99999999.99} precision={2} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="discountType"
            label="Discount type"
            extra="Governs every discount amount below. Clearing it clears them all."
          >
            <Select
              allowClear
              placeholder="No discount"
              options={[
                { value: 'P', label: 'Percentage' },
                { value: 'F', label: 'Flat amount' },
              ]}
            />
          </Form.Item>

          {discountType ? (
            <>
              <Form.Item
                name="discountValue"
                label="Default discount"
                extra="Applied where no channel-specific amount is set."
              >
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item name="discountOnQr" label="Discount on QR orders">
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item name="discountOnKiosk" label="Discount on kiosk orders">
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item name="discountOnSeatQr" label="Discount on seat QR orders">
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item name="discountOnCounter" label="Discount on counter orders">
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </>
          ) : null}

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
