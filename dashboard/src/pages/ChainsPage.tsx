/**
 * Chains.
 *
 * Server-driven end to end: search, the status filter, sorting and paging all
 * become query parameters on GET /api/chains, so what the table shows is always
 * what the backend selected for this user's tenant scope. Nothing is filtered
 * or sorted in the browser.
 *
 * A chain *is* the tenant, so a non-owner sees exactly one row - their own -
 * and creating is offered to owners alone. That is not a rule invented here:
 * chain.service refuses a create from anyone else, because tenant scope would
 * make the new row unreadable to its own creator.
 *
 * Buttons follow the Settings module's permissions, which is what the backend
 * authorises chains against. That is UX, not enforcement.
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

import type { Chain, GetApiChainsParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import ChainDetailsDrawer from '@/components/chains/ChainDetailsDrawer';
import ChainFormModal from '@/components/chains/ChainFormModal';
import { toApiError } from '@/services/api';
import * as chainsService from '@/services/chains.service';
import { useAuthStore } from '@/stores/auth.store';
import { useChainsStore } from '@/stores/chains.store';
import { hasPermission } from '@/utils/permissions';

const { Text } = Typography;

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiChainsParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/chains accepts for `sort`. */
const SORTABLE = new Set<string>(['id', 'name', 'isActive', 'createdAt', 'updatedAt']);

export default function ChainsPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useChainsStore((state) => state.query);
  const chains = useChainsStore((state) => state.chains);
  const pagination = useChainsStore((state) => state.pagination);
  const loading = useChainsStore((state) => state.loading);
  const error = useChainsStore((state) => state.error);
  const setQuery = useChainsStore((state) => state.setQuery);
  const fetch = useChainsStore((state) => state.fetch);
  const reset = useChainsStore((state) => state.reset);

  const [formChain, setFormChain] = useState<Chain | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  const canEdit = hasPermission(actor, 'Settings', 'edit');
  const canDelete = hasPermission(actor, 'Settings', 'delete');

  /** Mirrors chain.service.assertMayCreateChain, which is the real authority. */
  const canCreate = canEdit && actor?.role === 'owner';

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  const openCreate = () => {
    setFormChain(undefined);
    setFormOpen(true);
  };

  const openEdit = (chain: Chain) => {
    setFormChain(chain);
    setFormOpen(true);
  };

  const confirmDeactivate = (chain: Chain) => {
    if (chain.id === undefined) return;

    modal.confirm({
      title: `Deactivate ${chain.name}?`,
      content:
        'Nothing is deleted, and this does not cascade - the cinemas, users, categories and ' +
        'products under this chain are left exactly as they are.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await chainsService.deactivateChain(chain.id as number);
          message.success(`${chain.name} deactivated`);
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Chain> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      render: (_, chain) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(chain.id)}>
          {chain.name}
        </Button>
      ),
    },
    {
      title: 'Logo',
      dataIndex: 'logoImageUrl',
      key: 'logoImageUrl',
      render: (_, chain) =>
        chain.logoImageUrl ? (
          <Text ellipsis={{ tooltip: chain.logoImageUrl }} className="table-cell--clamped">
            {chain.logoImageUrl}
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
      render: (_, chain) =>
        chain.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      render: (_, chain) =>
        chain.createdAt ? new Date(chain.createdAt).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, chain) => {
        const alreadyInactive = chain.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(chain.id)}>
              View
            </Button>

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(chain)}>
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
                    onClick={() => confirmDeactivate(chain)}
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
    sorter: SorterResult<Chain> | SorterResult<Chain>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiChainsParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Chains"
        description="The top of the tenant tree - cinemas, users, categories and products all belong to one"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canCreate ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New chain
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

        <Table<Chain>
          rowKey={(chain) => String(chain.id)}
          columns={columns}
          dataSource={chains}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 800 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load chains" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query.search || query.isActive !== undefined
                    ? 'No chains match these filters'
                    : 'No chains yet'
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
            showTotal: (total) => `${total} chain${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <ChainFormModal
          chain={formChain}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <ChainDetailsDrawer chainId={detailsId} onClose={() => setDetailsId(undefined)} />
      ) : null}
    </Space>
  );
}
