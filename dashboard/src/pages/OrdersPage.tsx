/**
 * Orders management page.
 *
 * Staff-facing interface for viewing, searching and filtering orders.
 * All filtering, sorting and pagination is server-side - the query object in
 * the store is the single source of truth for what GET /api/orders is asked
 * for, and the table never re-sorts or re-filters what it was sent.
 *
 * Clicking a row or its View action opens the details drawer (Task 4),
 * which loads the full order snapshot on demand rather than expanding the
 * list response.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';

import type { GetApiOrdersParams, Order } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import ScreenSelect from '@/components/screens/ScreenSelect';
import { formatMoney } from '@/components/pricing/money';
import OrderDetailsDrawer from '@/components/orders/OrderDetailsDrawer';
import { useAuthStore } from '@/stores/auth.store';
import { useOrdersStore } from '@/stores/orders.store';
import { hasPermission } from '@/utils/permissions';

/** The fields GET /api/orders accepts for `sort` (GetApiOrdersSort). */
const SORTABLE = new Set<string>([
  'id',
  'cinemaId',
  'total',
  'createdAt',
  'updatedAt',
  'deliveredAt',
]);

/** antd's sort direction, in the spelling the API expects. */
const SORT_ORDER: Record<string, GetApiOrdersParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** GetApiOrdersSource values, with a display label. */
const ORDER_SOURCES = [
  { label: 'QR', value: 'qr' },
  { label: 'Seat QR', value: 'seat_qr' },
  { label: 'Kiosk', value: 'kiosk' },
  { label: 'Counter', value: 'counter' },
];

export default function OrdersPage() {
  const actor = useAuthStore((state) => state.user);

  const query = useOrdersStore((state) => state.query);
  const orders = useOrdersStore((state) => state.orders);
  const pagination = useOrdersStore((state) => state.pagination);
  const loading = useOrdersStore((state) => state.loading);
  const error = useOrdersStore((state) => state.error);
  const orderStatuses = useOrdersStore((state) => state.orderStatuses);
  const paymentStatuses = useOrdersStore((state) => state.paymentStatuses);
  const setQuery = useOrdersStore((state) => state.setQuery);
  const fetch = useOrdersStore((state) => state.fetch);
  const fetchStatuses = useOrdersStore((state) => state.fetchStatuses);
  const reset = useOrdersStore((state) => state.reset);

  const [detailsId, setDetailsId] = useState<number | undefined>();

  const canView = hasPermission(actor, 'Orders', 'read');
  const canEdit = hasPermission(actor, 'Orders', 'edit');

  useEffect(() => {
    void fetchStatuses();
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, fetchStatuses, reset]);

  if (!canView) {
    return <Alert message="You do not have permission to view orders." type="warning" showIcon />;
  }

  const handleTableChange = (
    next: TablePaginationConfig,
    _filters: Record<string, unknown>,
    sorter: SorterResult<Order> | SorterResult<Order>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default (newest first).
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiOrdersParams['sort'], order: SORT_ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  const columns: ColumnsType<Order> = [
    {
      title: 'Order ID',
      dataIndex: 'id',
      key: 'id',
      width: 90,
      sorter: true,
      render: (id: number) => <code>{id}</code>,
    },
    {
      title: 'Cinema',
      key: 'cinemaId',
      sorter: true,
      render: (_: unknown, record: Order) =>
        record.cinema?.name ?? (record.cinemaId ? `Cinema ${record.cinemaId}` : '-'),
    },
    {
      title: 'Screen',
      key: 'screenId',
      render: (_: unknown, record: Order) =>
        record.screen?.name ?? (record.screenId ? `Screen ${record.screenId}` : '-'),
    },
    {
      title: 'Items',
      dataIndex: 'items',
      key: 'items',
      width: 70,
      render: (items: Order['items']) => items?.length ?? 0,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 110,
      sorter: true,
      render: (total: Order['total']) => formatMoney(total),
    },
    {
      title: 'Order Status',
      key: 'status',
      width: 130,
      render: (_: unknown, record: Order) => (
        <Tag color={getStatusColor(record.status)}>
          {record.statusDetail?.name ?? record.status ?? 'Unknown'}
        </Tag>
      ),
    },
    {
      title: 'Payment Status',
      key: 'paymentStatus',
      width: 130,
      render: (_: unknown, record: Order) => (
        <Tag color={getPaymentStatusColor(record.paymentStatus)}>
          {record.paymentStatusDetail?.name ?? record.paymentStatus ?? 'Unknown'}
        </Tag>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source: Order['source']) =>
        ORDER_SOURCES.find((s) => s.value === source)?.label ?? source ?? '-',
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      sorter: true,
      defaultSortOrder: 'descend',
      render: (date: Order['createdAt']) => (date ? new Date(date).toLocaleString() : '-'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 90,
      render: (_: unknown, record: Order) => (
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setDetailsId(record.id)}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Orders" description="View and manage orders" />

      <Card>
        {error ? (
          <Alert
            message="Could not load orders"
            description={error}
            type="error"
            showIcon
            closable
            action={
              <Button size="small" onClick={() => void fetch()}>
                Try again
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder="Search by order ID, email, mobile, seat, film"
            allowClear
            style={{ width: 260 }}
            value={query.search ?? ''}
            onChange={(e) => setQuery({ search: e.target.value || undefined })}
          />

          <CinemaSelect
            placeholder="Filter by cinema"
            allowClear
            style={{ width: 200 }}
            value={query.cinemaId}
            onChange={(cinemaId) =>
              setQuery({ cinemaId: cinemaId ?? undefined, screenId: undefined })
            }
          />

          <ScreenSelect
            cinemaId={query.cinemaId}
            placeholder="Filter by screen"
            allowClear
            style={{ width: 200 }}
            value={query.screenId}
            onChange={(screenId) => setQuery({ screenId: screenId ?? undefined })}
            disabled={!query.cinemaId}
          />

          <Select
            placeholder="Order Status"
            allowClear
            style={{ width: 160 }}
            value={query.status}
            onChange={(status) => setQuery({ status })}
            options={orderStatuses.map((s) => ({ label: s.name, value: s.code }))}
          />

          <Select
            placeholder="Payment Status"
            allowClear
            style={{ width: 160 }}
            value={query.paymentStatus}
            onChange={(paymentStatus) => setQuery({ paymentStatus })}
            options={paymentStatuses.map((s) => ({ label: s.name, value: s.code }))}
          />

          <Select
            placeholder="Source"
            allowClear
            style={{ width: 140 }}
            value={query.source}
            onChange={(source) => setQuery({ source })}
            options={ORDER_SOURCES}
          />

          <Tooltip title="Refresh">
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading} />
          </Tooltip>
        </Space>

        <Table<Order>
          rowKey={(order) => String(order.id)}
          columns={columns}
          dataSource={orders}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1200 }}
          onRow={(record) => ({
            onClick: () => setDetailsId(record.id),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load orders" />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No orders found" />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} order${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {detailsId !== undefined ? (
        <OrderDetailsDrawer
          orderId={detailsId}
          onClose={() => setDetailsId(undefined)}
          onTransitionComplete={() => {
            void fetch();
            setDetailsId(undefined);
          }}
          canEdit={canEdit}
          orderStatuses={orderStatuses}
          paymentStatuses={paymentStatuses}
        />
      ) : null}
    </>
  );
}

function getStatusColor(code: Order['status']): string {
  switch (code) {
    case 'initiated':
      return 'blue';
    case 'confirmed':
      return 'cyan';
    case 'preparing':
      return 'orange';
    case 'ready':
      return 'gold';
    case 'delivered':
      return 'green';
    case 'rejected':
      return 'red';
    default:
      return 'default';
  }
}

function getPaymentStatusColor(code: Order['paymentStatus']): string {
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
