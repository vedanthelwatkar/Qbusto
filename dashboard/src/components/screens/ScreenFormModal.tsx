/**
 * Create and edit a screen.
 *
 * One modal for both. Creating asks for the cinema; editing does not offer it,
 * because `cinemaId` cannot change - orders reference a screen, so moving one
 * between cinemas would rewrite the history of those orders. The spec has no
 * such field on the update body, and the cinema is shown as read-only text
 * instead so the form still says which one this screen belongs to.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Modal, Spin, Switch, Typography } from 'antd';

import type {
  PostApiScreensBody,
  PutApiScreensIdBody,
  Screen,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { toApiError } from '@/services/api';
import * as screensService from '@/services/screens.service';
import { fieldErrorsFrom } from '@/utils/validation';

const { Text } = Typography;

interface FormValues {
  cinemaId?: number;
  name: string;
  isActive: boolean;
}

interface ScreenFormModalProps {
  /** Omitted for a new screen. Only `id` is read - the rest is refetched. */
  screen?: Screen;
  /** Preselected on the create form when the list is already filtered to one cinema. */
  defaultCinemaId?: number;
  /** Cinema names by id, resolved by the page for the rows it is showing. */
  cinemaNames?: Map<number, string>;
  onClose: () => void;
  onSaved: () => void;
}

export default function ScreenFormModal({
  screen,
  defaultCinemaId,
  cinemaNames,
  onClose,
  onSaved,
}: ScreenFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const screenId = screen?.id;
  const isEdit = screenId !== undefined;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The cinema this screen belongs to, shown but not editable while editing. */
  const [cinemaId, setCinemaId] = useState<number | undefined>(screen?.cinemaId);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (screenId === undefined) return;

    let active = true;

    screensService
      .getScreen(screenId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          name: full.name,
          isActive: full.isActive !== false,
        });

        setCinemaId(full.cinemaId);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* screen, so submitting would write those over the one that
        // failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, screenId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      if (screenId !== undefined) {
        const body: PutApiScreensIdBody = {
          name: values.name,
          isActive: values.isActive,
        };

        await screensService.updateScreen(screenId, body);
        message.success('Screen updated');
      } else {
        const body: PostApiScreensBody = {
          // Required by the spec, and by the required rule on the field below.
          cinemaId: values.cinemaId as number,
          name: values.name,
          isActive: values.isActive,
        };

        await screensService.createScreen(body);
        message.success('Screen created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // Two different 409s share this status and neither names a field: "A
      // screen with this name already exists in this cinema", and "Cannot add
      // a screen to a deactivated cinema". Only the first belongs on a box,
      // and since both mention the cinema, the deactivated one is what has to
      // be matched.
      if (apiError.status === 409 && !apiError.message.toLowerCase().includes('deactivated')) {
        form.setFields([{ name: 'name', errors: [apiError.message] }]);
      }

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  const cinemaLabel = cinemaId === undefined ? '-' : (cinemaNames?.get(cinemaId) ?? `#${cinemaId}`);

  return (
    <Modal
      open={visible}
      title={isEdit ? `Edit ${screen?.name ?? 'screen'}` : 'New screen'}
      okText={isEdit ? 'Save changes' : 'Create screen'}
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
          initialValues={{ isActive: true, cinemaId: defaultCinemaId }}
        >
          {isEdit ? (
            <Form.Item label="Cinema" extra="Cannot be changed after the screen is created.">
              <Text>{cinemaLabel}</Text>
            </Form.Item>
          ) : (
            <Form.Item
              name="cinemaId"
              label="Cinema"
              extra="Cannot be changed after the screen is created."
              rules={[{ required: true, message: 'Choose a cinema' }]}
            >
              <CinemaSelect />
            </Form.Item>
          )}

          <Form.Item
            name="name"
            label="Name"
            extra="Unique within its cinema, counting deactivated screens."
            rules={[
              { required: true, message: 'Enter a name' },
              { max: 50, message: 'Use at most 50 characters' },
            ]}
          >
            <Input autoComplete="off" placeholder="Screen 1" />
          </Form.Item>

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
