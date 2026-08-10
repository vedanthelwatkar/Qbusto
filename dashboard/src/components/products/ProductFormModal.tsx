/**
 * Create and edit a product.
 *
 * One modal for both. There is no chain field on either: a product belongs to
 * the chain of its category, and the backend copies it from there rather than
 * accepting it, so offering one would be inventing a field the API rejects.
 *
 * The add-on parent is only asked for when the product is marked as an add-on,
 * and the choices exclude products that are themselves add-ons - the backend
 * refuses those with "An add-on cannot be the parent of another add-on".
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Modal, Spin, Switch } from 'antd';

import type {
  PostApiProductsBody,
  Product,
  PutApiProductsIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import CategorySelect from '@/components/categories/CategorySelect';
import AddonParentSelect from '@/components/products/AddonParentSelect';
import { toApiError } from '@/services/api';
import * as productsService from '@/services/products.service';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  categoryId: number;
  name: string;
  description?: string | null;
  weight?: string | null;
  imageUrl?: string | null;
  taxSlabCode?: string | null;
  isAddon: boolean;
  addonParentId?: number | null;
  isActive: boolean;
}

interface ProductFormModalProps {
  /** Omitted for a new product. Only `id` is read - the rest is refetched. */
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}

export default function ProductFormModal({ product, onClose, onSaved }: ProductFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const productId = product?.id;
  const isEdit = productId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  const isAddon = Form.useWatch('isAddon', form);

  useEffect(() => {
    if (productId === undefined) return;

    let active = true;

    productsService
      .getProduct(productId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          categoryId: full.categoryId as number,
          name: full.name,
          description: full.description,
          weight: full.weight,
          imageUrl: full.imageUrl,
          taxSlabCode: full.taxSlabCode,
          isAddon: full.isAddon === true,
          addonParentId: full.addonParentId,
          isActive: full.isActive !== false,
        });

        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* product, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, productId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    // Only meaningful for an add-on. Cleared otherwise so a product that was an
    // add-on and is not any more does not keep a dangling parent.
    const addonParentId = values.isAddon ? (values.addonParentId ?? null) : null;

    try {
      if (productId !== undefined) {
        const body: PutApiProductsIdBody = {
          categoryId: values.categoryId,
          name: values.name,
          description: values.description ?? null,
          weight: values.weight ?? null,
          imageUrl: values.imageUrl ?? null,
          taxSlabCode: values.taxSlabCode ?? null,
          isAddon: values.isAddon,
          addonParentId,
          isActive: values.isActive,
        };

        await productsService.updateProduct(productId, body);
        message.success('Product updated');
      } else {
        const body: PostApiProductsBody = {
          categoryId: values.categoryId,
          name: values.name,
          description: values.description ?? null,
          weight: values.weight ?? null,
          imageUrl: values.imageUrl ?? null,
          taxSlabCode: values.taxSlabCode ?? null,
          isAddon: values.isAddon,
          addonParentId,
          isActive: values.isActive,
        };

        await productsService.createProduct(body);
        message.success('Product created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // Three different 409s share this status and none names a field:
      //   "A product with this name already exists in this category"
      //   "The selected category belongs to a different chain"
      //   "The add-on parent belongs to a different chain"
      // The last two both mention a chain, so the parent has to be matched
      // first or its message lands on the category box.
      if (apiError.status === 409) {
        const message = apiError.message.toLowerCase();
        const field = message.includes('add-on parent')
          ? 'addonParentId'
          : message.includes('chain')
            ? 'categoryId'
            : 'name';

        form.setFields([{ name: field, errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={isEdit ? `Edit ${product?.name ?? 'product'}` : 'New product'}
      okText={isEdit ? 'Save changes' : 'Create product'}
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
          initialValues={{ isActive: true, isAddon: false }}
        >
          <Form.Item
            name="categoryId"
            label="Category"
            extra="The product's chain comes from its category."
            rules={[{ required: true, message: 'Choose a category' }]}
          >
            <CategorySelect />
          </Form.Item>

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
            name="weight"
            label="Weight"
            rules={[{ max: 50, message: 'Use at most 50 characters' }]}
          >
            <Input placeholder="150g" />
          </Form.Item>

          <Form.Item
            name="imageUrl"
            label="Image URL"
            rules={[{ max: 500, message: 'Use at most 500 characters' }]}
          >
            <Input placeholder="https://..." />
          </Form.Item>

          <Form.Item
            name="taxSlabCode"
            label="Tax slab code"
            rules={[{ max: 20, message: 'Use at most 20 characters' }]}
          >
            <Input placeholder="GST5" />
          </Form.Item>

          <Form.Item
            name="isAddon"
            label="Add-on"
            valuePropName="checked"
            extra="An add-on is ordered alongside another product rather than on its own."
          >
            <Switch />
          </Form.Item>

          {isAddon ? (
            <Form.Item
              name="addonParentId"
              label="Attaches to"
              extra="Only products that are not themselves add-ons can be a parent."
            >
              <AddonParentSelect excludeId={productId} />
            </Form.Item>
          ) : null}

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
