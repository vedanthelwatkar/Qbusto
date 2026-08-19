/**
 * Create and edit a category.
 *
 * One modal for both. Creating adds a chain for owners; editing drops it,
 * because `chainId` cannot change - moving a category between chains would drag
 * its products across a tenant boundary.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Modal, Spin, Switch } from 'antd';

import type {
  Category,
  PostApiCategoriesBody,
  PutApiCategoriesIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import ChainSelect from '@/components/chains/ChainSelect';
import { toApiError } from '@/services/api';
import * as categoriesService from '@/services/categories.service';
import { useAuthStore } from '@/stores/auth.store';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  chainId?: number;
  isActive: boolean;
}

interface CategoryFormModalProps {
  /** Omitted for a new category. Only `id` is read - the rest is refetched. */
  category?: Category;
  onClose: () => void;
  onSaved: () => void;
}

export default function CategoryFormModal({ category, onClose, onSaved }: CategoryFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const categoryId = category?.id;
  const isEdit = categoryId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (categoryId === undefined) return;

    let active = true;

    categoriesService
      .getCategory(categoryId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          name: full.name,
          description: full.description,
          imageUrl: full.imageUrl,
          isActive: full.isActive !== false,
        });

        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* category, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, categoryId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      if (categoryId !== undefined) {
        const body: PutApiCategoriesIdBody = {
          name: values.name,
          description: values.description ?? null,
          imageUrl: values.imageUrl ?? null,
          isActive: values.isActive,
        };

        await categoriesService.updateCategory(categoryId, body);
        message.success('Category updated');
      } else {
        const body: PostApiCategoriesBody = {
          name: values.name,
          description: values.description ?? null,
          imageUrl: values.imageUrl ?? null,
          // Honoured for owners only; every other role creates inside its own
          // chain whatever is sent. Cleared means "omit the field", not "send
          // null" - the validator types this as a positive integer and would
          // reject a null with a 400 instead of defaulting to the actor's own
          // chain.
          chainId: values.chainId ?? undefined,
          isActive: values.isActive,
        };

        await categoriesService.createCategory(body);
        message.success('Category created');
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
      title={isEdit ? `Edit ${category?.name ?? 'category'}` : 'New category'}
      okText={isEdit ? 'Save changes' : 'Create category'}
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
          initialValues={{ isActive: true, chainId: actor?.chainId }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, message: 'Enter a name' },
              { max: 200, message: 'Use at most 200 characters' },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
            rules={[{ max: 4000, message: 'Use at most 4000 characters' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>

          <Form.Item
            name="imageUrl"
            label="Image URL"
            rules={[{ max: 500, message: 'Use at most 500 characters' }]}
          >
            <Input placeholder="https://..." />
          </Form.Item>

          {isEdit || actor?.role !== 'owner' ? null : (
            <Form.Item
              name="chainId"
              label="Chain"
              extra="Cannot be changed after the category is created."
            >
              <ChainSelect allowClear placeholder="Your own chain" />
            </Form.Item>
          )}

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
