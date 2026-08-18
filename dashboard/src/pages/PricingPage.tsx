/**
 * Pricing.
 *
 * Server-driven end to end: the cinema, product, day and status filters,
 * sorting and paging all become query parameters on GET /api/product-pricing,
 * so what the table shows is always what the backend selected for this user's
 * tenant scope. Nothing is filtered or sorted in the browser.
 *
 * There is no search box, because the endpoint has no `search` parameter - a
 * price row has no name of its own to match on. Narrowing is done with the
 * cinema and product selectors, which do search their own endpoints.
 *
 * The list returns `cinemaId` and `productId` and not names, so the names for
 * the rows on screen are resolved by id and kept in caches that grow as pages
 * are visited. That is a handful of small requests per page rather than a fixed
 * slice of either catalogue, so it stays correct however many of each exist.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import type {
  GetApiProductPricingParams,
  ProductPricing,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import PricingDetailsDrawer from '@/components/pricing/PricingDetailsDrawer';
import PricingFormModal from '@/components/pricing/PricingFormModal';
import { DAY_OF_WEEK_OPTIONS, dayOfWeekLabel } from '@/components/pricing/days';
import { formatDiscount, formatMoney } from '@/components/pricing/money';
import ProductSelect from '@/components/products/ProductSelect';
import { toApiError } from '@/services/api';
import { getCinema } from '@/services/cinemas.service';
import * as pricingService from '@/services/pricing.service';
import { getProduct } from '@/services/products.service';
import { useAuthStore } from '@/stores/auth.store';
import { usePricingStore } from '@/stores/pricing.store';
import { hasPermission } from '@/utils/permissions';

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiProductPricingParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/product-pricing accepts for `sort`. */
const SORTABLE = new Set<string>([
  'id',
  'cinemaId',
  'productId',
  'dayOfWeek',
  'basePrice',
  'isActive',
  'createdAt',
  'updatedAt',
]);

export default function PricingPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = usePricingStore((state) => state.query);
  const pricings = usePricingStore((state) => state.pricings);
  const pagination = usePricingStore((state) => state.pagination);
  const loading = usePricingStore((state) => state.loading);
  const error = usePricingStore((state) => state.error);
  const setQuery = usePricingStore((state) => state.setQuery);
  const fetch = usePricingStore((state) => state.fetch);
  const reset = usePricingStore((state) => state.reset);

  const [formPricing, setFormPricing] = useState<ProductPricing | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  /** Names by id, filled in as pages of prices are shown. */
  const [cinemaNames, setCinemaNames] = useState<Map<number, string>>(new Map());
  const [productNames, setProductNames] = useState<Map<number, string>>(new Map());

  /** Ids already asked for, so a failed or in-flight lookup is not repeated. */
  const requestedCinemas = useRef(new Set<number>());
  const requestedProducts = useRef(new Set<number>());

  const canEdit = hasPermission(actor, 'Pricing', 'edit');
  const canDelete = hasPermission(actor, 'Pricing', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  // Names for the cinemas on this page, and only those. Cinemas are authorised
  // as Settings, so this 403s for a pricing editor without that module - not
  // worth an error, the column keeps the id.
  useEffect(() => {
    const missing = [...new Set(pricings.map((row) => row.cinemaId))].filter(
      (id): id is number => id !== undefined && !requestedCinemas.current.has(id)
    );

    if (missing.length === 0) return;

    missing.forEach((id) => requestedCinemas.current.add(id));

    let active = true;

    Promise.all(
      missing.map((id) =>
        getCinema(id)
          .then((cinema) => [id, cinema.name ?? `#${id}`] as const)
          .catch(() => [id, `#${id}`] as const)
      )
    ).then((entries) => {
      if (!active) return;
      setCinemaNames((current) => new Map([...current, ...entries]));
    });

    return () => {
      active = false;
    };
  }, [pricings]);

  // The same for products, which are authorised as their own module.
  useEffect(() => {
    const missing = [...new Set(pricings.map((row) => row.productId))].filter(
      (id): id is number => id !== undefined && !requestedProducts.current.has(id)
    );

    if (missing.length === 0) return;

    missing.forEach((id) => requestedProducts.current.add(id));

    let active = true;

    Promise.all(
      missing.map((id) =>
        getProduct(id)
          .then((product) => [id, product.name ?? `#${id}`] as const)
          .catch(() => [id, `#${id}`] as const)
      )
    ).then((entries) => {
      if (!active) return;
      setProductNames((current) => new Map([...current, ...entries]));
    });

    return () => {
      active = false;
    };
  }, [pricings]);

  const openCreate = () => {
    setFormPricing(undefined);
    setFormOpen(true);
  };

  const openEdit = (pricing: ProductPricing) => {
    setFormPricing(pricing);
    setFormOpen(true);
  };

  const describe = (pricing: ProductPricing) => {
    const product =
      pricing.productId === undefined
        ? 'this price'
        : (productNames.get(pricing.productId) ?? `#${pricing.productId}`);

    return `${product} (${dayOfWeekLabel(pricing.dayOfWeek).toLowerCase()})`;
  };

  const confirmDeactivate = (pricing: ProductPricing) => {
    if (pricing.id === undefined) return;

    modal.confirm({
      title: `Deactivate the price for ${describe(pricing)}?`,
      content:
        'It will stop being charged. Nothing is deleted - orders already placed are priced ' +
        'from this row and keep referencing it.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await pricingService.deactivatePricing(pricing.id as number);
          message.success('Price deactivated');
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<ProductPricing> = [
    {
      title: 'Product',
      dataIndex: 'productId',
      key: 'productId',
      sorter: true,
      render: (_, pricing) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(pricing.id)}>
          {pricing.productId === undefined
            ? '-'
            : (productNames.get(pricing.productId) ?? `#${pricing.productId}`)}
        </Button>
      ),
    },
    {
      title: 'Cinema',
      dataIndex: 'cinemaId',
      key: 'cinemaId',
      sorter: true,
      render: (_, pricing) =>
        pricing.cinemaId === undefined
          ? '-'
          : (cinemaNames.get(pricing.cinemaId) ?? `#${pricing.cinemaId}`),
    },
    {
      title: 'Day',
      dataIndex: 'dayOfWeek',
      key: 'dayOfWeek',
      sorter: true,
      render: (_, pricing) => dayOfWeekLabel(pricing.dayOfWeek),
    },
    {
      title: 'Base price',
      dataIndex: 'basePrice',
      key: 'basePrice',
      sorter: true,
      align: 'right',
      render: (_, pricing) => formatMoney(pricing.basePrice),
    },
    {
      title: 'Discount',
      key: 'discount',
      render: (_, pricing) => {
        if (!pricing.discountType) return <Tag>None</Tag>;

        // A type with no default amount still discounts - the channel columns
        // carry their own values - so the type is named rather than shown as
        // nothing at all.
        const shown = formatDiscount(pricing.discountValue, pricing.discountType);

        return (
          <Tag color="processing">
            {shown === '-' ? (pricing.discountType === 'P' ? 'Percentage' : 'Flat') : shown}
          </Tag>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, pricing) =>
        pricing.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, pricing) => {
        const alreadyInactive = pricing.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(pricing.id)}>
              View
            </Button>

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(pricing)}>
                Edit
              </Button>
            ) : null}

            {/* The span is what makes the tooltip work: a disabled button fires
                no mouse events, so a Tooltip wrapped straight around one never
                opens. */}
            {canDelete ? (
              <Tooltip title={alreadyInactive ? 'Already inactive' : ''}>
                <span>
                  <Button
                    size="small"
                    danger
                    disabled={alreadyInactive}
                    onClick={() => confirmDeactivate(pricing)}
                  >
                    Deactivate
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const handleTableChange = (
    next: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<ProductPricing> | SorterResult<ProductPricing>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiProductPricingParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  const filtered =
    query.cinemaId !== undefined ||
    query.productId !== undefined ||
    query.dayOfWeek !== undefined ||
    query.isActive !== undefined;

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Pricing"
        description="What each product costs, per cinema and per day"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New price
              </Button>
            ) : null}
          </Space>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <CinemaSelect
            allowClear
            includeInactive
            placeholder="Any cinema"
            value={query.cinemaId}
            onChange={(cinemaId) => setQuery({ cinemaId: cinemaId ?? undefined })}
            style={{ width: 220 }}
          />

          <ProductSelect
            allowClear
            includeInactive
            placeholder="Any product"
            value={query.productId}
            onChange={(productId) => setQuery({ productId: productId ?? undefined })}
            style={{ width: 220 }}
          />

          <Select
            allowClear
            placeholder="Any day"
            value={query.dayOfWeek}
            onChange={(dayOfWeek) => setQuery({ dayOfWeek })}
            options={DAY_OF_WEEK_OPTIONS}
            style={{ width: 160 }}
          />

          <Select
            allowClear
            placeholder="Any status"
            value={query.isActive}
            onChange={(isActive) => setQuery({ isActive })}
            options={[
              { value: true, label: 'Active' },
              { value: false, label: 'Inactive' },
            ]}
            style={{ width: 160 }}
          />
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

        <Table<ProductPricing>
          rowKey={(pricing) => String(pricing.id)}
          columns={columns}
          dataSource={pricings}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1000 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load pricing" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No prices match these filters' : 'No prices yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} price${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <PricingFormModal
          pricing={formPricing}
          defaultCinemaId={query.cinemaId}
          defaultProductId={query.productId}
          cinemaNames={cinemaNames}
          productNames={productNames}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <PricingDetailsDrawer
          pricingId={detailsId}
          cinemaNames={cinemaNames}
          productNames={productNames}
          onClose={() => setDetailsId(undefined)}
        />
      ) : null}
    </Space>
  );
}
