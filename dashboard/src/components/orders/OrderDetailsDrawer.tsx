/**
 * Read-only view of one order, plus the staff transition controls.
 *
 * Mounted only while it is open, so opening it is a fresh mount and the
 * initial state is the loading state — the same pattern as every other details
 * drawer in the Dashboard.
 *
 * Order items are immutable snapshots taken when the order was placed:
 * productName, unitPrice and discount are frozen, so renaming or repricing a
 * product later cannot rewrite what the customer was charged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Skeleton,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
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
import {
  orderSourceLabel,
  orderStatusColor,
  paymentStatusColor,
} from '@/components/orders/statusPresentation';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

const { Text } = Typography;

interface OrderDetailsDrawerProps {
  orderId: number;
  onClose: () => void;
  /** Tells the parent list to re-read, so the table row matches the drawer. */
  onOrderChanged: () => void;
  canEdit: boolean;
  orderStatuses: OrderStatus[];
  paymentStatuses: OrderStatus[];
}

export default function OrderDetailsDrawer({
  orderId,
  onClose,
  onOrderChanged,
  canEdit,
  orderStatuses,
  paymentStatuses,
}: OrderDetailsDrawerProps) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusTransitionOpen, setStatusTransitionOpen] = useState(false);
  const [paymentTransitionOpen, setPaymentTransitionOpen] = useState(false);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  /**
   * One load path, used by the initial fetch and by Try again alike.
   *
   * The token guards against an out-of-order response: `orderId` is a prop, so
   * opening a different order while a slow request is in flight would
   * otherwise let the older response overwrite the newer order.
   */
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const token = ++requestRef.current;

    // State is settled in the callbacks rather than before the request. The
    // initial state is already the loading state, so the mount path has
    // nothing to reset, and setting it synchronously here would make this a
    // cascading render inside the effect below.
    return ordersService.getOrder(orderId).then(
      (loaded) => {
        if (token !== requestRef.current) return;
        setOrder(loaded);
        setLoading(false);
      },
      (caught: unknown) => {
        if (token !== requestRef.current) return;
        setError(toApiError(caught).message);
        setLoading(false);
      }
    );
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Retry is a user action, so it owns putting the view back into loading. */
  const retry = () => {
    setError(null);
    setLoading(true);
    void load();
  };

  /**
   * A transition succeeded.
   *
   * The drawer stays open showing the order the SERVER returned, rather than
   * closing or re-deriving it locally. If another user moved the order first,
   * what lands here is the state it is actually in.
   */
  const handleTransitioned = (updated: OrderDetail) => {
    setOrder(updated);
    onOrderChanged();
  };

  const itemColumns: ColumnsType<OrderItem> = [
    {
      title: 'Product',
      dataIndex: 'productName',
      key: 'productName',
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 70,
      align: 'center',
    },
    {
      title: 'Unit price',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 110,
      align: 'right',
      render: (price: OrderItem['unitPrice']) => formatMoney(price),
    },
    {
      // `discount` and `total`, as the API names them. These columns previously
      // read `discountValue` and `lineTotal`, which the order item has never
      // carried, so both rendered empty for every line.
      title: 'Discount',
      dataIndex: 'discount',
      key: 'discount',
      width: 110,
      align: 'right',
      render: (discount: OrderItem['discount']) =>
        discount ? `-${formatMoney(discount)}` : <Text type="secondary">-</Text>,
    },
    {
      title: 'Line total',
      dataIndex: 'total',
      key: 'total',
      width: 110,
      align: 'right',
      render: (total: OrderItem['total']) => formatMoney(total),
    },
  ];

  const statusLabel = order?.statusDetail?.name ?? order?.status ?? '-';
  const paymentLabel = order?.paymentStatusDetail?.name ?? order?.paymentStatus ?? '-';

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={840}
      title={`Order #${orderId}`}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          className="form-alert"
          action={
            <Button size="small" onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : null}

      {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}

      {order ? (
        <>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="Order ID">#{order.id}</Descriptions.Item>
            <Descriptions.Item label="Placed">
              {order.createdAt ? new Date(order.createdAt).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Cinema">
              {order.cinema?.name ?? <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Screen">
              {order.screen?.name ?? <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Source">{orderSourceLabel(order.source)}</Descriptions.Item>
            <Descriptions.Item label="Seat">
              {order.seatNumber ?? <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Film">
              {order.filmTitle ?? <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Show time">
              {order.showTime ? new Date(order.showTime).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Customer mobile">
              {order.customerMobile ?? <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Customer email">
              {order.customerEmail ?? <Text type="secondary">-</Text>}
            </Descriptions.Item>
            {order.deliveredAt ? (
              <Descriptions.Item label="Delivered" span={2}>
                {new Date(order.deliveredAt).toLocaleString()}
              </Descriptions.Item>
            ) : null}
            {order.notes ? (
              <Descriptions.Item label="Notes" span={2}>
                <span className="details-drawer__text">{order.notes}</span>
              </Descriptions.Item>
            ) : null}
          </Descriptions>

          <div className="details-drawer__section">
            <Typography.Title level={5}>Items</Typography.Title>
            <Table<OrderItem>
              columns={itemColumns}
              dataSource={order.items ?? []}
              rowKey={(item) => String(item.id)}
              pagination={false}
              size="small"
              locale={{
                emptyText: (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No items recorded" />
                ),
              }}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      Subtotal
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      {formatMoney(order.subtotal)}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      Discount
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      {order.discount ? `-${formatMoney(order.discount)}` : formatMoney(0)}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      <strong>Total</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <strong>{formatMoney(order.total)}</strong>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </div>

          <div className="details-drawer__section">
            <Typography.Title level={5}>Status</Typography.Title>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Order status">
                <Space>
                  <Tag color={orderStatusColor(order.status)}>{statusLabel}</Tag>
                  {canEdit ? (
                    <Button size="small" onClick={() => setStatusTransitionOpen(true)}>
                      Change
                    </Button>
                  ) : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Payment status">
                <Space>
                  <Tag color={paymentStatusColor(order.paymentStatus)}>{paymentLabel}</Tag>
                  {canEdit ? (
                    <Button size="small" onClick={() => setPaymentTransitionOpen(true)}>
                      Change
                    </Button>
                  ) : null}
                </Space>
              </Descriptions.Item>
              {/*
                Shown only when a gateway payment was actually started. It is
                reference for staff checking against the Razorpay dashboard;
                nothing here acts on it.
              */}
              {order.razorpayOrderId ? (
                <Descriptions.Item label="Razorpay order">
                  <Text copyable>{order.razorpayOrderId}</Text>
                </Descriptions.Item>
              ) : null}
              {order.razorpayPaymentId ? (
                <Descriptions.Item label="Razorpay payment">
                  <Text copyable>{order.razorpayPaymentId}</Text>
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </div>

          <div className="details-drawer__section">
            <Typography.Title level={5}>Order status history</Typography.Title>
            <StatusTimeline logs={order.statusLogs} statuses={orderStatuses} />
          </div>

          <div className="details-drawer__section">
            <Typography.Title level={5}>Payment status history</Typography.Title>
            <StatusTimeline logs={order.paymentStatusLogs} statuses={paymentStatuses} />
          </div>
        </>
      ) : null}

      {/*
        Guarded on a loaded order with a known status: without a current status
        there is no transition graph to offer, and the modal would render an
        empty control.
      */}
      {statusTransitionOpen && order?.id !== undefined && order.status ? (
        <OrderStatusTransitionModal
          orderId={order.id}
          currentStatus={order.status}
          orderStatuses={orderStatuses}
          onClose={() => setStatusTransitionOpen(false)}
          onSuccess={handleTransitioned}
        />
      ) : null}

      {paymentTransitionOpen && order?.id !== undefined && order.paymentStatus ? (
        <OrderPaymentTransitionModal
          orderId={order.id}
          currentPaymentStatus={order.paymentStatus}
          paymentStatuses={paymentStatuses}
          razorpayOrderId={order.razorpayOrderId}
          onClose={() => setPaymentTransitionOpen(false)}
          onSuccess={handleTransitioned}
        />
      ) : null}
    </Drawer>
  );
}

/** One audit trail, oldest first, as the API returns it. */
function StatusTimeline({
  logs,
  statuses,
}: {
  logs: OrderStatusLog[] | undefined;
  statuses: OrderStatus[];
}) {
  if (!logs || logs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No changes recorded" />;
  }

  return (
    <Timeline
      mode="left"
      items={logs.map((log) => ({
        children: (
          <div>
            <strong>{statuses.find((s) => s.code === log.newStatus)?.name ?? log.newStatus}</strong>
            <div>
              <Text type="secondary">
                {log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
              </Text>
            </div>
            {log.reason ? (
              <div>
                <Text type="secondary">Reason: {log.reason}</Text>
              </div>
            ) : null}
          </div>
        ),
      }))}
    />
  );
}
