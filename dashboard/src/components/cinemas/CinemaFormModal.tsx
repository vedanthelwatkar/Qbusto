/**
 * Create and edit a cinema.
 *
 * One modal for both. Creating adds a chain for owners; editing drops it,
 * because `chainId` cannot change - moving a cinema between chains would carry
 * its screens, orders and pricing across a tenant boundary. The spec has no
 * such field on the update body, so the form does not offer one.
 *
 * `code` appears in QR ordering URLs, is stored upper case and is unique across
 * the whole system, so it is upper-cased as it is typed rather than being
 * rejected afterwards.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, DatePicker, Form, Input, Modal, Spin, Switch } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';

import type {
  Cinema,
  PostApiCinemasBody,
  PutApiCinemasIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import ChainSelect from '@/components/chains/ChainSelect';
import { toApiError } from '@/services/api';
import * as cinemasService from '@/services/cinemas.service';
import { useAuthStore } from '@/stores/auth.store';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  chainId?: number;
  code: string;
  name: string;
  location?: string | null;
  city?: string | null;
  gstNumber?: string | null;
  fssaiNumber?: string | null;
  activeSince?: Dayjs | null;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  isActive: boolean;
}

interface CinemaFormModalProps {
  /** Omitted for a new cinema. Only `id` is read - the rest is refetched. */
  cinema?: Cinema;
  onClose: () => void;
  onSaved: () => void;
}

export default function CinemaFormModal({ cinema, onClose, onSaved }: CinemaFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const cinemaId = cinema?.id;
  const isEdit = cinemaId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (cinemaId === undefined) return;

    let active = true;

    cinemasService
      .getCinema(cinemaId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          code: full.code,
          name: full.name,
          location: full.location,
          city: full.city,
          gstNumber: full.gstNumber,
          fssaiNumber: full.fssaiNumber,
          activeSince: full.activeSince ? dayjs(full.activeSince) : null,
          smsEnabled: full.smsEnabled === true,
          whatsappEnabled: full.whatsappEnabled === true,
          isActive: full.isActive !== false,
        });

        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* cinema, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, cinemaId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    // The spec types this as a date-time, so a picked day is sent as a full
    // instant rather than a bare date.
    const activeSince = values.activeSince ? values.activeSince.toISOString() : null;

    try {
      if (cinemaId !== undefined) {
        const body: PutApiCinemasIdBody = {
          code: values.code,
          name: values.name,
          location: values.location ?? null,
          city: values.city ?? null,
          gstNumber: values.gstNumber ?? null,
          fssaiNumber: values.fssaiNumber ?? null,
          activeSince,
          smsEnabled: values.smsEnabled,
          whatsappEnabled: values.whatsappEnabled,
          isActive: values.isActive,
        };

        await cinemasService.updateCinema(cinemaId, body);
        message.success('Cinema updated');
      } else {
        const body: PostApiCinemasBody = {
          // Honoured for owners only; every other role creates inside its own
          // chain whatever is sent. Cleared means "omit the field", not "send
          // null" - the validator types this as a positive integer and would
          // reject a null with a 400 instead of defaulting to the actor's own
          // chain.
          chainId: values.chainId ?? undefined,
          code: values.code,
          name: values.name,
          location: values.location ?? null,
          city: values.city ?? null,
          gstNumber: values.gstNumber ?? null,
          fssaiNumber: values.fssaiNumber ?? null,
          activeSince,
          smsEnabled: values.smsEnabled,
          whatsappEnabled: values.whatsappEnabled,
          isActive: values.isActive,
        };

        await cinemasService.createCinema(body);
        message.success('Cinema created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // Two different 409s share this status: a duplicate code, which arrives
      // from the UQ_cinemas_code constraint as "A record with these values
      // already exists", and "Cannot add a cinema to a deactivated chain".
      // Only the first belongs on a box.
      if (apiError.status === 409 && !apiError.message.toLowerCase().includes('deactivated')) {
        form.setFields([{ name: 'code', errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={isEdit ? `Edit ${cinema?.name ?? 'cinema'}` : 'New cinema'}
      okText={isEdit ? 'Save changes' : 'Create cinema'}
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
            smsEnabled: false,
            whatsappEnabled: false,
            chainId: actor?.chainId,
          }}
        >
          {isEdit || actor?.role !== 'owner' ? null : (
            <Form.Item
              name="chainId"
              label="Chain"
              extra="Cannot be changed after the cinema is created."
            >
              <ChainSelect allowClear placeholder="Your own chain" />
            </Form.Item>
          )}

          <Form.Item
            name="code"
            label="Code"
            extra="Appears in QR ordering URLs. Upper case letters, digits and hyphens; unique system-wide."
            normalize={(value: string | undefined) => value?.toUpperCase()}
            rules={[
              { required: true, message: 'Enter a code' },
              { min: 2, message: 'Use at least 2 characters' },
              { max: 10, message: 'Use at most 10 characters' },
              {
                pattern: /^[A-Z0-9-]+$/,
                message: 'Use only letters, digits and hyphens',
              },
            ]}
          >
            <Input autoComplete="off" placeholder="PVR-01" />
          </Form.Item>

          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, message: 'Enter a name' },
              { min: 2, message: 'Use at least 2 characters' },
              { max: 100, message: 'Use at most 100 characters' },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="location"
            label="Location"
            rules={[{ max: 255, message: 'Use at most 255 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="city"
            label="City"
            rules={[{ max: 100, message: 'Use at most 100 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="gstNumber"
            label="GST number"
            rules={[{ max: 50, message: 'Use at most 50 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="fssaiNumber"
            label="FSSAI number"
            rules={[{ max: 50, message: 'Use at most 50 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item name="activeSince" label="Active since">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="smsEnabled" label="SMS notifications" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="whatsappEnabled" label="WhatsApp notifications" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item
            name="isActive"
            label="Active"
            valuePropName="checked"
            extra="Deactivating a cinema does not deactivate its screens."
          >
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
