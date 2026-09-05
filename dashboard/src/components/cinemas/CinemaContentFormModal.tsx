/**
 * Edit one cinema's About Cinema / Terms & Conditions footer content.
 *
 * ONE FORM, TWO SECTIONS, ONE SAVE
 *
 * `contactNo`/`mailId` are the only fields this table adds - the cinema's
 * name, GST and FSSAI numbers already exist on the cinema itself and are
 * edited from CinemaFormModal, not duplicated here.
 *
 * TERMS & CONDITIONS IS A FREE-FORM LIST, ADDED/REMOVED ONE POINT AT A TIME
 *
 * `Form.List` renders exactly what the backend stores: an ordered array of
 * strings. Saving sends the WHOLE list, in the order shown - there is no
 * partial update, matching how `tncPoints` is stored (see the migration's
 * header note on why it is one JSON column, not a child table).
 *
 * Mounted only while open, matching every other modal in this app.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Button, Divider, Form, Input, Modal, Space, Spin, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';

import { toApiError } from '@/services/api';
import * as cinemasService from '@/services/cinemas.service';
import ImageField from '@/components/ImageField';

const { Text } = Typography;

const MAX_POINTS = 40;
const MAX_POINT_LENGTH = 500;

interface CinemaContentFormModalProps {
  cinemaId: number;
  cinemaName: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  contactNo?: string | null;
  mailId?: string | null;
  tncPoints: string[];
  iconUrl?: string | null;
}

export default function CinemaContentFormModal({
  cinemaId,
  cinemaName,
  onClose,
  onSaved,
}: CinemaContentFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent from `afterClose`, so the animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    cinemasService
      .getCinemaContent(cinemaId)
      .then((content) => {
        if (!active) return;

        form.setFieldsValue({
          contactNo: content.contactNo ?? null,
          mailId: content.mailId ?? null,
          tncPoints: content.tncPoints ?? [],
          iconUrl: content.iconUrl ?? null,
        });
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cinemaId, form]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      await cinemasService.saveCinemaContent(cinemaId, {
        contactNo: values.contactNo || null,
        mailId: values.mailId || null,
        tncPoints: (values.tncPoints ?? []).filter((point) => point && point.trim() !== ''),
        iconUrl: values.iconUrl || null,
      });

      message.success('About & Terms saved');
      onSaved();
      setVisible(false);
    } catch (caught) {
      setError(toApiError(caught).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={`About & Terms - ${cinemaName}`}
      okText="Save changes"
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading }}
      width={640}
      centered
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Spin spinning={loading}>
        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          disabled={submitting || loading}
          initialValues={{ tncPoints: [] }}
        >
          <Divider titlePlacement="start" plain>
            About Cinema
          </Divider>

          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Shown alongside the cinema&apos;s name, GST and FSSAI numbers, which are edited from the
            cinema&apos;s own details.
          </Text>

          <Form.Item name="contactNo" label="Contact number">
            <Input maxLength={20} placeholder="9999999999" />
          </Form.Item>

          <Form.Item
            name="mailId"
            label="Mail ID"
            rules={[{ type: 'email', message: 'Enter a valid email address' }]}
          >
            <Input maxLength={255} placeholder="contactus@example.com" />
          </Form.Item>

          <Form.Item
            name="iconUrl"
            label="Custom icon"
            rules={[{ max: 1024, message: 'Icon URL must be under 1024 characters' }]}
          >
            <ImageField entity="cinemas" />
          </Form.Item>

          <Divider titlePlacement="start" plain>
            Terms &amp; Conditions
          </Divider>

          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Shown as a numbered list on the Consumer app. Add, reorder by editing, or remove a point
            - the whole list is saved together.
          </Text>

          <Form.List name="tncPoints">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="baseline"
                    style={{ display: 'flex', width: '100%' }}
                  >
                    <Form.Item
                      {...field}
                      style={{ flex: 1, marginBottom: 8 }}
                      rules={[
                        {
                          max: MAX_POINT_LENGTH,
                          message: `Keep each point under ${MAX_POINT_LENGTH} characters`,
                        },
                      ]}
                    >
                      <Input placeholder="e.g. Once ordered, items cannot be cancelled or exchanged." />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}

                {fields.length < MAX_POINTS ? (
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="dashed" onClick={() => add('')} block icon={<PlusOutlined />}>
                      Add a point
                    </Button>
                  </Form.Item>
                ) : null}
              </>
            )}
          </Form.List>
        </Form>
      </Spin>
    </Modal>
  );
}
