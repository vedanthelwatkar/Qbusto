/**
 * Cinemas.
 *
 * Server-driven end to end: search - which matches name, code or city - the
 * chain, city and status filters, sorting and paging all become query
 * parameters on GET /api/cinemas. Nothing is filtered or sorted in the browser.
 *
 * The list returns `chainId` and not a chain name, so the names for the rows on
 * screen are resolved by id and kept in a cache that grows as pages are
 * visited, the same way ProductsPage resolves its categories. The chain filter
 * is shown to owners only: every other role is scoped to a single chain and the
 * backend ignores the parameter for them.
 *
 * Buttons follow the Settings module's permissions, which is what the backend
 * authorises cinemas against. That is UX, not enforcement.
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

import type { Cinema, GetApiCinemasParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import ChainSelect from '@/components/chains/ChainSelect';
import CinemaDetailsDrawer from '@/components/cinemas/CinemaDetailsDrawer';
import CinemaFormModal from '@/components/cinemas/CinemaFormModal';
import { toApiError } from '@/services/api';
import { getChain } from '@/services/chains.service';
import * as cinemasService from '@/services/cinemas.service';
import { useAuthStore } from '@/stores/auth.store';
import { useCinemasStore } from '@/stores/cinemas.store';
import { hasPermission } from '@/utils/permissions';

const { Text } = Typography;

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiCinemasParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/cinemas accepts for `sort`. */
const SORTABLE = new Set<string>([
  'id',
  'code',
  'name',
  'city',
  'isActive',
  'createdAt',
  'updatedAt',
]);

export default function CinemasPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useCinemasStore((state) => state.query);
  const cinemas = useCinemasStore((state) => state.cinemas);
  const pagination = useCinemasStore((state) => state.pagination);
  const loading = useCinemasStore((state) => state.loading);
  const error = useCinemasStore((state) => state.error);
  const setQuery = useCinemasStore((state) => state.setQuery);
  const fetch = useCinemasStore((state) => state.fetch);
  const reset = useCinemasStore((state) => state.reset);

  const [formCinema, setFormCinema] = useState<Cinema | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  /** Chain names by id, filled in as pages of cinemas are shown. */
  const [chainNames, setChainNames] = useState<Map<number, string>>(new Map());

  /** Ids already asked for, so a failed or in-flight lookup is not repeated. */
  const requestedChains = useRef(new Set<number>());

  const isOwner = actor?.role === 'owner';
  const canEdit = hasPermission(actor, 'Settings', 'edit');
  const canDelete = hasPermission(actor, 'Settings', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  // Names for the chains on this page, and only those. A non-owner sees a
  // single chain, so this settles after one request for them.
  useEffect(() => {
    const missing = [...new Set(cinemas.map((cinema) => cinema.chainId))].filter(
      (id): id is number => id !== undefined && !requestedChains.current.has(id)
    );

    if (missing.length === 0) return;

    missing.forEach((id) => requestedChains.current.add(id));

    let active = true;

    Promise.all(
      missing.map((id) =>
        getChain(id)
          .then((chain) => [id, chain.name ?? `#${id}`] as const)
          .catch(() => [id, `#${id}`] as const)
      )
    ).then((entries) => {
      if (!active) return;
      setChainNames((current) => new Map([...current, ...entries]));
    });

    return () => {
      active = false;
    };
  }, [cinemas]);

  const openCreate = () => {
    setFormCinema(undefined);
    setFormOpen(true);
  };

  const openEdit = (cinema: Cinema) => {
    setFormCinema(cinema);
    setFormOpen(true);
  };

  const confirmDeactivate = (cinema: Cinema) => {
    if (cinema.id === undefined) return;

    modal.confirm({
      title: `Deactivate ${cinema.name}?`,
      content:
        'Nothing is deleted - screens, orders and pricing all reference it and stay as they are. ' +
        'Its screens are not deactivated with it.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await cinemasService.deactivateCinema(cinema.id as number);
          message.success(`${cinema.name} deactivated`);
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Cinema> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      render: (_, cinema) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(cinema.id)}>
          {cinema.name}
        </Button>
      ),
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      sorter: true,
      render: (_, cinema) => <Text code>{cinema.code}</Text>,
    },
    {
      title: 'City',
      dataIndex: 'city',
      key: 'city',
      sorter: true,
      render: (_, cinema) => cinema.city ?? <Text type="secondary">Not set</Text>,
    },
    {
      title: 'Chain',
      dataIndex: 'chainId',
      key: 'chainId',
      render: (_, cinema) =>
        cinema.chainId === undefined
          ? '-'
          : (chainNames.get(cinema.chainId) ?? `#${cinema.chainId}`),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, cinema) =>
        cinema.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      render: (_, cinema) =>
        cinema.createdAt ? new Date(cinema.createdAt).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, cinema) => {
        const alreadyInactive = cinema.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(cinema.id)}>
              View
            </Button>

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(cinema)}>
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
                    onClick={() => confirmDeactivate(cinema)}
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
    sorter: SorterResult<Cinema> | SorterResult<Cinema>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiCinemasParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  const filtered =
    query.search !== undefined ||
    query.chainId !== undefined ||
    query.city !== undefined ||
    query.isActive !== undefined;

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Cinemas"
        description="Each belongs to one chain, and its code is what appears in QR ordering URLs"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New cinema
              </Button>
            ) : null}
          </Space>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <Input.Search
            allowClear
            placeholder="Search by name, code or city"
            defaultValue={query.search}
            onSearch={(value) => setQuery({ search: value || undefined })}
            style={{ width: 260 }}
          />

          {/* Owners only - the backend ignores chainId for every other role,
              which is already scoped to a single chain. */}
          {isOwner ? (
            <ChainSelect
              allowClear
              includeInactive
              placeholder="Any chain"
              value={query.chainId}
              onChange={(chainId) => setQuery({ chainId: chainId ?? undefined })}
              style={{ width: 200 }}
            />
          ) : null}

          <Input.Search
            allowClear
            placeholder="City"
            defaultValue={query.city}
            onSearch={(value) => setQuery({ city: value || undefined })}
            style={{ width: 180 }}
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

        <Table<Cinema>
          rowKey={(cinema) => String(cinema.id)}
          columns={columns}
          dataSource={cinemas}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1000 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load cinemas" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No cinemas match these filters' : 'No cinemas yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} cinema${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <CinemaFormModal
          cinema={formCinema}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <CinemaDetailsDrawer
          cinemaId={detailsId}
          chainNames={chainNames}
          onClose={() => setDetailsId(undefined)}
        />
      ) : null}
    </Space>
  );
}
