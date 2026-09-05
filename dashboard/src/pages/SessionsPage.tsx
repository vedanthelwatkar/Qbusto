/**
 * Sessions - the schedule.
 *
 * Server-driven end to end: the cinema, film, status and date filters, sorting
 * and paging all become query parameters on GET /api/sessions. Nothing is
 * filtered or sorted in the browser.
 *
 * A session has no chain of its own - tenant scope reaches it through its
 * cinema - and the list joins in the film, screen and cinema names, so unlike
 * ScreensPage there is no name resolution to do here.
 *
 * Buttons follow the Settings module's permissions, which is what the backend
 * authorises sessions against. That is UX, not enforcement.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Input, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { ReloadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';

import type { GetApiSessionsParams, Session } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import SessionDetailsDrawer from '@/components/sessions/SessionDetailsDrawer';
import { useSessionsStore } from '@/stores/sessions.store';
import { formatDate, formatTime } from '@/utils/datetime';
import { detailRowProps } from '@/utils/rowClick';

const { RangePicker } = DatePicker;

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiSessionsParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/sessions accepts for `sort`. */
const SORTABLE = new Set<string>([
  'sessionId',
  'startsAt',
  'endsAt',
  'filmCode',
  'screenName',
  'status',
]);

/** A column's date, or an em dash when the row has none. */
function dateCell(value?: string | null) {
  return value ? formatDate(value) : '-';
}

/** A column's start/finish time, or an em dash when the row has none. */
function timeCell(value?: string | null) {
  return value ? formatTime(value) : '-';
}

export default function SessionsPage() {
  const query = useSessionsStore((state) => state.query);
  const sessions = useSessionsStore((state) => state.sessions);
  const pagination = useSessionsStore((state) => state.pagination);
  const loading = useSessionsStore((state) => state.loading);
  const error = useSessionsStore((state) => state.error);
  const setQuery = useSessionsStore((state) => state.setQuery);
  const fetch = useSessionsStore((state) => state.fetch);
  const reset = useSessionsStore((state) => state.reset);

  const [detailsId, setDetailsId] = useState<number | undefined>();

  /**
   * Remounts the date range when the filters are cleared. It is uncontrolled,
   * the established pattern for range inputs here, so clearing the store's
   * query is not enough to empty what is on screen.
   */
  const [filterKey, setFilterKey] = useState(0);

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  /**
   * The API bounds `startsAt` with two instants. A day picked in the browser
   * therefore has to cover the whole day, or a late screening on the end date
   * would fall outside a range that visually includes it.
   */
  const handleDateRange = (range: [Dayjs | null, Dayjs | null] | null) => {
    const [from, to] = range ?? [null, null];

    setQuery({
      from: from ? from.startOf('day').toISOString() : undefined,
      to: to ? to.endOf('day').toISOString() : undefined,
    });
  };

  const clearFilters = () => {
    setQuery({
      cinemaId: undefined,
      filmCode: undefined,
      from: undefined,
      to: undefined,
    });
    setFilterKey((key) => key + 1);
  };

  const columns: ColumnsType<Session> = [
    {
      title: 'Film',
      dataIndex: 'filmTitle',
      key: 'filmCode',
      sorter: true,
      render: (_, session) => session.filmTitle ?? session.filmCode ?? '-',
    },
    {
      title: 'Cinema',
      dataIndex: 'cinemaName',
      key: 'cinemaName',
      render: (_, session) => session.cinemaName ?? session.cinemaCode ?? '-',
    },
    {
      // Named, not referenced: the schedule does not carry a screen id.
      title: 'Screen',
      dataIndex: 'screenName',
      key: 'screenName',
      sorter: true,
      width: 140,
      render: (_, session) => session.screenName ?? '-',
    },
    {
      title: 'Date',
      key: 'startsAt',
      sorter: true,
      width: 130,
      render: (_, session) => dateCell(session.startsAt),
    },
    {
      title: 'Start',
      key: 'start',
      width: 100,
      render: (_, session) => timeCell(session.startsAt),
    },
    {
      title: 'End',
      key: 'end',
      width: 100,
      render: (_, session) => timeCell(session.endsAt),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 100,
      render: (_, session) => (
        <Button size="small" onClick={() => setDetailsId(session.sessionId)}>
          View
        </Button>
      ),
    },
  ];

  const handleTableChange = (
    next: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<Session> | SorterResult<Session>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiSessionsParams['sort'], order: ORDER[active.order] }
        : { sort: 'startsAt', order: 'asc' }),
    });
  };

  const filtered = Boolean(query.cinemaId || query.filmCode || query.from || query.to);

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Sessions"
        description="Supplied by the cinema's source system and read-only here"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
            Refresh
          </Button>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap key={filterKey}>
          <CinemaSelect
            allowClear
            includeInactive
            placeholder="Any cinema"
            value={query.cinemaId}
            onChange={(cinemaId) => setQuery({ cinemaId: cinemaId ?? undefined })}
            style={{ width: 240 }}
          />

          {/*
           * A free-text film code rather than a picker.
           *
           * The picker read a `film` catalogue that no longer exists - the
           * title lives on the session row itself now, so there is no list of
           * films to choose from. The code is still a real filter the API
           * accepts, and staff who have one (from a POS report) can use it.
           */}
          <Input
            allowClear
            placeholder="Any film code"
            value={query.filmCode}
            onChange={(event) => setQuery({ filmCode: event.target.value || undefined })}
            style={{ width: 240 }}
          />

          <RangePicker onChange={handleDateRange} />

          {filtered ? <Button onClick={clearFilters}>Clear filters</Button> : null}
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

        <Table<Session>
          // The row is the detail trigger - see utils/rowClick.
          onRow={detailRowProps<Session>((session) => setDetailsId(session.sessionId))}
          rowKey={(session) => `${session.cinemaCode}-${session.sessionId}`}
          columns={columns}
          dataSource={sessions}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load sessions" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No sessions match these filters' : 'No sessions yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} session${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {detailsId !== undefined ? (
        <SessionDetailsDrawer sessionId={detailsId} onClose={() => setDetailsId(undefined)} />
      ) : null}
    </Space>
  );
}
