/**
 * Set (or replace) one cinema's Cashfree credentials.
 *
 * There is no "edit in place": every submit here is a full replace - the
 * previous active row is deactivated and a new one created, matching how the
 * backend itself models a credential change (see
 * services/paymentgatewayconfig.service's header note). `secretKey` is
 * therefore always required, even when a config already exists: a Cashfree
 * secret cannot be read back to prefill the form, so there is nothing to
 * "keep unchanged" - the operator must paste it again to change anything.
 *
 * Mounted only while open, matching every other modal in this app.
 */

import { useState } from 'react';
import { Alert, App, Form, Input, Modal, Select } from 'antd';

import type { PutApiPaymentGatewayConfigBody } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as gatewayConfigService from '@/services/paymentGatewayConfig.service';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  gatewayId: string;
  secretKey: string;
  environment: 'test' | 'production';
}

interface CinemaPaymentGatewayModalProps {
  cinemaId: number;
  cinemaName: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function CinemaPaymentGatewayModal({
  cinemaId,
  cinemaName,
  onClose,
  onSaved,
}: CinemaPaymentGatewayModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      const body: PutApiPaymentGatewayConfigBody = { cinemaId, ...values };
      await gatewayConfigService.setCredentials(body);
      message.success('Cashfree credentials saved');
      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);
      form.setFields(fieldErrorsFrom<FormValues>(apiError));
      setError(apiError.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={`Cashfree credentials · ${cinemaName}`}
      okText="Save credentials"
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      width={480}
      centered
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Alert
        type="info"
        showIcon
        className="form-alert"
        message="Only this cinema's checkout uses these credentials. They are encrypted before they are stored and are never shown again once saved."
      />

      <Form<FormValues>
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        disabled={submitting}
        initialValues={{ environment: 'test' }}
      >
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
          extra="Write-only: this cannot be viewed again after saving, only replaced."
        >
          <Input.Password autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="environment"
          label="Environment"
          rules={[{ required: true, message: 'Select an environment' }]}
          extra="Must match which kind of credentials these are. A production deploy pointed at sandbox credentials looks healthy but takes no real money."
        >
          <Select
            options={[
              { value: 'test', label: 'Test (sandbox)' },
              { value: 'production', label: 'Production (real money)' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
