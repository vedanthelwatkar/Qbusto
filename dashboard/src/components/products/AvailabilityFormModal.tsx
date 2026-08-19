/**
 * Add or edit one availability window.
 *
 * One modal for both. The cinema product is fixed either way: it is chosen in
 * the drawer behind this, and the spec leaves `cinemaProductId` off the update
 * body because a window belongs to the cinema it was created for.
 *
 * Unlike the other form modals this one does not refetch the row it is editing.
 * A window has four fields and the list returns all of them, so the row handed
 * in is already complete - refetching would add a request and a failure mode to
 * arrive at the same values.
 *
 * Mounted only while it is open, so each open starts from a clean form.
 */

import { useState } from 'react';
import { Alert, App, Form, Modal, Select, TimePicker, Typography } from 'antd';
import type { Dayjs } from 'dayjs';

import type {
  PostApiProductAvailabilityHoursBody,
  ProductAvailabilityHour,
  PutApiProductAvailabilityHoursIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { DAY_OF_WEEK_OPTIONS, dayOfWeekLabel } from '@/components/pricing/days';
import {
  LATE_NIGHT_HINT,
  TIME_FORMAT,
  parseTime,
  toApiTime,
  windowLabel,
} from '@/components/products/availabilityTime';
import { toApiError } from '@/services/api';
import * as availabilityService from '@/services/availability.service';
import { fieldErrorsFrom } from '@/utils/validation';

const { Text } = Typography;

interface FormValues {
  dayOfWeek: number;
  startTime: Dayjs;
  endTime: Dayjs;
}

/** The `details` on the backend's overlap 409. */
interface OverlapDetails {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}

function overlapDetails(details: unknown): OverlapDetails | null {
  if (typeof details !== 'object' || details === null) return null;

  const candidate = details as OverlapDetails;

  return typeof candidate.startTime === 'string' ? candidate : null;
}

interface AvailabilityFormModalProps {
  cinemaProductId: number;
  /** Omitted when adding. */
  hour?: ProductAvailabilityHour;
  /** Preselected when adding from a particular day's row. */
  defaultDayOfWeek?: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function AvailabilityFormModal({
  cinemaProductId,
  hour,
  defaultDayOfWeek,
  onClose,
  onSaved,
}: AvailabilityFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const hourId = hour?.id;
  const isEdit = hourId !== undefined;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    const times = {
      startTime: toApiTime(values.startTime),
      endTime: toApiTime(values.endTime),
    };

    try {
      if (hourId !== undefined) {
        // Both times go on every update: the backend requires the whole range,
        // because checking one new time against one stored time is not a check
        // worth trusting.
        const body: PutApiProductAvailabilityHoursIdBody = {
          dayOfWeek: values.dayOfWeek,
          ...times,
        };

        await availabilityService.updateAvailabilityHour(hourId, body);
        message.success('Availability updated');
      } else {
        const body: PostApiProductAvailabilityHoursBody = {
          cinemaProductId,
          dayOfWeek: values.dayOfWeek,
          ...times,
        };

        await availabilityService.createAvailabilityHour(body);
        message.success('Availability added');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      // The backend names `startTime`, `endTime` and `dayOfWeek` in its 400s,
      // and this form uses those names, so they land on the fields directly.
      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      // The overlap 409 names no field - it describes the window already there.
      // Saying which one it is turns "that clashes" into something the user can
      // act on, and it is pinned to the times because they are what has to
      // move.
      let text = apiError.message;

      if (apiError.status === 409) {
        const clash = overlapDetails(apiError.details);

        if (clash) {
          text = `${apiError.message}: ${dayOfWeekLabel(clash.dayOfWeek)} ${windowLabel(
            clash.startTime,
            clash.endTime
          )}.`;
        }

        form.setFields([
          { name: 'startTime', errors: [text] },
          { name: 'endTime', errors: [] },
        ]);
      }

      setError(text);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={isEdit ? 'Edit availability' : 'Add availability'}
      okText={isEdit ? 'Save changes' : 'Add window'}
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      width={520}
      centered
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={handleSubmit}
        disabled={submitting}
        initialValues={{
          dayOfWeek: hour?.dayOfWeek ?? defaultDayOfWeek ?? 0,
          startTime: parseTime(hour?.startTime) ?? undefined,
          endTime: parseTime(hour?.endTime) ?? undefined,
        }}
      >
        <Form.Item
          name="dayOfWeek"
          label="Day"
          extra="Every day covers all seven, and cannot overlap a window on any single day."
          rules={[{ required: true, message: 'Choose a day' }]}
        >
          <Select options={DAY_OF_WEEK_OPTIONS} />
        </Form.Item>

        <Form.Item
          name="startTime"
          label="Starts at"
          rules={[{ required: true, message: 'Choose a start time' }]}
        >
          <TimePicker format={TIME_FORMAT} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="endTime"
          label="Ends at"
          dependencies={['startTime']}
          rules={[
            { required: true, message: 'Choose an end time' },
            // The same rule the backend enforces, checked here only so the
            // common mistake is answered without a round trip. The backend
            // remains the authority.
            ({ getFieldValue }) => ({
              validator(_rule, value: Dayjs | null) {
                const startTime = getFieldValue('startTime') as Dayjs | null;

                if (!value || !startTime || value.isAfter(startTime)) {
                  return Promise.resolve();
                }

                return Promise.reject(new Error(LATE_NIGHT_HINT));
              },
            }),
          ]}
        >
          <TimePicker format={TIME_FORMAT} style={{ width: '100%' }} />
        </Form.Item>

        <Text type="secondary">{LATE_NIGHT_HINT}</Text>
      </Form>
    </Modal>
  );
}
