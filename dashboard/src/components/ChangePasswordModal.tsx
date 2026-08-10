/**
 * Change your own password.
 *
 * The minimum length matches the backend rule so the obvious mistake is caught
 * before a round trip - the server still validates, and its message wins when
 * the two disagree.
 */

import { useState } from 'react';
import { Alert, App, Form, Input, Modal } from 'antd';

import { changePassword } from '@/services/auth.service';
import { toApiError } from '@/services/api';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    form.resetFields();
    setError(null);
    onClose();
  };

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success('Password changed');
      close();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Change password"
      okText="Change password"
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={submitting}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Form form={form} layout="vertical" requiredMark={false} onFinish={handleSubmit}>
        <Form.Item
          name="currentPassword"
          label="Current password"
          rules={[{ required: true, message: 'Enter your current password' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="New password"
          rules={[
            { required: true, message: 'Enter a new password' },
            { min: 8, message: 'Use at least 8 characters' },
            { max: 72, message: 'Use at most 72 characters' },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Confirm new password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Repeat the new password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('The two passwords do not match'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
