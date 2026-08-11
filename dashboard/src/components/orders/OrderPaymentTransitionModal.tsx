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
  onClose,
  onSuccess,
}: OrderPaymentTransitionModalProps) {
  const [nextStatus, setNextStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTransitions = VALID_PAYMENT_TRANSITIONS[currentPaymentStatus] ?? [];
  const currentStatusLabel =
    paymentStatuses.find((s) => s.code === currentPaymentStatus)?.name ?? currentPaymentStatus;

  const handleTransition = async () => {
    if (!nextStatus) return;

    setLoading(true);
    setError(null);

    try {
      // Type the nextStatus correctly for the API
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
      okText="Confirm"
      okButtonProps={{ disabled: !nextStatus }}
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
