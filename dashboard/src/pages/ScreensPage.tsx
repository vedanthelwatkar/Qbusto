/**
 * Screens.
 *
 * Server-driven end to end: search, the cinema and status filters, sorting and
 * paging all become query parameters on GET /api/screens. Nothing is filtered
 * or sorted in the browser.
 *
 * A screen has no chain of its own - tenant scope reaches it through its
 * cinema - and the list returns `cinemaId` rather than a cinema name, so the
 * names for the rows on screen are resolved by id and cached as pages are
 * visited, the same way CinemasPage resolves its chains.
 *
 * Buttons follow the Settings module's permissions, which is what the backend
 * authorises screens against. That is UX, not enforcement.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import type { GetApiScreensParams, Screen } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import ScreenDetailsDrawer from '@/components/screens/ScreenDetailsDrawer';
import ScreenFormModal from '@/components/screens/ScreenFormModal';
import { toApiError } from '@/services/api';
import { getCinema } from '@/services/cinemas.service';
import * as screensService from '@/services/screens.service';
import { useAuthStore } from '@/stores/auth.store';
import { useScreensStore } from '@/stores/screens.store';
import { hasPermission } from '@/utils/permissions';

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiScreensParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/screens accepts for `sort`. */
const SORTABLE = new Set<string>(['id', 'name', 'cinemaId', 'isActive', 'createdAt', 'updatedAt']);

export default function ScreensPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useScreensStore((state) => state.query);
  const screens = useScreensStore((state) => state.screens);
  const pagination = useScreensStore((state) => state.pagination);
  const loading = useScreensStore((state) => state.loading);
  const error = useScreensStore((state) => state.error);
  const setQuery = useScreensStore((state) => state.setQuery);
  const fetch = useScreensStore((state) => state.fetch);
  const reset = useScreensStore((state) => state.reset);

  const [formScreen, setFormScreen] = useState<Screen | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  /** Cinema names by id, filled in as pages of screens are shown. */
  const [cinemaNames, setCinemaNames] = useState<Map<number, string>>(new Map());

  /** Ids already asked for, so a failed or in-flight lookup is not repeated. */
  const requestedCinemas = useRef(new Set<number>());

  const canEdit = hasPermission(actor, 'Settings', 'edit');
  const canDelete = hasPermission(actor, 'Settings', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  // Names for the cinemas on this page, and only those.
  useEffect(() => {
    const missing = [...new Set(screens.map((screen) => screen.cinemaId))].filter(
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
  }, [screens]);

  const openCreate = () => {
    setFormScreen(undefined);
    setFormOpen(true);
  };

  const openEdit = (screen: Screen) => {
    setFormScreen(screen);
    setFormOpen(true);
  };

  const confirmDeactivate = (screen: Screen) => {
    if (screen.id === undefined) return;

    modal.confirm({
      title: `Deactivate ${screen.name}?`,
      content:
        'Nothing is deleted - orders and POS mappings reference it and stay as they are. Its ' +
        'name stays taken within the cinema, because names are unique there counting ' +
        'deactivated screens.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await screensService.deactivateScreen(screen.id as number);
          message.success(`${screen.name} deactivated`);
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Screen> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      render: (_, screen) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(screen.id)}>
          {screen.name}
        </Button>
      ),
    },
    {
      title: 'Cinema',
      dataIndex: 'cinemaId',
      key: 'cinemaId',
      sorter: true,
      render: (_, screen) =>
        screen.cinemaId === undefined
          ? '-'
          : (cinemaNames.get(screen.cinemaId) ?? `#${screen.cinemaId}`),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, screen) =>
        screen.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      render: (_, screen) =>
        screen.createdAt ? new Date(screen.createdAt).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, screen) => {
        const alreadyInactive = screen.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(screen.id)}>
              View
            </Button>

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(screen)}>
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
                    onClick={() => confirmDeactivate(screen)}
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
    sorter: SorterResult<Screen> | SorterResult<Screen>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiScreensParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  const filtered =
    query.search !== undefined || query.cinemaId !== undefined || query.isActive !== undefined;

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Screens"
        description="Each belongs to one cinema, and orders are placed against it"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New screen
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

          <CinemaSelect
            allowClear
            includeInactive
            placeholder="Any cinema"
            value={query.cinemaId}
            onChange={(cinemaId) => setQuery({ cinemaId: cinemaId ?? undefined })}
            style={{ width: 240 }}
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

        <Table<Screen>
          rowKey={(screen) => String(screen.id)}
          columns={columns}
          dataSource={screens}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 900 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load screens" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No screens match these filters' : 'No screens yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} screen${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <ScreenFormModal
          screen={formScreen}
          // Creating from a list already narrowed to one cinema starts there.
          defaultCinemaId={query.cinemaId}
          cinemaNames={cinemaNames}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <ScreenDetailsDrawer
          screenId={detailsId}
          cinemaNames={cinemaNames}
          onClose={() => setDetailsId(undefined)}
        />
      ) : null}
    </Space>
  );
}
