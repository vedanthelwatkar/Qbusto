/**
 * Create and edit an offer (coupon).
 *
 * One modal for both. `cinemaId` cannot change once created - moving a coupon
 * between cinemas would drag its redemption history across a tenant boundary,
 * the same reason CategoryFormModal locks `chainId` on edit.
 *
 * `discountType` and `status` are free text columns on the backend, but the
 * values that actually mean something are the literal strings the product
 * decided on, so they are offered as a fixed choice here rather than a
 * free-text box that could silently typo its way into "Percentage" never
 * matching the case-insensitive "percentage" check.
 *
 * `paymentModes`/`offerCategory` existed only to mirror Cashfree's own offer
 * vocabulary from an abandoned integration design and were never read by any
 * calculation - the columns were dropped from the database entirely (see
 * `20260825000700-drop-unused-offer-fields.js`), so there is nothing left to
 * show here.
 *
 * `maxDiscAmount` only means anything for a `percentage` coupon - it caps
 * the percentage; a flat coupon is already a fixed amount, so the field is
 * shown or hidden as `discountType` changes, and cleared when it stops
 * applying so a stale value from a previous choice can't be silently
 * submitted.
 *
 * Mounted only while open, so each open starts from a clean form and a correct
 * initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Select, Spin } from 'antd';
import dayjs from 'dayjs';

import type {
  Offer,
  PostApiOffersBody,
  PutApiOffersIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { toApiError } from '@/services/api';
import * as offersService from '@/services/offers.service';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  cinemaId: number;
  code: string;
  name: string;
  discountType: string;
  description?: string | null;
  tnc?: string | null;
  status: string;
  discAmount: number;
  maxDiscAmount?: number | null;
  minTxnAmount?: number | null;
  maxTxnAmount?: number | null;
  maxTxnLimit?: number | null;
  validFrom?: dayjs.Dayjs | null;
  validUntil?: dayjs.Dayjs | null;
}

interface OfferFormModalProps {
  /** Omitted for a new offer. Only `id` is read - the rest is refetched. */
  offer?: Offer;
  onClose: () => void;
  onSaved: () => void;
}

export default function OfferFormModal({ offer, onClose, onSaved }: OfferFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const offerId = offer?.id;
  const isEdit = offerId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [visible, setVisible] = useState(true);

  const discountType = Form.useWatch('discountType', form);
  // Case-insensitive, matching coupon.service.js and OffersPage.tsx's own
  // table - an offer loaded from before discountType was normalised on write
  // (or created via a direct API call) may not be stored as exactly
  // lowercase "percentage".
  const isPercentage = String(discountType ?? '').toLowerCase() === 'percentage';

  useEffect(() => {
    if (offerId === undefined) return;

    let active = true;

    offersService
      .getOffer(offerId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          cinemaId: full.cinemaId,
          code: full.code,
          name: full.name,
          discountType: full.discountType,
          description: full.description,
          tnc: full.tnc,
          status: full.status,
          discAmount: full.discAmount,
          maxDiscAmount: full.maxDiscAmount,
          minTxnAmount: full.minTxnAmount,
          maxTxnAmount: full.maxTxnAmount,
          maxTxnLimit: full.maxTxnLimit,
          validFrom: full.validFrom ? dayjs(full.validFrom) : null,
          validUntil: full.validUntil ? dayjs(full.validUntil) : null,
        });

        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, offerId]);

  /** Not "percentage" any more - a flat coupon has no use for a cap on itself. */
  const handleDiscountTypeChange = (value: string) => {
    if (value !== 'percentage') {
      form.setFieldValue('maxDiscAmount', null);
    }
  };

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    const shared = {
      code: values.code,
      name: values.name,
      discountType: values.discountType,
      description: values.description ?? null,
      tnc: values.tnc ?? null,
      status: values.status,
      discAmount: values.discAmount,
      // Cleared on the way out too, in case a record loaded with an existing
      // value for a coupon that has since been switched away from percentage.
      // Case-insensitive - see the isPercentage watch above for why.
      maxDiscAmount:
        String(values.discountType ?? '').toLowerCase() === 'percentage'
          ? (values.maxDiscAmount ?? null)
          : null,
      minTxnAmount: values.minTxnAmount ?? null,
      maxTxnAmount: values.maxTxnAmount ?? null,
      maxTxnLimit: values.maxTxnLimit ?? null,
      validFrom: values.validFrom ? values.validFrom.toISOString() : null,
      validUntil: values.validUntil ? values.validUntil.toISOString() : null,
    };

    try {
      if (offerId !== undefined) {
        const body: PutApiOffersIdBody = shared;

        await offersService.updateOffer(offerId, body);
        message.success('Offer updated');
      } else {
        const body: PostApiOffersBody = { ...shared, cinemaId: values.cinemaId };

        await offersService.createOffer(body);
        message.success('Offer created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // A duplicate code within the cinema comes back as a 409, which names no
      // field - so it is pinned to the code box, the only thing it can be about.
      if (apiError.status === 409) {
        form.setFields([{ name: 'code', errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={isEdit ? `Edit ${offer?.code ?? 'offer'}` : 'New offer'}
      okText={isEdit ? 'Save changes' : 'Create offer'}
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || loadFailed }}
      width={640}
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
            status: 'active',
            discountType: 'flat',
          }}
        >
          {isEdit ? null : (
            <Form.Item
              name="cinemaId"
              label="Cinema"
              rules={[{ required: true, message: 'Select a cinema' }]}
              extra="Cannot be changed after the offer is created."
            >
              <CinemaSelect />
            </Form.Item>
          )}

          <Form.Item
            name="code"
            label="Coupon code"
            rules={[
              { required: true, message: 'Enter a coupon code' },
              { max: 50, message: 'Use at most 50 characters' },
            ]}
          >
            <Input autoComplete="off" style={{ textTransform: 'uppercase' }} />
          </Form.Item>

          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, message: 'Enter a name' },
              { max: 150, message: 'Use at most 150 characters' },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="discountType"
            label="Discount type"
            rules={[{ required: true, message: 'Select a discount type' }]}
            extra="Percentage applies to the cart subtotal, capped by the max discount below. Flat is a fixed rupee amount."
          >
            <Select
              onChange={handleDiscountTypeChange}
              options={[
                { value: 'flat', label: 'Flat amount' },
                { value: 'percentage', label: 'Percentage' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="discAmount"
            label="Discount amount"
            rules={[{ required: true, message: 'Enter a discount amount' }]}
            extra="Rupees for a flat coupon, or a percent (0-100) for a percentage coupon."
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          {/* Only meaningful for a percentage coupon - a flat coupon is
              already a fixed amount, so there is nothing here to cap. */}
          {isPercentage ? (
            <Form.Item
              name="maxDiscAmount"
              label="Max discount amount (₹)"
              extra="Caps the discount this percentage coupon can give. Leave blank for no cap."
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          ) : null}

          <Form.Item name="minTxnAmount" label="Minimum order value (₹)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="maxTxnAmount" label="Maximum order value (₹)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="maxTxnLimit"
            label="Redemption limit"
            extra="Total number of paid orders this coupon may be used on. Leave blank for unlimited."
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="validFrom" label="Valid from">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="validUntil" label="Valid until">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="status"
            label="Status"
            rules={[{ required: true, message: 'Select a status' }]}
          >
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
            rules={[{ max: 500, message: 'Use at most 500 characters' }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.Item
            name="tnc"
            label="Terms & conditions"
            rules={[{ max: 2000, message: 'Use at most 2000 characters' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
