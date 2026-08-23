/**
 * Films.
 *
 * Server-driven end to end: search, sorting and paging all become query
 * parameters on GET /api/films. Nothing is filtered or sorted in the browser.
 *
 * There is deliberately no "now showing" filter. The source system's
 * `nowShowingFlag` vocabulary is undocumented and the client's data has never
 * contained a 'Y' value, so a prior version of this filter matched zero rows
 * by assuming a meaning nothing establishes. The raw flag is still shown as a
 * column, unfiltered and uninterpreted.
 *
 * Read-only. The catalogue lives in the client's `film` table and is synced
 * from their source system, so there is nothing to create or edit here - a
 * write made from the Dashboard would not survive the next sync.
 *
 * A film is addressed by the source system's `code`, not by an integer id.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { ReloadOutlined } from '@ant-design/icons';

import type { Film, GetApiFilmsParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import FilmDetailsDrawer from '@/components/films/FilmDetailsDrawer';
import { useFilmsStore } from '@/stores/films.store';

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiFilmsParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

/** The values GET /api/films accepts for `sort`. */
const SORTABLE = new Set<string>([
  'code',
  'title',
  'certification',
  'durationMinutes',
  'openingDate',
]);

export default function FilmsPage() {
  const query = useFilmsStore((state) => state.query);
  const films = useFilmsStore((state) => state.films);
  const pagination = useFilmsStore((state) => state.pagination);
  const loading = useFilmsStore((state) => state.loading);
  const error = useFilmsStore((state) => state.error);
  const setQuery = useFilmsStore((state) => state.setQuery);
  const fetch = useFilmsStore((state) => state.fetch);
  const reset = useFilmsStore((state) => state.reset);

  const [detailsCode, setDetailsCode] = useState<string | undefined>();

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous visit's filters and rows.
    return reset;
  }, [fetch, reset]);

  const columns: ColumnsType<Film> = [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      sorter: true,
      render: (_, film) => (
        <Button type="link" className="table-link" onClick={() => setDetailsCode(film.code)}>
          {film.title ?? film.code}
        </Button>
      ),
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      sorter: true,
      width: 160,
    },
    {
      title: 'Certification',
      dataIndex: 'certification',
      key: 'certification',
      sorter: true,
      width: 140,
      render: (_, film) => film.certification ?? '-',
    },
    {
      title: 'Running time',
      dataIndex: 'durationMinutes',
      key: 'durationMinutes',
      sorter: true,
      width: 140,
      render: (_, film) => (film.durationMinutes ? `${film.durationMinutes} min` : '-'),
    },
    {
      // Raw and unfiltered: the source system's vocabulary for this flag is
      // not documented, so it is shown exactly as stored rather than
      // interpreted as a status.
      title: 'Now showing flag',
      dataIndex: 'nowShowingFlag',
      key: 'nowShowingFlag',
      width: 150,
      render: (_, film) => film.nowShowingFlag ?? '-',
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 100,
      render: (_, film) => (
        <Button size="small" onClick={() => setDetailsCode(film.code)}>
          View
        </Button>
      ),
    },
  ];

  const handleTableChange = (
    next: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<Film> | SorterResult<Film>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd keeps the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiFilmsParams['sort'], order: ORDER[active.order] }
        : { sort: 'title', order: 'asc' }),
    });
  };

  const filtered = query.search !== undefined;

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Films"
        description="Supplied by the cinema's source system and read-only here"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
            Refresh
          </Button>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <Input.Search
            allowClear
            placeholder="Search by title"
            defaultValue={query.search}
            onSearch={(value) => setQuery({ search: value || undefined })}
            style={{ width: 260 }}
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

        <Table<Film>
          rowKey={(film) => String(film.code)}
          columns={columns}
          dataSource={films}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 900 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load films" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? 'No films match these filters' : 'No films yet'}
              />
            ),
          }}
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.limit ?? query.limit,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} film${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {detailsCode !== undefined ? (
        <FilmDetailsDrawer filmCode={detailsCode} onClose={() => setDetailsCode(undefined)} />
      ) : null}
    </Space>
  );
}
