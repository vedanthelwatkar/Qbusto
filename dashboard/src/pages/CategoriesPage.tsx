/**
 * Categories.
 *
 * Server-driven end to end: search, the status filter, sorting and paging all
 * become query parameters on GET /api/categories, so what the table shows is
 * always what the backend selected for this user's tenant scope. Nothing is
 * filtered or sorted in the browser.
 *
 * Buttons follow the Categories module's own permissions - edit for creating
 * and editing, delete for deactivating. That is UX, not enforcement: the
 * backend checks the same permissions on every request.
 */

import { useEffect, useState } from 'react';
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

import type { Category, GetApiCategoriesParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CategoryDetailsDrawer from '@/components/categories/CategoryDetailsDrawer';
import CategoryFormModal from '@/components/categories/CategoryFormModal';
import { toApiError } from '@/services/api';
import * as categoriesService from '@/services/categories.service';
import { useAuthStore } from '@/stores/auth.store';
import { useCategoriesStore } from '@/stores/categories.store';
import { hasPermission } from '@/utils/permissions';

const { Text } = Typography;

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiCategoriesParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/categories accepts for `sort`. */
const SORTABLE = new Set<string>(['id', 'name', 'isActive', 'createdAt', 'updatedAt']);

export default function CategoriesPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useCategoriesStore((state) => state.query);
  const categories = useCategoriesStore((state) => state.categories);
  const pagination = useCategoriesStore((state) => state.pagination);
  const loading = useCategoriesStore((state) => state.loading);
  const error = useCategoriesStore((state) => state.error);
  const setQuery = useCategoriesStore((state) => state.setQuery);
  const fetch = useCategoriesStore((state) => state.fetch);
  const reset = useCategoriesStore((state) => state.reset);

  const [formCategory, setFormCategory] = useState<Category | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  const canEdit = hasPermission(actor, 'Categories', 'edit');
  const canDelete = hasPermission(actor, 'Categories', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  const openCreate = () => {
    setFormCategory(undefined);
    setFormOpen(true);
  };

  const openEdit = (category: Category) => {
    setFormCategory(category);
    setFormOpen(true);
  };

  const confirmDeactivate = (category: Category) => {
    if (category.id === undefined) return;

    modal.confirm({
      title: `Deactivate ${category.name}?`,
      content:
        'It will stop being offered. Nothing is deleted, and the products filed under it are ' +
        'left untouched - deactivating a category is not a cascade.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await categoriesService.deactivateCategory(category.id as number);
          message.success(`${category.name} deactivated`);
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Category> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      render: (_, category) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(category.id)}>
          {category.name}
        </Button>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (_, category) =>
        category.description ? (
          <Text ellipsis={{ tooltip: category.description }} className="table-cell--clamped">
            {category.description}
          </Text>
        ) : (
          <Text type="secondary">Not set</Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, category) =>
        category.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      render: (_, category) =>
        category.createdAt ? new Date(category.createdAt).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, category) => {
        const alreadyInactive = category.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(category.id)}>
              View
            </Button>

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(category)}>
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
                    onClick={() => confirmDeactivate(category)}
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
    sorter: SorterResult<Category> | SorterResult<Category>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiCategoriesParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Categories"
        description="How products are grouped for ordering"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New category
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

        <Table<Category>
          rowKey={(category) => String(category.id)}
          columns={columns}
          dataSource={categories}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 800 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load categories" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query.search || query.isActive !== undefined
                    ? 'No categories match these filters'
                    : 'No categories yet'
                }
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} categor${total === 1 ? 'y' : 'ies'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <CategoryFormModal
          category={formCategory}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <CategoryDetailsDrawer categoryId={detailsId} onClose={() => setDetailsId(undefined)} />
      ) : null}
    </Space>
  );
}
