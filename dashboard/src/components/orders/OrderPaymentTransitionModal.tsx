/**
 * Payment status transition.
 *
 * This is the staff-operated payment path: cash taken at the counter, a refund
 * granted, a failed attempt written off. It sends no gateway identifiers and
 * performs no Razorpay verification or reconciliation — those belong to the
 * backend, which is the only authority on what a payment actually did.
 *
 * The transitions offered mirror the backend's payment graph, so a control is
 * never shown for a request the server would reject.
 */

import { useState } from 'react';
import { Alert, App, Form, Input, Modal, Select, Typography } from 'antd';

import type {
  OrderDetail,
  OrderStatus,
  PutApiOrdersIdPaymentStatusBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

type PaymentCode = PutApiOrdersIdPaymentStatusBody['paymentStatus'];

interface OrderPaymentTransitionModalProps {
  orderId: number;
  currentPaymentStatus: string;
  paymentStatuses: OrderStatus[];
  /**
   * Set once payment initialisation has run, i.e. a Razorpay payment was
   * actually started for this order. Its presence is what makes marking the
   * order `failed` risky — see the warning below.
   */
  razorpayOrderId?: string | null;
  onClose: () => void;
  /** Receives the updated order exactly as the server returned it. */
  onSuccess: (updated: OrderDetail) => void;
}

/**
 * Mirrors the payment graph in the backend's order service.
 *
 * `failed` is not terminal: a declined card is retried, which puts the payment
 * back to `pending`, and a retry that succeeds lands on `paid` directly.
 * `refunded` is reachable only from `paid`, since there is nothing to refund
 * otherwise.
 */
const VALID_PAYMENT_TRANSITIONS: Record<string, PaymentCode[]> = {
  pending: ['paid', 'failed'],
  paid: ['refunded'],
  failed: ['pending', 'paid'],
  refunded: [],
};

export default function OrderPaymentTransitionModal({
  orderId,
  currentPaymentStatus,
  paymentStatuses,
  razorpayOrderId,
  onClose,
  onSuccess,
}: OrderPaymentTransitionModalProps) {
  const { message } = App.useApp();

  const [nextStatus, setNextStatus] = useState<PaymentCode | undefined>();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTransitions = VALID_PAYMENT_TRANSITIONS[currentPaymentStatus] ?? [];
  const statusLabel = (code: string) =>
    paymentStatuses.find((entry) => entry.code === code)?.name ?? code;

  /**
   * A Razorpay payment was started for this order and has not settled here.
   *
   * Marking it `failed` in that state is the one staff action that can
   * contradict reality: Razorpay may capture the payment moments later, and
   * because the automated paths only move an order out of `pending`, the
   * capture would then find the order already `failed` and leave it there. The
   * customer would have paid against an order this system calls failed.
   *
   * Deliberately a warning rather than a block. Whether staff may write off an
   * order with a live payment attempt is a business rule, not something this
   * component should decide, and the backend remains authoritative either way.
   */
  const contradictsLivePayment =
    currentPaymentStatus === 'pending' && Boolean(razorpayOrderId) && nextStatus === 'failed';

  const handleTransition = async () => {
    // Guards a second confirm while the first is in flight.
    if (!nextStatus || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const updated = await ordersService.updatePaymentStatus(
        orderId,
        nextStatus,
        reason.trim() || undefined
      );
      message.success(`Payment for order #${orderId} marked ${statusLabel(nextStatus)}`);
      onSuccess(updated);
      onClose();
    } catch (caught) {
      setError(toApiError(caught).message);
      setSubmitting(false);
    }
  };

  const terminal = validTransitions.length === 0;

  return (
    <Modal
      title="Change payment status"
      open
      onCancel={onClose}
      onOk={() => void handleTransition()}
      confirmLoading={submitting}
      okText={contradictsLivePayment ? 'Mark failed anyway' : 'Confirm'}
      okButtonProps={{ disabled: !nextStatus || terminal, danger: contradictsLivePayment }}
      cancelButtonProps={{ disabled: submitting }}
      maskClosable={!submitting}
      closable={!submitting}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Typography.Paragraph type="secondary">
        Current payment status: <strong>{statusLabel(currentPaymentStatus)}</strong>
      </Typography.Paragraph>

      {contradictsLivePayment ? (
        <Alert
          type="warning"
          showIcon
          className="form-alert"
          message="A Razorpay payment was started for this order"
          description={
            'If that payment is captured after you mark this order failed, the customer ' +
            'will have paid for an order the system shows as failed, and the automatic ' +
            'update will not correct it. Confirm in the Razorpay dashboard that no ' +
            'payment was captured before continuing.'
          }
        />
      ) : null}

      {terminal ? (
        <Alert
          type="info"
          showIcon
          message="No further changes are possible"
          description={`A payment that is ${statusLabel(currentPaymentStatus).toLowerCase()} has reached the end of its lifecycle.`}
        />
      ) : (
        <Form layout="vertical">
          <Form.Item label="New payment status" required>
            <Select<PaymentCode>
              placeholder="Select the new payment status"
              value={nextStatus}
              onChange={setNextStatus}
              disabled={submitting}
              options={validTransitions.map((code) => ({
                label: statusLabel(code),
                value: code,
              }))}
            />
          </Form.Item>

          <Form.Item label="Reason" help="Optional. Stored on the order's payment history.">
            <Input.TextArea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              showCount
              rows={3}
              disabled={submitting}
              placeholder="e.g. Cash taken at the counter"
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
