/**
 * Offers (coupons).
 *
 * Server-driven end to end, same as Categories: search, filters, sorting and
 * paging all become query parameters on GET /api/offers. Nothing is filtered
 * or sorted in the browser.
 *
 * These are QBusto-side only - Cashfree never sees a coupon or its discount.
 * A customer applies one in the Consumer app's cart; the backend validates it
 * against this table and subtracts the discount before payment-init is ever
 * called.
 *
 * Local component state rather than a dedicated Zustand store: unlike
 * Categories/Banners, nothing else in the dashboard needs to read the offers
 * list, so a store would only add indirection here.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Empty, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import type { GetApiOffersParams, Offer } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import OfferFormModal from '@/components/offers/OfferFormModal';
import { toApiError } from '@/services/api';
import * as offersService from '@/services/offers.service';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import type { Pagination } from '@/types/api';

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiOffersParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

const SORTABLE = new Set<string>(['id', 'cinemaId', 'code', 'status', 'validFrom', 'createdAt']);

const DEFAULT_QUERY: GetApiOffersParams = { page: 1, limit: 20, sort: 'createdAt', order: 'desc' };

function formatMoney(value: number | null | undefined): string {
  return value == null ? '-' : `₹${value}`;
}

export default function OffersPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const [query, setQueryState] = useState<GetApiOffersParams>(DEFAULT_QUERY);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOffer, setFormOffer] = useState<Offer | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  const canEdit = hasPermission(actor, 'Offers', 'edit');
  const canDelete = hasPermission(actor, 'Offers', 'delete');

  const setQuery = (patch: Partial<GetApiOffersParams>) =>
    setQueryState((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await offersService.listOffers(query);
      setOffers(result.offers);
      setPagination(result.pagination);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // fetchOffers sets loading/error synchronously before its first await -
    // the standard "refetch when the query changes" shape, flagged by this
    // rule the same way it would flag any effect-driven data fetch that
    // isn't routed through a store action (compare CategoriesPage, which
    // dodges the same warning only because its fetch lives in Zustand).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOffers();
  }, [fetchOffers]);

  const openCreate = () => {
    setFormOffer(undefined);
    setFormOpen(true);
  };

  const openEdit = (offer: Offer) => {
    setFormOffer(offer);
    setFormOpen(true);
  };

  const confirmDelete = (offer: Offer) => {
    if (offer.id === undefined) return;

    modal.confirm({
      title: `Delete ${offer.code}?`,
      content:
        'This removes the coupon outright. If it has already been redeemed on an order, the ' +
        'backend refuses this and it must be set to inactive instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await offersService.deleteOffer(offer.id as number);
          message.success(`${offer.code} deleted`);
          void fetchOffers();
        } catch (caught) {
          message.error(toApiError(caught).message);
          throw caught;
        }
      },
    });
  };

  const columns: ColumnsType<Offer> = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      sorter: true,
      render: (_, offer) => (
        <Button type="link" className="table-link" onClick={() => openEdit(offer)}>
          {offer.code}
        </Button>
      ),
    },
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Discount',
      key: 'discount',
      render: (_, offer) =>
        String(offer.discountType).toLowerCase() === 'percentage'
          ? `${offer.discAmount}%${offer.maxDiscAmount != null ? ` (up to ${formatMoney(offer.maxDiscAmount)})` : ''}`
          : formatMoney(offer.discAmount),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      sorter: true,
      render: (_, offer) =>
        String(offer.status).toLowerCase() === 'active' ? (
          <Tag color="success">Active</Tag>
        ) : (
          <Tag>{offer.status}</Tag>
        ),
    },
    {
      title: 'Valid from',
      dataIndex: 'validFrom',
      key: 'validFrom',
      sorter: true,
      render: (_, offer) =>
        offer.validFrom ? new Date(offer.validFrom).toLocaleDateString() : '-',
    },
    {
      title: 'Valid until',
      dataIndex: 'validUntil',
      key: 'validUntil',
      render: (_, offer) =>
        offer.validUntil ? new Date(offer.validUntil).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 160,
      render: (_, offer) => (
        <Space size="small">
          {canEdit ? (
            <Button size="small" onClick={() => openEdit(offer)}>
              Edit
            </Button>
          ) : null}

          {canDelete ? (
            <Tooltip title="">
              <span>
                <Button size="small" danger onClick={() => confirmDelete(offer)}>
                  Delete
                </Button>
              </span>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
  ];

  const handleTableChange = (
    next: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<Offer> | SorterResult<Offer>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiOffersParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Offers"
        description="Coupons customers can apply in the cart before paying"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetchOffers()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New offer
              </Button>
            ) : null}
          </Space>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <Input.Search
            allowClear
            placeholder="Search by code"
            defaultValue={query.code}
            onSearch={(value) => setQuery({ code: value || undefined })}
            style={{ width: 220 }}
          />

          <Select
            allowClear
            placeholder="Any status"
            value={query.status}
            onChange={(status) => setQuery({ status })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            style={{ width: 160 }}
          />

          {actor?.role === 'owner' ? (
            <CinemaSelect
              allowClear
              placeholder="Any cinema"
              value={query.cinemaId ?? null}
              onChange={(cinemaId) => setQuery({ cinemaId: cinemaId ?? undefined })}
              style={{ width: 220 }}
            />
          ) : null}
        </Space>

        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            className="form-alert"
            action={
              <Button size="small" onClick={() => void fetchOffers()}>
                Try again
              </Button>
            }
          />
        ) : null}

        <Table<Offer>
          rowKey={(offer) => String(offer.id)}
          columns={columns}
          dataSource={offers}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 900 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load offers" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query.code || query.status ? 'No offers match these filters' : 'No offers yet'
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
            showTotal: (total) => `${total} offer${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {formOpen ? (
        <OfferFormModal
          offer={formOffer}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetchOffers()}
        />
      ) : null}
    </Space>
  );
}
