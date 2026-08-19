/**
 * Products.
 *
 * Server-driven end to end: search, the category / add-on / status filters,
 * sorting and paging all become query parameters on GET /api/products, so what
 * the table shows is always what the backend selected for this user's tenant
 * scope. Nothing is filtered or sorted in the browser.
 *
 * The list returns `categoryId` and not a category name, so the names for the
 * rows on screen are resolved by id and kept in a cache that grows as pages are
 * visited. That is a handful of small requests per page rather than a fixed
 * slice of the catalogue, so it stays correct however many categories exist.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import type { GetApiProductsParams, Product } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CategorySelect from '@/components/categories/CategorySelect';
import ProductAvailabilityDrawer from '@/components/products/ProductAvailabilityDrawer';
import ProductDetailsDrawer from '@/components/products/ProductDetailsDrawer';
import ProductFormModal from '@/components/products/ProductFormModal';
import { toApiError } from '@/services/api';
import { getCategory } from '@/services/categories.service';
import * as productsService from '@/services/products.service';
import { useAuthStore } from '@/stores/auth.store';
import { useProductsStore } from '@/stores/products.store';
import { hasPermission } from '@/utils/permissions';

const { Text } = Typography;

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiProductsParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/products accepts for `sort`. */
const SORTABLE = new Set<string>([
  'id',
  'name',
  'categoryId',
  'isAddon',
  'isActive',
  'createdAt',
  'updatedAt',
]);

export default function ProductsPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useProductsStore((state) => state.query);
  const products = useProductsStore((state) => state.products);
  const pagination = useProductsStore((state) => state.pagination);
  const loading = useProductsStore((state) => state.loading);
  const error = useProductsStore((state) => state.error);
  const setQuery = useProductsStore((state) => state.setQuery);
  const fetch = useProductsStore((state) => state.fetch);
  const reset = useProductsStore((state) => state.reset);

  const [formProduct, setFormProduct] = useState<Product | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  /**
   * The product whose availability is being viewed. The whole row rather than
   * an id: the drawer names the product and narrows its cinema list to the
   * product's chain, and both are already on the row.
   */
  const [availabilityProduct, setAvailabilityProduct] = useState<Product | undefined>();

  /** Category names by id, filled in as pages of products are shown. */
  const [categoryNames, setCategoryNames] = useState<Map<number, string>>(new Map());

  /** Ids already asked for, so a failed or in-flight lookup is not repeated. */
  const requestedCategories = useRef(new Set<number>());

  // Read is what the route already required to get here, so it is only checked
  // again for the availability drawer - its own reads are authorised as
  // Products too, and a user who cannot read them should not be offered them.
  const canRead = hasPermission(actor, 'Products', 'read');
  const canEdit = hasPermission(actor, 'Products', 'edit');
  const canDelete = hasPermission(actor, 'Products', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  // Names for the categories on this page, and only those. Categories are
  // authorised as their own module, so this 403s for a product editor without
  // Categories read - that is not worth an error, the column keeps the id.
  useEffect(() => {
    const missing = [...new Set(products.map((product) => product.categoryId))].filter(
      (id): id is number => id !== undefined && !requestedCategories.current.has(id)
    );

    if (missing.length === 0) return;

    missing.forEach((id) => requestedCategories.current.add(id));

    let active = true;

    Promise.all(
      missing.map((id) =>
        getCategory(id)
          .then((category) => [id, category.name ?? `#${id}`] as const)
          .catch(() => [id, `#${id}`] as const)
      )
    ).then((entries) => {
      if (!active) return;
      setCategoryNames((current) => new Map([...current, ...entries]));
    });

    return () => {
      active = false;
    };
  }, [products]);

  const openCreate = () => {
    setFormProduct(undefined);
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setFormProduct(product);
    setFormOpen(true);
  };

  const confirmDeactivate = (product: Product) => {
    if (product.id === undefined) return;

    modal.confirm({
      title: `Deactivate ${product.name}?`,
      content:
        'It will stop being orderable. Nothing is deleted - order items, pricing and POS ' +
        'mappings all reference it and stay as they are.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await productsService.deactivateProduct(product.id as number);
          message.success(`${product.name} deactivated`);
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Product> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      render: (_, product) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(product.id)}>
          {product.name}
        </Button>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'categoryId',
      key: 'categoryId',
      sorter: true,
      render: (_, product) =>
        product.categoryId === undefined
          ? '-'
          : (categoryNames.get(product.categoryId) ?? `#${product.categoryId}`),
    },
    {
      title: 'Type',
      dataIndex: 'isAddon',
      key: 'isAddon',
      sorter: true,
      render: (_, product) =>
        product.isAddon ? <Tag color="processing">Add-on</Tag> : <Tag>Standalone</Tag>,
    },
    {
      title: 'Weight',
      dataIndex: 'weight',
      key: 'weight',
      render: (_, product) => product.weight ?? <Text type="secondary">-</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, product) =>
        product.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      render: (_, product) =>
        product.createdAt ? new Date(product.createdAt).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 320,
      render: (_, product) => {
        const alreadyInactive = product.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(product.id)}>
              View
            </Button>

            {canRead ? (
              <Button size="small" onClick={() => setAvailabilityProduct(product)}>
                Availability
              </Button>
            ) : null}

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(product)}>
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
                    onClick={() => confirmDeactivate(product)}
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
    sorter: SorterResult<Product> | SorterResult<Product>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiProductsParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  const filtered =
    query.search !== undefined ||
    query.categoryId !== undefined ||
    query.isAddon !== undefined ||
    query.isActive !== undefined;

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Products"
        description="Everything that can be ordered, and the add-ons that go with it"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New product
              </Button>
            ) : null}
          </Space>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <Input.Search
            allowClear
            placeholder="Search by name"
            defaultValue={query.search}
            onSearch={(value) => setQuery({ search: value || undefined })}
            style={{ width: 260 }}
          />

          <CategorySelect
            allowClear
            includeInactive
            placeholder="Any category"
            value={query.categoryId}
            onChange={(categoryId) => setQuery({ categoryId: categoryId ?? undefined })}
            style={{ width: 200 }}
          />

          <Select
            allowClear
            placeholder="Any type"
            value={query.isAddon}
            onChange={(isAddon) => setQuery({ isAddon })}
            options={[
              { value: false, label: 'Standalone' },
              { value: true, label: 'Add-on' },
            ]}
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

        <Table<Product>
          rowKey={(product) => String(product.id)}
          columns={columns}
          dataSource={products}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1120 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load products" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No products match these filters' : 'No products yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} product${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <ProductFormModal
          product={formProduct}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <ProductDetailsDrawer
          productId={detailsId}
          categoryNames={categoryNames}
          onClose={() => setDetailsId(undefined)}
        />
      ) : null}

      {/* Availability lives in the product workflow rather than the sidebar:
          a window belongs to this product at one cinema, so there is nothing
          to show until a product has been picked. */}
      {availabilityProduct ? (
        <ProductAvailabilityDrawer
          product={availabilityProduct}
          onClose={() => setAvailabilityProduct(undefined)}
        />
      ) : null}
    </Space>
  );
}
