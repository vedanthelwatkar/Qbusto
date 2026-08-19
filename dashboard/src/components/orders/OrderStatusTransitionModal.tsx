/**
 * Order status transition.
 *
 * Offers only the moves the backend's transition graph allows from the order's
 * current status, so a control is never shown for a request that would be
 * rejected. The graph below mirrors the server's; the server remains the
 * authority and its 409 is surfaced verbatim if the two ever disagree — for
 * instance when another user moved the order while this modal was open.
 */

import { useState } from 'react';
import { Alert, App, Form, Input, Modal, Select, Typography } from 'antd';

import type {
  OrderDetail,
  OrderStatus,
  PutApiOrdersIdStatusBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

type StatusCode = PutApiOrdersIdStatusBody['status'];

interface OrderStatusTransitionModalProps {
  orderId: number;
  currentStatus: string;
  orderStatuses: OrderStatus[];
  onClose: () => void;
  /** Receives the updated order exactly as the server returned it. */
  onSuccess: (updated: OrderDetail) => void;
}

/**
 * Mirrors the fulfilment graph in the backend's fulfilment service.
 *
 * `rejected` is reachable from every live state. `delivered` and `rejected`
 * are terminal — reopening a finished order is not a concept the schema has.
 */
const VALID_TRANSITIONS: Record<string, StatusCode[]> = {
  initiated: ['confirmed', 'rejected'],
  confirmed: ['preparing', 'rejected'],
  preparing: ['ready', 'rejected'],
  ready: ['delivered', 'rejected'],
  delivered: [],
  rejected: [],
};

export default function OrderStatusTransitionModal({
  orderId,
  currentStatus,
  orderStatuses,
  onClose,
  onSuccess,
}: OrderStatusTransitionModalProps) {
  const { message } = App.useApp();

  const [nextStatus, setNextStatus] = useState<StatusCode | undefined>();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTransitions = VALID_TRANSITIONS[currentStatus] ?? [];
  const statusLabel = (code: string) =>
    orderStatuses.find((entry) => entry.code === code)?.name ?? code;

  const handleTransition = async () => {
    // Guards a second confirm while the first is in flight. antd's
    // confirmLoading disables the button, but a keyboard Enter can still
    // arrive before the re-render.
    if (!nextStatus || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const updated = await ordersService.updateOrderStatus(
        orderId,
        nextStatus,
        reason.trim() || undefined
      );
      message.success(`Order #${orderId} moved to ${statusLabel(nextStatus)}`);
      onSuccess(updated);
      onClose();
    } catch (caught) {
      // Stays open on failure with the message shown, so the user can adjust
      // and retry rather than losing what they had selected.
      setError(toApiError(caught).message);
      setSubmitting(false);
    }
  };

  const terminal = validTransitions.length === 0;

  return (
    <Modal
      title="Change order status"
      open
      onCancel={onClose}
      onOk={() => void handleTransition()}
      confirmLoading={submitting}
      okText="Confirm"
      okButtonProps={{ disabled: !nextStatus || terminal }}
      cancelButtonProps={{ disabled: submitting }}
      // Prevents dismissal mid-request, which would leave the user unsure
      // whether the change was applied.
      maskClosable={!submitting}
      closable={!submitting}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Typography.Paragraph type="secondary">
        Current status: <strong>{statusLabel(currentStatus)}</strong>
      </Typography.Paragraph>

      {terminal ? (
        <Alert
          type="info"
          showIcon
          message="No further changes are possible"
          description={`An order that is ${statusLabel(currentStatus).toLowerCase()} has reached the end of its lifecycle.`}
        />
      ) : (
        <Form layout="vertical">
          <Form.Item label="New status" required>
            <Select<StatusCode>
              placeholder="Select the new status"
              value={nextStatus}
              onChange={setNextStatus}
              disabled={submitting}
              options={validTransitions.map((code) => ({
                label: statusLabel(code),
                value: code,
              }))}
            />
          </Form.Item>

          <Form.Item label="Reason" help="Optional. Stored on the order's status history.">
            <Input.TextArea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              showCount
              rows={3}
              disabled={submitting}
              placeholder="e.g. Customer cancelled at the counter"
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
