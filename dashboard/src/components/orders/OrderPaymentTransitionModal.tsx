/**
 * Payment status transition modal.
 *
 * Displays valid next transitions based on the backend payment transition graph.
 * Initiates the transition via PUT /api/orders/:id/payment-status with code.
 */

import { useState } from 'react';
import { Alert, Modal, Select, Space } from 'antd';

import type { OrderStatus } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

interface OrderPaymentTransitionModalProps {
  orderId: number;
  currentPaymentStatus: string;
  paymentStatuses: OrderStatus[];
  /**
   * Set once payment-init has run, i.e. a Razorpay payment was actually
   * started for this order. Its presence is what makes marking the order
   * `failed` risky - see the warning below.
   */
  razorpayOrderId?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

/** Backend payment transition graph */
const VALID_PAYMENT_TRANSITIONS: Record<string, string[]> = {
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
  const [nextStatus, setNextStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTransitions = VALID_PAYMENT_TRANSITIONS[currentPaymentStatus] ?? [];

  /**
   * A Razorpay payment was started for this order and has not settled here.
   *
   * Marking it `failed` in that state is the one staff action that can
   * contradict reality: Razorpay may capture the payment moments later, and
   * because the automated paths only move an order out of `pending`, the
   * capture would then find the order already `failed` and leave it there. The
   * customer would have paid against an order our system calls failed.
   *
   * Deliberately a warning rather than a block. Whether staff may write off an
   * order with a live payment attempt is a business rule, not something this
   * component should decide, and the backend remains authoritative either way.
   */
  const contradictsLivePayment =
    currentPaymentStatus === 'pending' && Boolean(razorpayOrderId) && nextStatus === 'failed';
  const currentStatusLabel =
    paymentStatuses.find((s) => s.code === currentPaymentStatus)?.name ?? currentPaymentStatus;

  const handleTransition = async () => {
    if (!nextStatus) return;

    setLoading(true);
    setError(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ordersService.updatePaymentStatus(orderId, nextStatus as any);
      onSuccess();
      onClose();
    } catch (err) {
      const apiError = toApiError(err);
      setError(apiError.message);
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Change Payment Status"
      open
      onCancel={onClose}
      onOk={handleTransition}
      confirmLoading={loading}
      okText={contradictsLivePayment ? 'Mark failed anyway' : 'Confirm'}
      okButtonProps={{ disabled: !nextStatus, danger: contradictsLivePayment }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <strong>Current Payment Status:</strong> {currentStatusLabel}
        </div>

        {error && (
          <Alert
            message="Error updating payment status"
            description={error}
            type="error"
            showIcon
          />
        )}

        {contradictsLivePayment && (
          <Alert
            message="A Razorpay payment was started for this order"
            description={
              'If that payment is captured after you mark this order failed, the customer ' +
              'will have paid for an order the system shows as failed, and the automatic ' +
              'update will not correct it. Confirm in the Razorpay dashboard that no ' +
              'payment was captured before continuing.'
            }
            type="warning"
            showIcon
          />
        )}

        {validTransitions.length === 0 ? (
          <Alert
            message="No valid transitions available"
            description={`Payment status "${currentStatusLabel}" cannot be changed.`}
            type="info"
          />
        ) : (
          <div>
            <label>
              <strong>Next Payment Status:</strong>
            </label>
            <Select
              style={{ width: '100%' }}
              placeholder="Select next status"
              value={nextStatus}
              onChange={setNextStatus}
              options={validTransitions.map((code) => {
                const status = paymentStatuses.find((s) => s.code === code);
                return {
                  label: status?.name ?? code,
                  value: code,
                };
              })}
            />
          </div>
        )}
      </Space>
    </Modal>
  );
}
