/**
 * Create and edit a chain.
 *
 * One modal for both. Creating is offered to owners only - not a frontend rule
 * but the backend's: every other role is pinned to their own chain by tenant
 * scope, so a chain they created would be a row they could never read back, and
 * chain.service refuses it outright.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Modal, Spin, Switch } from 'antd';

import type {
  Chain,
  PostApiChainsBody,
  PutApiChainsIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as chainsService from '@/services/chains.service';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  name: string;
  logoImageUrl?: string | null;
  isActive: boolean;
}

interface ChainFormModalProps {
  /** Omitted for a new chain. Only `id` is read - the rest is refetched. */
  chain?: Chain;
  onClose: () => void;
  onSaved: () => void;
}

export default function ChainFormModal({ chain, onClose, onSaved }: ChainFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const chainId = chain?.id;
  const isEdit = chainId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (chainId === undefined) return;

    let active = true;

    chainsService
      .getChain(chainId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          name: full.name,
          logoImageUrl: full.logoImageUrl,
          isActive: full.isActive !== false,
        });

        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* chain, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, chainId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      if (chainId !== undefined) {
        const body: PutApiChainsIdBody = {
          name: values.name,
          logoImageUrl: values.logoImageUrl ?? null,
          isActive: values.isActive,
        };

        await chainsService.updateChain(chainId, body);
        message.success('Chain updated');
      } else {
        const body: PostApiChainsBody = {
          name: values.name,
          logoImageUrl: values.logoImageUrl ?? null,
          isActive: values.isActive,
        };

        await chainsService.createChain(body);
        message.success('Chain created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // A duplicate name comes back as a 409, which names no field - so it is
      // pinned to the name box, which is the only thing it can be about.
      if (apiError.status === 409) {
        form.setFields([{ name: 'name', errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={isEdit ? `Edit ${chain?.name ?? 'chain'}` : 'New chain'}
      okText={isEdit ? 'Save changes' : 'Create chain'}
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
          requiredMark={false}
          onFinish={handleSubmit}
          disabled={submitting || loading || loadFailed}
          initialValues={{ isActive: true }}
        >
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
            name="logoImageUrl"
            label="Logo URL"
            rules={[{ max: 500, message: 'Use at most 500 characters' }]}
          >
            <Input placeholder="https://..." />
          </Form.Item>

          <Form.Item
            name="isActive"
            label="Active"
            valuePropName="checked"
            extra="Deactivating a chain does not deactivate its cinemas, users, categories or products."
          >
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
