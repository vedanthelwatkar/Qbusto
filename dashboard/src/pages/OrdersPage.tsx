/**
 * Orders management page.
 *
 * Filtering, sorting and pagination are all server-side: the query object in
 * the store is the single source of truth for what GET /api/orders is asked
 * for, and the table never re-sorts or re-filters what it was sent.
 *
 * Orders are never created here — they arrive from the Consumer app or the
 * counter — so this page has no "New order" action. What staff can do is find
 * an order and move its status, which happens in the details drawer.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Input, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

import type { GetApiOrdersParams, Order } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import ScreenSelect from '@/components/screens/ScreenSelect';
import { formatMoney } from '@/components/pricing/money';
import OrderDetailsDrawer from '@/components/orders/OrderDetailsDrawer';
import {
  ORDER_SOURCES,
  orderSourceLabel,
  orderStatusColor,
  paymentStatusColor,
} from '@/components/orders/statusPresentation';
import { useAuthStore } from '@/stores/auth.store';
import { useOrdersStore } from '@/stores/orders.store';
import { hasPermission } from '@/utils/permissions';

const { RangePicker } = DatePicker;

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

  /**
   * Remounts the filter controls when the user clears them.
   *
   * The search box and date range are uncontrolled — the established pattern
   * for search on every other page — so clearing the store's query is not
   * enough to empty what is on screen. Changing the key discards the old
   * inputs rather than reaching into them.
   */
  const [filterKey, setFilterKey] = useState(0);

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

  /**
   * The API bounds `createdAt` with two ISO instants and requires
   * `createdTo > createdFrom`. A day picked in the browser therefore has to
   * cover the whole day, or an order placed in the afternoon of the end date
   * would fall outside a range that visually includes it.
   */
  const handleDateRange = (range: [Dayjs | null, Dayjs | null] | null) => {
    const [from, to] = range ?? [null, null];

    setQuery({
      createdFrom: from ? from.startOf('day').toISOString() : undefined,
      createdTo: to ? to.endOf('day').toISOString() : undefined,
    });
  };

  const clearFilters = () => {
    setQuery({
      search: undefined,
      cinemaId: undefined,
      screenId: undefined,
      status: undefined,
      paymentStatus: undefined,
      source: undefined,
      createdFrom: undefined,
      createdTo: undefined,
    });
    setFilterKey((key) => key + 1);
  };

  const filtersApplied = Boolean(
    query.search ||
    query.cinemaId ||
    query.screenId ||
    query.status ||
    query.paymentStatus ||
    query.source ||
    query.createdFrom ||
    query.createdTo
  );

  const columns: ColumnsType<Order> = [
    {
      title: 'Order',
      dataIndex: 'id',
      key: 'id',
      width: 100,
      sorter: true,
      // The identifying column opens the details view, as on every other page.
      render: (_, order) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(order.id)}>
          #{order.id}
        </Button>
      ),
    },
    {
      title: 'Cinema',
      key: 'cinemaId',
      sorter: true,
      render: (_, order) => order.cinema?.name ?? '-',
    },
    {
      title: 'Screen',
      key: 'screenId',
      render: (_, order) => order.screen?.name ?? '-',
    },
    {
      title: 'Items',
      dataIndex: 'items',
      key: 'items',
      width: 80,
      align: 'right',
      render: (items: Order['items']) => items?.length ?? 0,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 110,
      align: 'right',
      sorter: true,
      render: (total: Order['total']) => formatMoney(total),
    },
    {
      title: 'Order status',
      key: 'status',
      width: 130,
      render: (_, order) => (
        <Tag color={orderStatusColor(order.status)}>
          {order.statusDetail?.name ?? order.status ?? 'Unknown'}
        </Tag>
      ),
    },
    {
      title: 'Payment',
      key: 'paymentStatus',
      width: 120,
      render: (_, order) => (
        <Tag color={paymentStatusColor(order.paymentStatus)}>
          {order.paymentStatusDetail?.name ?? order.paymentStatus ?? 'Unknown'}
        </Tag>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 110,
      render: (source: Order['source']) => orderSourceLabel(source),
    },
    {
      title: 'Placed',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      sorter: true,
      defaultSortOrder: 'descend',
      render: (date: Order['createdAt']) => (date ? new Date(date).toLocaleString() : '-'),
    },
  ];

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Orders"
        description="Every order placed at your cinemas, and its fulfilment and payment state"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
            Refresh
          </Button>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <Input.Search
            key={`search-${filterKey}`}
            allowClear
            placeholder="Search order ID, email, mobile, seat or film"
            defaultValue={query.search}
            onSearch={(value) => setQuery({ search: value || undefined })}
            style={{ width: 300 }}
          />

          <CinemaSelect
            allowClear
            placeholder="Any cinema"
            value={query.cinemaId}
            // Screen is meaningless without its cinema, so changing the cinema
            // drops a screen filter that would otherwise silently exclude
            // everything.
            onChange={(cinemaId) =>
              setQuery({ cinemaId: cinemaId ?? undefined, screenId: undefined })
            }
            style={{ width: 200 }}
          />

          <ScreenSelect
            cinemaId={query.cinemaId}
            allowClear
            placeholder="Any screen"
            value={query.screenId}
            onChange={(screenId) => setQuery({ screenId: screenId ?? undefined })}
            disabled={!query.cinemaId}
            style={{ width: 180 }}
          />

          <Select
            allowClear
            placeholder="Any order status"
            value={query.status}
            onChange={(status) => setQuery({ status })}
            options={orderStatuses.map((status) => ({ label: status.name, value: status.code }))}
            style={{ width: 170 }}
          />

          <Select
            allowClear
            placeholder="Any payment status"
            value={query.paymentStatus}
            onChange={(paymentStatus) => setQuery({ paymentStatus })}
            options={paymentStatuses.map((status) => ({ label: status.name, value: status.code }))}
            style={{ width: 180 }}
          />

          <Select
            allowClear
            placeholder="Any source"
            value={query.source}
            onChange={(source) => setQuery({ source })}
            options={ORDER_SOURCES.map((entry) => ({ label: entry.label, value: entry.value }))}
            style={{ width: 150 }}
          />

          <RangePicker
            key={`dates-${filterKey}`}
            allowEmpty={[true, true]}
            placeholder={['Placed from', 'Placed to']}
            defaultValue={
              query.createdFrom || query.createdTo
                ? [
                    query.createdFrom ? dayjs(query.createdFrom) : null,
                    query.createdTo ? dayjs(query.createdTo) : null,
                  ]
                : undefined
            }
            onChange={handleDateRange}
          />

          <Button onClick={clearFilters} disabled={!filtersApplied}>
            Clear filters
          </Button>
        </Space>

        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            className="form-alert"
            action={
              <Button size="small" onClick={() => void fetch()}>
                Try again
              </Button>
            }
          />
        ) : null}

        <Table<Order>
          rowKey={(order) => String(order.id)}
          columns={columns}
          dataSource={orders}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1200 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load orders" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtersApplied ? 'No orders match these filters' : 'No orders yet'}
              />
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
          // Re-reads the list so the row matches the drawer. The drawer stays
          // open showing the order the server returned.
          onOrderChanged={() => void fetch()}
          canEdit={canEdit}
          orderStatuses={orderStatuses}
          paymentStatuses={paymentStatuses}
        />
      ) : null}
    </Space>
  );
}
