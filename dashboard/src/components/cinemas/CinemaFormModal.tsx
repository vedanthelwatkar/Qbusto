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
 * PAYMENT GATEWAY CREDENTIALS
 *
 * Mandatory on creation - `POST /api/cinemas` creates the cinema and its
 * `payment_gateway_config` row together, in one backend transaction, so a
 * cinema is never left able to take orders but not payment. There is no
 * "edit in place" for a secret that already exists (it cannot be read back
 * to prefill a field), so the edit form shows the current credential's
 * status only and offers a "Replace credentials" action that reuses the
 * same `CinemaPaymentGatewayModal` the cinema details drawer already uses -
 * a completely separate save from the cinema's own fields, so changing an
 * address never requires re-entering a secret, and vice versa.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';

import DetailsSkeleton from '@/components/DetailsSkeleton';
import dayjs, { type Dayjs } from 'dayjs';

import type {
  Cinema,
  PaymentGatewayConfig,
  PostApiCinemasBody,
  PutApiCinemasIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import ChainSelect from '@/components/chains/ChainSelect';
import CinemaPaymentGatewayModal from '@/components/cinemas/CinemaPaymentGatewayModal';
import ImageField from '@/components/ImageField';
import { toApiError } from '@/services/api';
import * as cinemasService from '@/services/cinemas.service';
import * as gatewayConfigService from '@/services/paymentGatewayConfig.service';
import { useAuthStore } from '@/stores/auth.store';
import { fieldErrorsFrom } from '@/utils/validation';

const { Text } = Typography;

interface FormValues {
  chainId?: number;
  code: string;
  name: string;
  location?: string | null;
  city?: string | null;
  gstNumber?: string | null;
  fssaiNumber?: string | null;
  screensaverUrl?: string | null;
  activeSince?: Dayjs | null;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  isActive: boolean;
  gatewayId: string;
  secretKey: string;
  environment: 'test' | 'production';
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

  // Edit mode only: the existing credential's status, never its secret - see
  // this file's header note on why replacing one is a separate action.
  const [gatewayConfig, setGatewayConfig] = useState<PaymentGatewayConfig | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(isEdit);
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [gatewayRefreshKey, setGatewayRefreshKey] = useState(0);

  useEffect(() => {
    if (cinemaId === undefined) return;

    let active = true;

    gatewayConfigService
      .getActiveConfig({ cinemaId })
      .then((loaded) => {
        if (active) setGatewayConfig(loaded);
      })
      .catch(() => {
        // Shown as "not configured" rather than an error banner: the cinema
        // form itself is still fully usable either way, and the drawer's own
        // "Payment gateway" section is the authoritative place to diagnose a
        // load failure.
        if (active) setGatewayConfig(null);
      })
      .finally(() => {
        if (active) setGatewayLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cinemaId, gatewayRefreshKey]);

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
          screensaverUrl: full.screensaverUrl,
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

        // Sent only when it actually changed. Omitting the key is what tells
        // the backend to keep the current artwork; sending the unchanged value
        // would be harmless but sending null would clear it.
        if (form.isFieldTouched('screensaverUrl')) {
          body.screensaverUrl = values.screensaverUrl ?? null;
        }

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
          // Required by the API on create - see the Form.Item's own rule.
          screensaverUrl: values.screensaverUrl ?? '',
          activeSince,
          smsEnabled: values.smsEnabled,
          whatsappEnabled: values.whatsappEnabled,
          isActive: values.isActive,
          gatewayId: values.gatewayId,
          secretKey: values.secretKey,
          environment: values.environment,
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
          onFinish={handleSubmit}
          disabled={submitting || loading || loadFailed}
          initialValues={{
            isActive: true,
            smsEnabled: false,
            whatsappEnabled: false,
            chainId: actor?.chainId,
            environment: 'test',
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

          {/*
            Required when creating, optional when editing - the same split the
            gateway credentials use. A cinema that predates the field has none,
            and forcing one on every future edit would block unrelated changes;
            leaving the field untouched keeps the artwork already on file.
          */}
          <Form.Item
            name="screensaverUrl"
            label="Screensaver"
            extra={
              isEdit
                ? 'Shown full-screen in the Consumer app before a customer starts an order. Leave as-is to keep the current image.'
                : 'Shown full-screen in the Consumer app before a customer starts an order.'
            }
            rules={[
              ...(isEdit ? [] : [{ required: true, message: 'Choose a screensaver image' }]),
              { max: 500, message: 'Use at most 500 characters' },
            ]}
          >
            <ImageField entity="cinemas" />
          </Form.Item>

          <Typography.Title level={5} style={{ marginTop: 8 }}>
            Payment gateway
          </Typography.Title>

          {isEdit ? (
            <div style={{ marginBottom: 24 }}>
              {gatewayLoading ? (
                <DetailsSkeleton rows={1} />
              ) : (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Status">
                    {gatewayConfig ? (
                      <Tag color="success">Configured</Tag>
                    ) : (
                      <Tag>Not configured</Tag>
                    )}
                  </Descriptions.Item>
                  {gatewayConfig ? (
                    <>
                      <Descriptions.Item label="APP ID">
                        <Text copyable>{gatewayConfig.gatewayId}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Environment">
                        <Tag color={gatewayConfig.environment === 'production' ? 'red' : 'default'}>
                          {gatewayConfig.environment}
                        </Tag>
                      </Descriptions.Item>
                    </>
                  ) : (
                    <Descriptions.Item label="Note">
                      <Text type="secondary">
                        Checkout falls back to the deployment&apos;s global Cashfree credentials, if
                        any are configured.
                      </Text>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              )}

              <Button
                size="small"
                style={{ marginTop: 12 }}
                onClick={() => setGatewayModalOpen(true)}
              >
                {gatewayConfig ? 'Replace credentials' : 'Set up credentials'}
              </Button>
            </div>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                className="form-alert"
                message="Required to take payment for this cinema. Encrypted before storage and never shown again once saved."
              />

              <Form.Item
                name="gatewayId"
                label="APP ID"
                rules={[
                  { required: true, message: "Enter Cashfree's APP_ID" },
                  { max: 255, message: 'Use at most 255 characters' },
                ]}
              >
                <Input autoComplete="off" />
              </Form.Item>

              <Form.Item
                name="secretKey"
                label="Secret key"
                rules={[
                  { required: true, message: "Enter Cashfree's SECRET_KEY" },
                  { max: 500, message: 'Use at most 500 characters' },
                ]}
              >
                <Input.Password autoComplete="off" />
              </Form.Item>

              <Form.Item
                name="environment"
                label="Environment"
                rules={[{ required: true, message: 'Select an environment' }]}
                extra="A production deploy pointed at test credentials looks healthy but takes no real money."
              >
                <Select
                  options={[
                    { value: 'test', label: 'Test (sandbox)' },
                    { value: 'production', label: 'Production (real money)' },
                  ]}
                />
              </Form.Item>
            </>
          )}

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

      {gatewayModalOpen && cinemaId !== undefined ? (
        <CinemaPaymentGatewayModal
          cinemaId={cinemaId}
          cinemaName={cinema?.name ?? 'this cinema'}
          onClose={() => setGatewayModalOpen(false)}
          onSaved={() => {
            setGatewayLoading(true);
            setGatewayRefreshKey((n) => n + 1);
          }}
        />
      ) : null}
    </Modal>
  );
}
