/**
 * Banners.
 *
 * Server-driven end to end: the cinema, placement and status filters, sorting
 * and paging all become query parameters on GET /api/banners, so what the table
 * shows is always what the backend selected for this user's tenant scope.
 * Nothing is filtered or sorted in the browser.
 *
 * There is no search box, because the endpoint has no `search` parameter - a
 * banner has no name, only an image and a position. Narrowing is done with the
 * cinema selector, which does search its own endpoint.
 *
 * The default ordering is ascending `sequence` and not newest-first, because
 * that is the order the banners actually appear in. Sorting by anything else
 * makes the sequence column stop reading as a running order, which is why it is
 * what the table falls back to when a sort is cleared.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import type { Banner, GetApiBannersParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import BannerDetailsDrawer from '@/components/banners/BannerDetailsDrawer';
import BannerFormModal from '@/components/banners/BannerFormModal';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { toApiError } from '@/services/api';
import * as bannersService from '@/services/banners.service';
import { getCinema } from '@/services/cinemas.service';
import { useAuthStore } from '@/stores/auth.store';
import { useBannersStore } from '@/stores/banners.store';
import { hasPermission } from '@/utils/permissions';

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiBannersParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/banners accepts for `sort`. */
const SORTABLE = new Set<string>([
  'id',
  'cinemaId',
  'sequence',
  'type',
  'startDate',
  'isActive',
  'createdAt',
]);

export default function BannersPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useBannersStore((state) => state.query);
  const banners = useBannersStore((state) => state.banners);
  const pagination = useBannersStore((state) => state.pagination);
  const loading = useBannersStore((state) => state.loading);
  const error = useBannersStore((state) => state.error);
  const setQuery = useBannersStore((state) => state.setQuery);
  const fetch = useBannersStore((state) => state.fetch);
  const reset = useBannersStore((state) => state.reset);

  const [formBanner, setFormBanner] = useState<Banner | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  /** Cinema names by id, filled in as pages of banners are shown. */
  const [cinemaNames, setCinemaNames] = useState<Map<number, string>>(new Map());

  /** Ids already asked for, so a failed or in-flight lookup is not repeated. */
  const requestedCinemas = useRef(new Set<number>());

  const canEdit = hasPermission(actor, 'Banners', 'edit');
  const canDelete = hasPermission(actor, 'Banners', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  // Names for the cinemas on this page, and only those. Cinemas are authorised
  // as Settings, so this 403s for a banner editor without that module - not
  // worth an error, the column keeps the id.
  useEffect(() => {
    const missing = [...new Set(banners.map((banner) => banner.cinemaId))].filter(
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
  }, [banners]);

  const openCreate = () => {
    setFormBanner(undefined);
    setFormOpen(true);
  };

  const openEdit = (banner: Banner) => {
    setFormBanner(banner);
    setFormOpen(true);
  };

  const confirmDeactivate = (banner: Banner) => {
    if (banner.id === undefined) return;

    modal.confirm({
      title:
        banner.sequence === undefined
          ? 'Deactivate this banner?'
          : `Deactivate banner ${banner.sequence}?`,
      content:
        'It will stop being shown. Nothing is deleted, and its sequence stays reserved, so ' +
        'the banner can be brought back into the same slot.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await bannersService.deactivateBanner(banner.id as number);
          message.success('Banner deactivated');
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Banner> = [
    {
      title: 'Sequence',
      dataIndex: 'sequence',
      key: 'sequence',
      sorter: true,
      width: 120,
      render: (_, banner) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(banner.id)}>
          {banner.sequence ?? '-'}
        </Button>
      ),
    },
    {
      title: 'Cinema',
      dataIndex: 'cinemaId',
      key: 'cinemaId',
      sorter: true,
      render: (_, banner) =>
        banner.cinemaId === undefined
          ? '-'
          : (cinemaNames.get(banner.cinemaId) ?? `#${banner.cinemaId}`),
    },
    {
      title: 'Placement',
      dataIndex: 'type',
      key: 'type',
      sorter: true,
      render: (_, banner) =>
        banner.type === 'I' ? <Tag>Inner</Tag> : <Tag color="processing">Header</Tag>,
    },
    {
      title: 'Image',
      dataIndex: 'imageUrl',
      key: 'imageUrl',
      ellipsis: true,
      render: (_, banner) => banner.imageUrl ?? '-',
    },
    {
      title: 'Window',
      key: 'window',
      render: (_, banner) => {
        if (!banner.startDate && !banner.endDate) return 'Always';

        const from = banner.startDate ? new Date(banner.startDate).toLocaleDateString() : 'Any';
        const to = banner.endDate ? new Date(banner.endDate).toLocaleDateString() : 'Any';

        return `${from} - ${to}`;
      },
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, banner) =>
        banner.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, banner) => {
        const alreadyInactive = banner.isActive === false;

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(banner.id)}>
              View
            </Button>

            {canEdit ? (
              <Button size="small" onClick={() => openEdit(banner)}>
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
                    onClick={() => confirmDeactivate(banner)}
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
    sorter: SorterResult<Banner> | SorterResult<Banner>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the display order.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiBannersParams['sort'], order: ORDER[active.order] }
        : { sort: 'sequence', order: 'asc' }),
    });
  };

  const filtered =
    query.cinemaId !== undefined || query.type !== undefined || query.isActive !== undefined;

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Banners"
        description="The artwork each cinema shows, and the order it appears in"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New banner
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

          <Select
            allowClear
            placeholder="Any placement"
            value={query.type}
            onChange={(type) => setQuery({ type })}
            options={[
              { value: 'H', label: 'Header' },
              { value: 'I', label: 'Inner' },
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

        <Table<Banner>
          rowKey={(banner) => String(banner.id)}
          columns={columns}
          dataSource={banners}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1000 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load banners" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No banners match these filters' : 'No banners yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} banner${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <BannerFormModal
          banner={formBanner}
          defaultCinemaId={query.cinemaId}
          cinemaNames={cinemaNames}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <BannerDetailsDrawer
          bannerId={detailsId}
          cinemaNames={cinemaNames}
          onClose={() => setDetailsId(undefined)}
        />
      ) : null}
    </Space>
  );
}
