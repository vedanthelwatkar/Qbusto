/**
 * Order details drawer.
 *
 * Shows complete read-only order snapshot:
 * - Order info (ID, cinema, screen, customer, source, show, notes)
 * - Items as immutable snapshots (productName, quantity, unitPrice, discounts, lineTotals)
 * - Subtotal, total, delivered-at timestamp
 * - Status history in chronological order
 * - Payment status history in chronological order
 * - Action buttons for status/payment transitions (if edit permission)
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Divider,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type {
  OrderDetail,
  OrderItem,
  OrderStatus,
  OrderStatusLog,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { formatMoney } from '@/components/pricing/money';
import OrderStatusTransitionModal from '@/components/orders/OrderStatusTransitionModal';
import OrderPaymentTransitionModal from '@/components/orders/OrderPaymentTransitionModal';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

interface OrderDetailsDrawerProps {
  orderId: number;
  onClose: () => void;
  onTransitionComplete: () => void;
  canEdit: boolean;
  orderStatuses: OrderStatus[];
  paymentStatuses: OrderStatus[];
}

export default function OrderDetailsDrawer({
  orderId,
  onClose,
  onTransitionComplete,
  canEdit,
  orderStatuses,
  paymentStatuses,
}: OrderDetailsDrawerProps) {
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [statusTransitionOpen, setStatusTransitionOpen] = useState(false);
  const [paymentTransitionOpen, setPaymentTransitionOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const data = await ordersService.getOrder(orderId);
        setOrder(data);
      } catch (err) {
        setError(toApiError(err).message);
      }
    })();
  }, [orderId]);

  if (!order) {
    return (
      <Drawer title={`Order ${orderId}`} onClose={onClose} width={800}>
        {error ? (
          <Alert message="Error loading order" description={error} type="error" />
        ) : (
          <Spin />
        )}
      </Drawer>
    );
  }

  const itemColumns: ColumnsType<OrderItem> = [
    {
      title: 'Product',
      dataIndex: 'productName',
      key: 'productName',
      render: (name: string) => <span>{name}</span>,
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 60,
      align: 'center',
    },
    {
      title: 'Unit Price',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 100,
      render: (price: number) => formatMoney(price),
    },
    {
      title: 'Discount',
      dataIndex: 'discountValue',
      key: 'discountValue',
      width: 100,
      render: (discount: number | null | undefined) =>
        discount ? `-${formatMoney(discount)}` : '—',
    },
    {
      title: 'Line Total',
      dataIndex: 'lineTotal',
      key: 'lineTotal',
      width: 100,
      render: (total: number) => formatMoney(total),
    },
  ];

  const currentStatusLabel = order.statusDetail?.name ?? order.status ?? '—';
  const currentPaymentStatusLabel = order.paymentStatusDetail?.name ?? order.paymentStatus ?? '—';

  return (
    <Drawer
      title={`Order #${order.id}`}
      onClose={onClose}
      width={800}
      bodyStyle={{ overflow: 'auto' }}
    >
      {error && (
        <Alert message="Error" description={error} type="error" style={{ marginBottom: 16 }} />
      )}

      {/* Order Info */}
      <Descriptions title="Order Information" column={2} bordered size="small">
        <Descriptions.Item label="Order ID">{order.id}</Descriptions.Item>
        <Descriptions.Item label="Cinema">{order.cinema?.name}</Descriptions.Item>
        <Descriptions.Item label="Screen">{order.screen?.name}</Descriptions.Item>
        <Descriptions.Item label="Source">{order.source || '—'}</Descriptions.Item>
        {order.customerMobile && (
          <Descriptions.Item label="Customer Mobile">{order.customerMobile}</Descriptions.Item>
        )}
        {order.customerEmail && (
          <Descriptions.Item label="Customer Email">{order.customerEmail}</Descriptions.Item>
        )}
        {order.filmTitle && <Descriptions.Item label="Film">{order.filmTitle}</Descriptions.Item>}
        {order.seatNumber && <Descriptions.Item label="Seat">{order.seatNumber}</Descriptions.Item>}
      </Descriptions>

      <Divider />

      {/* Items */}
      <h3>Order Items (Snapshot)</h3>
      <Table
        columns={itemColumns}
        dataSource={order.items}
        rowKey="id"
        pagination={false}
        size="small"
        bordered
      />

      <Divider />

      {/* Totals */}
      <Descriptions column={1} size="small">
        <Descriptions.Item label="Subtotal">{formatMoney(order.subtotal ?? 0)}</Descriptions.Item>
        <Descriptions.Item label="Discount">{formatMoney(order.discount ?? 0)}</Descriptions.Item>
        <Descriptions.Item label="Total">
          <strong>{formatMoney(order.total ?? 0)}</strong>
        </Descriptions.Item>
      </Descriptions>

      <Divider />

      {/* Status Controls */}
      <div style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>Order Status:</strong>{' '}
            <Tag color={getStatusColor(order.status ?? '')}>{currentStatusLabel}</Tag>
          </div>
          {canEdit && (
            <Button onClick={() => setStatusTransitionOpen(true)}>Change Order Status</Button>
          )}
        </Space>
      </div>

      {/* Payment Status Controls */}
      <div style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>Payment Status:</strong>{' '}
            <Tag color={getPaymentStatusColor(order.paymentStatus ?? '')}>
              {currentPaymentStatusLabel}
            </Tag>
          </div>
          {canEdit && (
            <Button onClick={() => setPaymentTransitionOpen(true)}>Change Payment Status</Button>
          )}
        </Space>
      </div>

      <Divider />

      {/* Status History */}
      <h3>Order Status History</h3>
      {order.statusLogs && order.statusLogs.length > 0 ? (
        <Timeline
          items={order.statusLogs.map((log: OrderStatusLog) => {
            const status = orderStatuses.find((s) => s.code === log.newStatus);
            const timestamp = log.createdAt ? new Date(log.createdAt).toLocaleString() : '—';
            return {
              label: timestamp,
              children: (
                <div>
                  <strong>{status?.name ?? log.newStatus}</strong>
                  {log.reason && (
                    <div style={{ fontSize: 12, color: '#888' }}>Reason: {log.reason}</div>
                  )}
                </div>
              ),
            };
          })}
        />
      ) : (
        <Empty />
      )}

      <Divider />

      {/* Payment Status History */}
      <h3>Payment Status History</h3>
      {order.paymentStatusLogs && order.paymentStatusLogs.length > 0 ? (
        <Timeline
          items={order.paymentStatusLogs.map((log: OrderStatusLog) => {
            const status = paymentStatuses.find((s) => s.code === log.newStatus);
            const timestamp = log.createdAt ? new Date(log.createdAt).toLocaleString() : '—';
            return {
              label: timestamp,
              children: (
                <div>
                  <strong>{status?.name ?? log.newStatus}</strong>
                  {log.reason && (
                    <div style={{ fontSize: 12, color: '#888' }}>Reason: {log.reason}</div>
                  )}
                </div>
              ),
            };
          })}
        />
      ) : (
        <Empty />
      )}

      {/* Transition Modals */}
      {statusTransitionOpen && order.status && (
        <OrderStatusTransitionModal
          orderId={order.id ?? 0}
          currentStatus={order.status}
          orderStatuses={orderStatuses}
          onClose={() => setStatusTransitionOpen(false)}
          onSuccess={() => {
            onTransitionComplete();
          }}
        />
      )}

      {paymentTransitionOpen && order.paymentStatus && (
        <OrderPaymentTransitionModal
          orderId={order.id ?? 0}
          currentPaymentStatus={order.paymentStatus}
          paymentStatuses={paymentStatuses}
          onClose={() => setPaymentTransitionOpen(false)}
          onSuccess={() => {
            onTransitionComplete();
          }}
        />
      )}
    </Drawer>
  );
}

function getStatusColor(code: string): string {
  switch (code) {
    case 'initiated':
      return 'blue';
    case 'confirmed':
      return 'cyan';
    case 'preparing':
      return 'orange';
    case 'ready':
      return 'green';
    case 'delivered':
      return 'green';
    case 'rejected':
      return 'red';
    default:
      return 'default';
  }
}

function getPaymentStatusColor(code: string): string {
  switch (code) {
    case 'pending':
      return 'orange';
    case 'paid':
      return 'green';
    case 'failed':
      return 'red';
    case 'refunded':
      return 'blue';
    default:
      return 'default';
  }
}
