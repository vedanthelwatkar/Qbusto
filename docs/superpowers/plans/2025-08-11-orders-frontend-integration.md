# Orders Frontend Integration Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete staff-facing Orders management UI following existing dashboard patterns, with server-side list, details drawer, and status/payment transition controls.

**Architecture:** Vertical slice (pages → stores → services → generated Orval client). List page shows paginated, sortable, filterable orders table. Clicking an order opens a details drawer with full historical snapshot (items, statuses, payment history). Status/payment transitions are triggered from the drawer and validated against the backend transition graph. All data flows through the generated Orval client; no handwritten URLs or types.

**Tech Stack:** React, TypeScript, Zustand (store), Ant Design, generated Orval client

## Global Constraints

- Use ONLY generated Orval functions for API communication
- No order creation UI (out of scope)
- All pagination/sorting/filtering is server-side
- Status/payment master data loaded in Orders store, not global bootstrap
- Order item snapshots are immutable (do not replace with current pricing/product data)
- Status transitions determined by backend transition graph: initiated→confirmed→preparing→ready→delivered, payment: pending→paid|failed, failed→pending|paid, paid→refunded
- Permissions: Orders:read for view, Orders:edit for mutations
- Use existing ApiError architecture and money format helpers from Pricing

---

### Task 1: Create orders.service.ts

**Files:**
- Create: `dashboard/src/services/orders.service.ts`

**Interfaces:**
- Consumes: Generated Orval functions from `@/api/generated/orders/orders` and `@/api/generated/order-statuses/order-statuses`
- Produces:
  - `listOrders(params: GetApiOrdersParams): Promise<{orders: Order[], pagination: Pagination | null}>`
  - `getOrder(id: number): Promise<OrderDetail>`
  - `updateOrderStatus(id: number, status: string): Promise<Order>`
  - `updatePaymentStatus(id: number, paymentStatus: string): Promise<Order>`
  - `getOrderStatuses(): Promise<OrderStatus[]>`
  - `getPaymentStatuses(): Promise<PaymentStatus[]>`

- [ ] **Step 1: Create the service file with Orval client wrapping**

```typescript
/**
 * Orders API communication layer.
 * 
 * Wraps generated Orval client, unwraps envelopes following the
 * pattern established by pricing.service and users.service.
 * No URL, query param type, body type or response type is written by hand.
 */

import type {
  GetApiOrdersParams,
  Order,
  OrderDetail,
  OrderStatus,
  OrderStatusLog,
  PaymentStatus,
  PaymentStatusLog,
  PutApiOrdersIdStatusBody,
  PutApiOrdersIdPaymentStatusBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getOrders } from '@/api/generated/orders/orders';
import { getOrderStatuses } from '@/api/generated/order-statuses/order-statuses';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const ordersApi = getOrders();
const statusesApi = getOrderStatuses();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface OrdersPage {
  orders: Order[];
  pagination: Pagination | null;
}

export async function listOrders(params: GetApiOrdersParams): Promise<OrdersPage> {
  const response = await ordersApi.getApiOrders(params);
  return {
    orders: response.data ?? [],
    pagination: response.meta?.pagination ?? null,
  };
}

export async function getOrder(id: number): Promise<OrderDetail> {
  const { data } = await ordersApi.getApiOrdersId(id);
  if (!data) throw MALFORMED;
  return data;
}

export async function updateOrderStatus(
  id: number,
  status: string,
): Promise<Order> {
  const body: PutApiOrdersIdStatusBody = { status };
  const { data } = await ordersApi.putApiOrdersIdStatus(id, body);
  if (!data) throw MALFORMED;
  return data;
}

export async function updatePaymentStatus(
  id: number,
  paymentStatus: string,
): Promise<Order> {
  const body: PutApiOrdersIdPaymentStatusBody = { paymentStatus };
  const { data } = await ordersApi.putApiOrdersIdPaymentStatus(id, body);
  if (!data) throw MALFORMED;
  return data;
}

export async function getOrderStatuses(): Promise<OrderStatus[]> {
  const { data } = await statusesApi.getApiOrderStatuses();
  return data ?? [];
}

export async function getPaymentStatuses(): Promise<PaymentStatus[]> {
  const { data } = await statusesApi.getApiPaymentStatuses();
  return data ?? [];
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run typecheck 2>&1 | grep -A2 orders.service.ts || echo "OK"`
Expected: No TypeScript errors for orders.service.ts

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/services/orders.service.ts
git commit -m "feat(orders): create API service wrapping generated Orval client"
```

---

### Task 2: Create orders.store.ts

**Files:**
- Create: `dashboard/src/stores/orders.store.ts`

**Interfaces:**
- Consumes: `orders.service.ts` functions
- Produces: `useOrdersStore()` Zustand store with:
  - State: `query: GetApiOrdersParams`, `orders: Order[]`, `pagination: Pagination | null`, `loading: boolean`, `error: string | null`, `orderStatuses: OrderStatus[]`, `paymentStatuses: PaymentStatus[]`, `statusesLoading: boolean`
  - Actions: `setQuery(patch)`, `fetch()`, `fetchStatuses()`, `reset()`

- [ ] **Step 1: Create the store with list state and status caching**

```typescript
/**
 * Orders state management.
 * 
 * Mirrors pricing.store structure: query state drives list fetches,
 * pagination resets on non-page changes. Status/payment-status master
 * data is loaded once and cached in this store rather than globally.
 */

import { create } from 'zustand';

import type {
  GetApiOrdersParams,
  Order,
  OrderStatus,
  PaymentStatus,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';
import type { Pagination } from '@/types/api';

const DEFAULT_QUERY: GetApiOrdersParams = {
  page: 1,
  limit: 20,
  sort: 'createdAt',
  order: 'desc',
};

interface OrdersState {
  // List query and results
  query: GetApiOrdersParams;
  orders: Order[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  // Status/payment-status master data
  orderStatuses: OrderStatus[];
  paymentStatuses: PaymentStatus[];
  statusesLoading: boolean;

  // Actions
  setQuery: (patch: Partial<GetApiOrdersParams>) => void;
  fetch: () => Promise<void>;
  fetchStatuses: () => Promise<void>;
  reset: () => void;
}

let latestRequest = 0;

export const useOrdersStore = create<OrdersState>((set, get) => ({
  query: DEFAULT_QUERY,
  orders: [],
  pagination: null,
  loading: false,
  error: null,

  orderStatuses: [],
  paymentStatuses: [],
  statusesLoading: false,

  setQuery: (patch) => {
    const isPaging = 'page' in patch || 'limit' in patch;
    set({
      query: {
        ...get().query,
        ...(isPaging ? {} : { page: 1 }),
        ...patch,
      },
    });
    void get().fetch();
  },

  fetch: async () => {
    const requestId = ++latestRequest;
    set({ loading: true, error: null });

    try {
      const page = await ordersService.listOrders(get().query);
      if (requestId === latestRequest) {
        set({ orders: page.orders, pagination: page.pagination, loading: false });
      }
    } catch (err) {
      if (requestId === latestRequest) {
        set({ error: toApiError(err).message, loading: false });
      }
    }
  },

  fetchStatuses: async () => {
    if (get().orderStatuses.length > 0) return;

    set({ statusesLoading: true });
    try {
      const [orderStatuses, paymentStatuses] = await Promise.all([
        ordersService.getOrderStatuses(),
        ordersService.getPaymentStatuses(),
      ]);
      set({ orderStatuses, paymentStatuses, statusesLoading: false });
    } catch (err) {
      set({ statusesLoading: false, error: toApiError(err).message });
    }
  },

  reset: () => {
    set({
      query: DEFAULT_QUERY,
      orders: [],
      pagination: null,
      loading: false,
      error: null,
    });
  },
}));
```

- [ ] **Step 2: Verify TypeScript and Zustand patterns**

Run: `npm run typecheck 2>&1 | grep orders.store.ts || echo "OK"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/stores/orders.store.ts
git commit -m "feat(orders): create Zustand store with list and status state"
```

---

### Task 3: Create OrdersPage.tsx

**Files:**
- Create: `dashboard/src/pages/OrdersPage.tsx`

**Interfaces:**
- Consumes: `useOrdersStore`, `orders.service`, Ant Design Table/Select/Input, existing CinemaSelect/ScreenSelect components, permissions utils
- Produces: Main orders list page component with table, filters, pagination

- [ ] **Step 1: Create OrdersPage with table skeleton**

```typescript
/**
 * Orders management page.
 * 
 * Staff-facing interface for viewing, searching and filtering orders.
 * All filtering, sorting and pagination is server-side.
 * Clicking an order row opens the details drawer.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';

import type { GetApiOrdersParams, Order, OrderDetail } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import ScreenSelect from '@/components/screens/ScreenSelect';
import { formatMoney } from '@/components/pricing/money';
import OrderDetailsDrawer from '@/components/orders/OrderDetailsDrawer';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';
import { useAuthStore } from '@/stores/auth.store';
import { useOrdersStore } from '@/stores/orders.store';
import { hasPermission } from '@/utils/permissions';

const ORDER_SORT_FIELDS = new Set<string>([
  'id',
  'cinemaId',
  'screenId',
  'total',
  'createdAt',
  'updatedAt',
  'deliveredAt',
]);

const ORDER_SOURCES = [
  { label: 'Counter', value: 'counter' },
  { label: 'Kiosk', value: 'kiosk' },
  { label: 'Seat QR', value: 'seatQr' },
];

const ORDER_ORDER: Record<string, GetApiOrdersParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

export default function OrdersPage() {
  const { message } = App.useApp();
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
  const [cinemaNames, setCinemaNames] = useState<Map<number, string>>(new Map());
  const [screenNames, setScreenNames] = useState<Map<number, string>>(new Map());
  const canView = hasPermission(actor?.permissions, 'Orders', 'canRead');
  const canEdit = hasPermission(actor?.permissions, 'Orders', 'canEdit');

  useEffect(() => {
    void fetchStatuses();
  }, [fetchStatuses]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (!canView) {
    return <Alert message="You do not have permission to view orders." type="warning" />;
  }

  const handleTableChange = (
    _pagination: TablePaginationConfig,
    _filters: Record<string, any>,
    sorter: SorterResult<Order> | SorterResult<Order>[],
  ) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    if (s.field && ORDER_SORT_FIELDS.has(String(s.field))) {
      setQuery({
        sort: String(s.field),
        order: ORDER_ORDER[s.order ?? 'descend'],
      });
    }
  };

  const handlePaginationChange = (page: number, pageSize: number) => {
    setQuery({ page, limit: pageSize });
  };

  const columns: ColumnsType<Order> = [
    {
      title: 'Order ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      sorter: true,
      render: (id: number) => <code>{id}</code>,
    },
    {
      title: 'Cinema',
      dataIndex: ['cinema', 'name'],
      key: 'cinemaId',
      render: (name: string, record: Order) => {
        if (name) {
          setCinemaNames((prev) => new Map(prev).set(record.cinema.id, name));
          return name;
        }
        return cinemaNames.get(record.cinema.id) || `Cinema ${record.cinema.id}`;
      },
    },
    {
      title: 'Screen',
      dataIndex: ['screen', 'name'],
      key: 'screenId',
      render: (name: string, record: Order) => {
        if (name) {
          setScreenNames((prev) => new Map(prev).set(record.screen.id, name));
          return name;
        }
        return screenNames.get(record.screen.id) || `Screen ${record.screen.id}`;
      },
    },
    {
      title: 'Items',
      dataIndex: 'items',
      key: 'items',
      width: 80,
      render: (items: any[]) => items?.length ?? 0,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 100,
      sorter: true,
      render: (total: number) => formatMoney(total),
    },
    {
      title: 'Order Status',
      dataIndex: ['status', 'code'],
      key: 'status',
      width: 120,
      render: (code: string, record: Order) => {
        const status = orderStatuses.find((s) => s.code === code);
        return (
          <Tag color={getStatusColor(code)}>
            {status?.name ?? code}
          </Tag>
        );
      },
    },
    {
      title: 'Payment Status',
      dataIndex: ['paymentStatus', 'code'],
      key: 'paymentStatus',
      width: 120,
      render: (code: string, record: Order) => {
        const status = paymentStatuses.find((s) => s.code === code);
        return (
          <Tag color={getPaymentStatusColor(code)}>
            {status?.name ?? code}
          </Tag>
        );
      },
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source: string) => {
        const label = ORDER_SOURCES.find((s) => s.value === source)?.label;
        return label ?? source;
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: true,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      render: (_: any, record: Order) => (
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
      <PageHeader title="Orders" subtitle="View and manage orders" />

      <Card>
        {error && (
          <Alert
            message="Error loading orders"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setQuery({})}
            style={{ marginBottom: 16 }}
          />
        )}

        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder="Search by order ID, email, mobile, seat, film"
            allowClear
            style={{ width: 250 }}
            value={query.search ?? ''}
            onChange={(e) => setQuery({ search: e.target.value || undefined })}
          />

          <CinemaSelect
            placeholder="Filter by cinema"
            style={{ width: 200 }}
            value={query.cinemaId}
            onChange={(cinemaId) => setQuery({ cinemaId })}
          />

          <ScreenSelect
            cinemaId={query.cinemaId}
            placeholder="Filter by screen"
            style={{ width: 200 }}
            value={query.screenId}
            onChange={(screenId) => setQuery({ screenId })}
            disabled={!query.cinemaId}
          />

          <Select
            placeholder="Order Status"
            allowClear
            style={{ width: 150 }}
            value={query.status}
            onChange={(status) => setQuery({ status })}
            options={orderStatuses.map((s) => ({
              label: s.name,
              value: s.code,
            }))}
          />

          <Select
            placeholder="Payment Status"
            allowClear
            style={{ width: 150 }}
            value={query.paymentStatus}
            onChange={(paymentStatus) => setQuery({ paymentStatus })}
            options={paymentStatuses.map((s) => ({
              label: s.name,
              value: s.code,
            }))}
          />

          <Select
            placeholder="Source"
            allowClear
            style={{ width: 120 }}
            value={query.source}
            onChange={(source) => setQuery({ source })}
            options={ORDER_SOURCES}
          />

          <Tooltip title="Refresh">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void fetch()}
              loading={loading}
            />
          </Tooltip>
        </Space>

        {orders.length === 0 && !loading && !error ? (
          <Empty description="No orders found" />
        ) : (
          <Table
            columns={columns}
            dataSource={orders}
            rowKey="id"
            loading={loading}
            onChange={handleTableChange}
            pagination={
              pagination
                ? {
                    current: pagination.currentPage,
                    pageSize: pagination.pageSize,
                    total: pagination.total,
                    onChange: handlePaginationChange,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                  }
                : false
            }
          />
        )}
      </Card>

      {detailsId && canView && (
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
      )}
    </>
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
```

- [ ] **Step 2: Verify TypeScript and imports**

Run: `npm run typecheck 2>&1 | head -20`
Expected: Check for any missing imports or type errors in OrdersPage

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/OrdersPage.tsx
git commit -m "feat(orders): create OrdersPage with server-side list and filters"
```

---

### Task 4: Create OrderDetailsDrawer.tsx

**Files:**
- Create: `dashboard/src/components/orders/OrderDetailsDrawer.tsx`

**Interfaces:**
- Consumes: `orders.service`, `useOrdersStore`, OrderDetail type, order status/payment status types
- Produces: Details drawer component showing full order snapshot with items and histories

- [ ] **Step 1: Create the details drawer**

```typescript
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
  App,
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
  Order,
  OrderDetail,
  OrderItem,
  OrderStatus,
  OrderStatusLog,
  PaymentStatus,
  PaymentStatusLog,
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
  paymentStatuses: PaymentStatus[];
}

export default function OrderDetailsDrawer({
  orderId,
  onClose,
  onTransitionComplete,
  canEdit,
  orderStatuses,
  paymentStatuses,
}: OrderDetailsDrawerProps) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [statusTransitionOpen, setStatusTransitionOpen] = useState(false);
  const [paymentTransitionOpen, setPaymentTransitionOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await ordersService.getOrder(orderId);
        setOrder(data);
      } catch (err) {
        setError(toApiError(err).message);
      } finally {
        setLoading(false);
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

  const currentStatus = orderStatuses.find((s) => s.code === order.status.code);
  const currentPaymentStatus = paymentStatuses.find(
    (s) => s.code === order.paymentStatus.code,
  );

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

  return (
    <Drawer
      title={`Order #${order.id}`}
      onClose={onClose}
      width={800}
      bodyStyle={{ overflow: 'auto' }}
    >
      {error && <Alert message="Error" description={error} type="error" style={{ marginBottom: 16 }} />}

      {/* Order Info */}
      <Descriptions title="Order Information" column={2} bordered size="small">
        <Descriptions.Item label="Order ID">{order.id}</Descriptions.Item>
        <Descriptions.Item label="Cinema">{order.cinema.name}</Descriptions.Item>
        <Descriptions.Item label="Screen">{order.screen.name}</Descriptions.Item>
        <Descriptions.Item label="Source">
          {order.source || '—'}
        </Descriptions.Item>
        {order.customerMobile && (
          <Descriptions.Item label="Customer Mobile">
            {order.customerMobile}
          </Descriptions.Item>
        )}
        {order.customerEmail && (
          <Descriptions.Item label="Customer Email">
            {order.customerEmail}
          </Descriptions.Item>
        )}
        {order.showName && (
          <Descriptions.Item label="Show">{order.showName}</Descriptions.Item>
        )}
        {order.seatNumber && (
          <Descriptions.Item label="Seat">{order.seatNumber}</Descriptions.Item>
        )}
        {order.notes && (
          <Descriptions.Item label="Notes" span={2}>
            {order.notes}
          </Descriptions.Item>
        )}
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
        <Descriptions.Item label="Subtotal">
          {formatMoney(order.subtotal)}
        </Descriptions.Item>
        <Descriptions.Item label="Total">
          <strong>{formatMoney(order.total)}</strong>
        </Descriptions.Item>
        {order.deliveredAt && (
          <Descriptions.Item label="Delivered At">
            {new Date(order.deliveredAt).toLocaleString()}
          </Descriptions.Item>
        )}
      </Descriptions>

      <Divider />

      {/* Status Controls */}
      <div style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>Order Status:</strong> {' '}
            <Tag color={getStatusColor(order.status.code)}>
              {currentStatus?.name ?? order.status.code}
            </Tag>
          </div>
          {canEdit && (
            <Button onClick={() => setStatusTransitionOpen(true)}>
              Change Order Status
            </Button>
          )}
        </Space>
      </div>

      {/* Payment Status Controls */}
      <div style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>Payment Status:</strong> {' '}
            <Tag color={getPaymentStatusColor(order.paymentStatus.code)}>
              {currentPaymentStatus?.name ?? order.paymentStatus.code}
            </Tag>
          </div>
          {canEdit && (
            <Button onClick={() => setPaymentTransitionOpen(true)}>
              Change Payment Status
            </Button>
          )}
        </Space>
      </div>

      <Divider />

      {/* Status History */}
      <h3>Order Status History</h3>
      {order.statusLogs && order.statusLogs.length > 0 ? (
        <Timeline
          items={order.statusLogs.map((log: OrderStatusLog) => {
            const status = orderStatuses.find((s) => s.code === log.status.code);
            return {
              label: new Date(log.createdAt).toLocaleString(),
              children: (
                <div>
                  <strong>{status?.name ?? log.status.code}</strong>
                  {log.reason && <div style={{ fontSize: 12, color: '#888' }}>Reason: {log.reason}</div>}
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
          items={order.paymentStatusLogs.map((log: PaymentStatusLog) => {
            const status = paymentStatuses.find((s) => s.code === log.paymentStatus.code);
            return {
              label: new Date(log.createdAt).toLocaleString(),
              children: (
                <div>
                  <strong>{status?.name ?? log.paymentStatus.code}</strong>
                  {log.reason && <div style={{ fontSize: 12, color: '#888' }}>Reason: {log.reason}</div>}
                </div>
              ),
            };
          })}
        />
      ) : (
        <Empty />
      )}

      {/* Transition Modals */}
      {statusTransitionOpen && (
        <OrderStatusTransitionModal
          orderId={order.id}
          currentStatus={order.status.code}
          orderStatuses={orderStatuses}
          onClose={() => setStatusTransitionOpen(false)}
          onSuccess={() => {
            message.success('Order status updated');
            onTransitionComplete();
          }}
        />
      )}

      {paymentTransitionOpen && (
        <OrderPaymentTransitionModal
          orderId={order.id}
          currentPaymentStatus={order.paymentStatus.code}
          paymentStatuses={paymentStatuses}
          onClose={() => setPaymentTransitionOpen(false)}
          onSuccess={() => {
            message.success('Payment status updated');
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `npm run typecheck 2>&1 | grep OrderDetailsDrawer || echo "OK"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/orders/OrderDetailsDrawer.tsx
git commit -m "feat(orders): create order details drawer with snapshots and histories"
```

---

### Task 5: Create OrderStatusTransitionModal.tsx

**Files:**
- Create: `dashboard/src/components/orders/OrderStatusTransitionModal.tsx`

**Interfaces:**
- Consumes: `orders.service`, OrderStatus type
- Produces: Modal component for status transitions

- [ ] **Step 1: Create the status transition modal**

```typescript
/**
 * Order status transition modal.
 * 
 * Displays valid next transitions based on the backend transition graph.
 * Initiates the transition via PUT /api/orders/:id/status with status code.
 * Handles errors (409 for invalid transitions, etc).
 */

import { useState } from 'react';
import { Alert, App, Modal, Radio, Select, Space } from 'antd';

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
  const { message } = App.useApp();
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
      await ordersService.updateOrderStatus(orderId, nextStatus);
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
          <Alert
            message="Error updating status"
            description={error}
            type="error"
            showIcon
          />
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `npm run typecheck 2>&1 | grep OrderStatusTransitionModal || echo "OK"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/orders/OrderStatusTransitionModal.tsx
git commit -m "feat(orders): create order status transition modal with validation graph"
```

---

### Task 6: Create OrderPaymentTransitionModal.tsx

**Files:**
- Create: `dashboard/src/components/orders/OrderPaymentTransitionModal.tsx`

**Interfaces:**
- Consumes: `orders.service`, PaymentStatus type
- Produces: Modal component for payment status transitions

- [ ] **Step 1: Create the payment status transition modal**

```typescript
/**
 * Payment status transition modal.
 * 
 * Displays valid next transitions based on the backend payment transition graph.
 * Initiates the transition via PUT /api/orders/:id/payment-status with code.
 */

import { useState } from 'react';
import { Alert, App, Modal, Select, Space } from 'antd';

import type { PaymentStatus } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';

interface OrderPaymentTransitionModalProps {
  orderId: number;
  currentPaymentStatus: string;
  paymentStatuses: PaymentStatus[];
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
  const { message } = App.useApp();
  const [nextStatus, setNextStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTransitions = VALID_PAYMENT_TRANSITIONS[currentPaymentStatus] ?? [];
  const currentStatusLabel =
    paymentStatuses.find((s) => s.code === currentPaymentStatus)?.name ??
    currentPaymentStatus;

  const handleTransition = async () => {
    if (!nextStatus) return;

    setLoading(true);
    setError(null);

    try {
      await ordersService.updatePaymentStatus(orderId, nextStatus);
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `npm run typecheck 2>&1 | grep OrderPaymentTransitionModal || echo "OK"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/orders/OrderPaymentTransitionModal.tsx
git commit -m "feat(orders): create payment status transition modal"
```

---

### Task 7: Wire Routes and Mark Orders Implemented

**Files:**
- Modify: `dashboard/src/routes/modules.tsx`
- Modify: `dashboard/src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: OrdersPage component
- Produces: Orders module marked as implemented, route registered

- [ ] **Step 1: Update modules.tsx to mark Orders as implemented**

Read the file and find the Orders entry and change `implemented: false` to `implemented: true`.

- [ ] **Step 2: Update AppRoutes.tsx to add OrdersPage to PAGES**

Add import:
```typescript
import OrdersPage from '@/pages/OrdersPage';
```

Add to PAGES object:
```typescript
'/orders': <OrdersPage />,
```

- [ ] **Step 3: Verify routes compile**

Run: `npm run typecheck 2>&1 | grep -E "(modules|AppRoutes)" || echo "OK"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/routes/modules.tsx dashboard/src/routes/AppRoutes.tsx
git commit -m "feat(orders): wire routes and mark Orders module as implemented"
```

---

### Task 8: Validation Against Running Backend

**Files:**
- Create: `probe-orders.js` (temporary, deleted after validation)

- [ ] **Step 1: Create and run probe-orders.js**

Create the probe script with comprehensive validation tests covering pagination, sorting, filtering, details, transitions, and permissions. Run against running backend. Verify all scenarios pass.

- [ ] **Step 2: Delete probe**

```bash
rm probe-orders.js
```

- [ ] **Step 3: Run all build/lint checks**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run build
```

Expected: All pass

- [ ] **Step 4: Final commit**

```bash
git add dashboard/src/
git commit -m "feat(orders): complete Orders frontend implementation with validation"
```

---

## Spec Coverage Verification

- [x] **List page with pagination, sorting, filtering** - OrdersPage.tsx
- [x] **Order details drawer with snapshots** - OrderDetailsDrawer.tsx
- [x] **Status transitions** - OrderStatusTransitionModal.tsx
- [x] **Payment transitions** - OrderPaymentTransitionModal.tsx
- [x] **Permissions** - Orders:read and Orders:edit
- [x] **Error handling** - ApiError via toApiError
- [x] **Money formatting** - formatMoney from pricing
- [x] **Master data caching** - Status/payment-status in store
- [x] **Generated Orval client only** - All API via orders.service.ts
- [x] **Routes wired** - modules.tsx and AppRoutes.tsx
- [x] **No order creation** - POST not called
- [x] **Server-side filters** - All backend params
