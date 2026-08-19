/**
 * Create and edit a banner.
 *
 * One row carries one image, so a cinema shows several banners by holding
 * several rows and `sequence` decides the order they appear in. It is unique
 * within a cinema, and a sequence freed by a deactivated banner stays reserved,
 * so the backend can refuse a number that nothing visible is using.
 *
 * Creating asks for the cinema; editing does not offer it, because `cinemaId`
 * cannot change - moving a banner would sidestep the target cinema's sequence
 * rule. The spec has no such field on the update body, and the cinema is shown
 * as read-only text instead.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';

import type {
  Banner,
  PostApiBannersBody,
  PostApiBannersBodyType,
  PutApiBannersIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { toApiError } from '@/services/api';
import * as bannersService from '@/services/banners.service';
import { fieldErrorsFrom } from '@/utils/validation';

const { Text } = Typography;

interface FormValues {
  cinemaId?: number;
  imageUrl: string;
  type: PostApiBannersBodyType;
  sequence: number;
  startDate?: Dayjs | null;
  endDate?: Dayjs | null;
  isActive: boolean;
}

interface BannerFormModalProps {
  /** Omitted for a new banner. Only `id` is read - the rest is refetched. */
  banner?: Banner;
  /** Preselected on the create form when the list is already filtered to one cinema. */
  defaultCinemaId?: number;
  /** Cinema names by id, resolved by the page for the rows it is showing. */
  cinemaNames?: Map<number, string>;
  onClose: () => void;
  onSaved: () => void;
}

export default function BannerFormModal({
  banner,
  defaultCinemaId,
  cinemaNames,
  onClose,
  onSaved,
}: BannerFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const bannerId = banner?.id;
  const isEdit = bannerId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The cinema this banner belongs to, shown but not editable while editing. */
  const [cinemaId, setCinemaId] = useState<number | undefined>(banner?.cinemaId);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (bannerId === undefined) return;

    let active = true;

    bannersService
      .getBanner(bannerId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          imageUrl: full.imageUrl,
          type: full.type,
          sequence: full.sequence,
          startDate: full.startDate ? dayjs(full.startDate) : null,
          endDate: full.endDate ? dayjs(full.endDate) : null,
          isActive: full.isActive !== false,
        });

        setCinemaId(full.cinemaId);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* banner, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, bannerId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    // The spec types both ends as a date-time, so a picked moment is sent as a
    // full instant rather than a bare date.
    const startDate = values.startDate ? values.startDate.toISOString() : null;
    const endDate = values.endDate ? values.endDate.toISOString() : null;

    try {
      if (bannerId !== undefined) {
        const body: PutApiBannersIdBody = {
          imageUrl: values.imageUrl,
          type: values.type,
          sequence: values.sequence,
          startDate,
          endDate,
          isActive: values.isActive,
        };

        await bannersService.updateBanner(bannerId, body);
        message.success('Banner updated');
      } else {
        const body: PostApiBannersBody = {
          // Required by the spec, and by the required rule on the field below.
          cinemaId: values.cinemaId as number,
          imageUrl: values.imageUrl,
          type: values.type,
          sequence: values.sequence,
          startDate,
          endDate,
          isActive: values.isActive,
        };

        await bannersService.createBanner(body);
        message.success('Banner created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      // Covers the backend's own date check, which compares a one-sided update
      // against the stored value of the other end and names `endDate`.
      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // Only on create, and only for the cinema: while editing, a 404 is about
      // the banner itself and names no field on this form.
      if (!isEdit && apiError.status === 404) {
        form.setFields([{ name: 'cinemaId', errors: [apiError.message] }]);
      }

      // Two different 409s share this status: "A banner with this sequence
      // already exists in this cinema", and "Cannot add a banner to a
      // deactivated cinema". Only the first belongs on a box, and since both
      // mention the cinema, the deactivated one is what has to be matched.
      if (apiError.status === 409 && !apiError.message.toLowerCase().includes('deactivated')) {
        form.setFields([{ name: 'sequence', errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  const cinemaLabel = cinemaId === undefined ? '-' : (cinemaNames?.get(cinemaId) ?? `#${cinemaId}`);

  return (
    <Modal
      open={visible}
      title={isEdit ? 'Edit banner' : 'New banner'}
      okText={isEdit ? 'Save changes' : 'Create banner'}
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
          initialValues={{ isActive: true, type: 'H', sequence: 0, cinemaId: defaultCinemaId }}
        >
          {isEdit ? (
            <Form.Item label="Cinema" extra="Cannot be changed after the banner is created.">
              <Text>{cinemaLabel}</Text>
            </Form.Item>
          ) : (
            <Form.Item
              name="cinemaId"
              label="Cinema"
              extra="Cannot be changed after the banner is created. The cinema must be active."
              rules={[{ required: true, message: 'Choose a cinema' }]}
            >
              <CinemaSelect />
            </Form.Item>
          )}

          <Form.Item
            name="imageUrl"
            label="Image URL"
            extra="One banner carries one image. Add another row to show a second."
            rules={[
              { required: true, message: 'Enter an image URL' },
              { max: 500, message: 'Use at most 500 characters' },
            ]}
          >
            <Input placeholder="https://..." />
          </Form.Item>

          <Form.Item
            name="type"
            label="Placement"
            rules={[{ required: true, message: 'Choose a placement' }]}
          >
            <Select
              options={[
                { value: 'H', label: 'Header' },
                { value: 'I', label: 'Inner' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="sequence"
            label="Sequence"
            extra="Display order, low to high. Unique within the cinema, counting deactivated banners."
            rules={[{ required: true, message: 'Enter a sequence' }]}
          >
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="startDate"
            label="Starts"
            extra="Leave both empty for a banner with no scheduled window."
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="endDate" label="Ends">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
