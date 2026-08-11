/**
 * Order status transition modal.
 *
 * Displays valid next transitions based on the backend transition graph.
 * Initiates the transition via PUT /api/orders/:id/status with status code.
 * Handles errors (409 for invalid transitions, etc).
 */

import { useState } from 'react';
import { Alert, Modal, Select, Space } from 'antd';

import type { OrderStatus } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

interface OrderStatusTransitionModalProps {
  orderId: number;
  currentStatus: string;
  orderStatuses: OrderStatus[];
  onClose: () => void;
  onSuccess: () => void;
}

/** Backend transition graph: which statuses can transition to which */
const VALID_TRANSITIONS: Record<string, string[]> = {
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
  const [nextStatus, setNextStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTransitions = VALID_TRANSITIONS[currentStatus] ?? [];
  const currentStatusLabel =
    orderStatuses.find((s) => s.code === currentStatus)?.name ?? currentStatus;

  const handleTransition = async () => {
    if (!nextStatus) return;

    setLoading(true);
    setError(null);

    try {
      // Type the nextStatus correctly for the API
      await ordersService.updateOrderStatus(orderId, nextStatus as any);
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
      title="Change Order Status"
      open
      onCancel={onClose}
      onOk={handleTransition}
      confirmLoading={loading}
      okText="Confirm"
      okButtonProps={{ disabled: !nextStatus }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <strong>Current Status:</strong> {currentStatusLabel}
        </div>

        {error && (
          <Alert message="Error updating status" description={error} type="error" showIcon />
        )}

        {validTransitions.length === 0 ? (
          <Alert
            message="No valid transitions available"
            description={`Order status "${currentStatusLabel}" cannot be changed.`}
            type="info"
          />
        ) : (
          <div>
            <label>
              <strong>Next Status:</strong>
            </label>
            <Select
              style={{ width: '100%' }}
              placeholder="Select next status"
              value={nextStatus}
              onChange={setNextStatus}
              options={validTransitions.map((code) => {
                const status = orderStatuses.find((s) => s.code === code);
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
