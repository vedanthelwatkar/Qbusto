/**
 * Users.
 *
 * The list is server-driven end to end: search, filters, sorting and paging all
 * become query parameters on GET /api/users, so what the table shows is always
 * what the backend selected for this user's tenant scope. Nothing is filtered
 * or sorted in the browser.
 *
 * The buttons follow the Users module's own permissions - edit for creating and
 * editing, delete for deactivating - and are additionally held back on the rows
 * the backend would refuse anyway (your own account, and owner accounts when
 * you are not one). That is UX, not enforcement: every one of those rules is
 * checked again server-side.
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

import type { GetApiUsersParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import PageHeader from '@/components/PageHeader';
import UserDetailsDrawer from '@/components/users/UserDetailsDrawer';
import UserFormModal from '@/components/users/UserFormModal';
import { toApiError } from '@/services/api';
import * as usersService from '@/services/users.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUsersStore } from '@/stores/users.store';
import { ROLES, type User } from '@/types/auth';
import { ROLE_LABELS, hasPermission, roleLabel } from '@/utils/permissions';

const { Text } = Typography;

/** antd's sort direction, in the spelling the API expects. */
const ORDER: Record<string, GetApiUsersParams['order']> = {
  ascend: 'asc',
  descend: 'desc',
};

const SORTABLE = new Set<string>([
  'id',
  'username',
  'role',
  'firstName',
  'lastName',
  'isActive',
  'createdAt',
  'updatedAt',
]);

export default function UsersPage() {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const query = useUsersStore((state) => state.query);
  const users = useUsersStore((state) => state.users);
  const pagination = useUsersStore((state) => state.pagination);
  const loading = useUsersStore((state) => state.loading);
  const error = useUsersStore((state) => state.error);
  const setQuery = useUsersStore((state) => state.setQuery);
  const fetch = useUsersStore((state) => state.fetch);
  const reset = useUsersStore((state) => state.reset);

  const [formUser, setFormUser] = useState<User | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | undefined>();

  const canEdit = hasPermission(actor, 'Users', 'edit');
  const canDelete = hasPermission(actor, 'Users', 'delete');

  useEffect(() => {
    void fetch();

    // Cleared on the way out so returning to the screen does not show the
    // previous session's filters and rows.
    return reset;
  }, [fetch, reset]);

  const openCreate = () => {
    setFormUser(undefined);
    setFormOpen(true);
  };

  const openEdit = (user: User) => {
    setFormUser(user);
    setFormOpen(true);
  };

  const confirmDeactivate = (user: User) => {
    if (user.id === undefined) return;

    modal.confirm({
      title: `Deactivate ${user.username}?`,
      content:
        'They will no longer be able to sign in. Nothing is deleted - their orders and history stay, ' +
        'and their permissions are kept so reactivating restores their access.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await usersService.deactivateUser(user.id as number);
          message.success(`${user.username} deactivated`);
          void fetch();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  /** Why a row's edit or deactivate button is unavailable, or null if it is not. */
  const blockedReason = (user: User, action: 'edit' | 'deactivate'): string | null => {
    if (user.role === 'owner' && actor?.role !== 'owner') {
      return 'Only an owner may modify an owner account';
    }

    if (action === 'deactivate') {
      if (user.id === actor?.id) return 'You cannot deactivate your own account';
      if (user.isActive === false) return 'Already inactive';
    }

    return null;
  };

  const columns: ColumnsType<User> = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      sorter: true,
      render: (_, user) => (
        <Button type="link" className="table-link" onClick={() => setDetailsId(user.id)}>
          {user.username}
        </Button>
      ),
    },
    {
      title: 'Name',
      key: 'firstName',
      sorter: true,
      // Not displayName(): that falls back to the username, which would repeat
      // the previous column instead of saying the name is not filled in.
      render: (_, user) => {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

        return name || <Text type="secondary">Not set</Text>;
      },
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      sorter: true,
      render: (_, user) => (
        // Status words rather than fixed colour names, so the tags follow the
        // theme's semantic tokens instead of antd's stock palette.
        <Tag color={user.role === 'owner' ? 'warning' : 'processing'}>{roleLabel(user.role)}</Tag>
      ),
    },
    {
      title: 'Cinema',
      dataIndex: 'cinemaId',
      key: 'cinemaId',
      render: (_, user) =>
        user.cinemaId ? `#${user.cinemaId}` : <Text type="secondary">All</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      sorter: true,
      render: (_, user) =>
        user.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      render: (_, user) => (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 200,
      render: (_, user) => {
        const editBlocked = blockedReason(user, 'edit');
        const deactivateBlocked = blockedReason(user, 'deactivate');

        return (
          <Space size="small">
            <Button size="small" onClick={() => setDetailsId(user.id)}>
              View
            </Button>

            {/* The span is what makes these tooltips work at all: a disabled
                button fires no mouse events, so a Tooltip wrapped straight
                around one never opens - and the reason it is disabled is the
                only thing the tooltip has to say. */}
            {canEdit ? (
              <Tooltip title={editBlocked ?? ''}>
                <span>
                  <Button
                    size="small"
                    disabled={editBlocked !== null}
                    onClick={() => openEdit(user)}
                  >
                    Edit
                  </Button>
                </span>
              </Tooltip>
            ) : null}

            {canDelete ? (
              <Tooltip title={deactivateBlocked ?? ''}>
                <span>
                  <Button
                    size="small"
                    danger
                    disabled={deactivateBlocked !== null}
                    onClick={() => confirmDeactivate(user)}
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
    sorter: SorterResult<User> | SorterResult<User>[]
  ) => {
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof active?.columnKey === 'string' ? active.columnKey : undefined;

    setQuery({
      page: next.current ?? 1,
      limit: next.pageSize ?? query.limit,
      // Clearing a sort in antd leaves the column but drops the order. The API
      // requires both, so that falls back to the default ordering.
      ...(active?.order && field && SORTABLE.has(field)
        ? { sort: field as GetApiUsersParams['sort'], order: ORDER[active.order] }
        : { sort: 'createdAt', order: 'desc' }),
    });
  };

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title="Users"
        description="Accounts that can sign in to the dashboard, and what each of them may see"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetch()} loading={loading}>
              Refresh
            </Button>
            {canEdit ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New user
              </Button>
            ) : null}
          </Space>
        }
      />

      <Card>
        <Space className="filters" size="middle" wrap>
          <Input.Search
            allowClear
            placeholder="Search username or name"
            defaultValue={query.search}
            onSearch={(value) => setQuery({ search: value || undefined })}
            style={{ width: 260 }}
          />

          <Select
            allowClear
            placeholder="Any role"
            value={query.role}
            onChange={(role) => setQuery({ role })}
            options={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
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

        <Table<User>
          rowKey={(user) => String(user.id)}
          columns={columns}
          dataSource={users}
          loading={loading}
          onChange={handleTableChange}
          scroll={{ x: 900 }}
          locale={{
            emptyText: error ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Could not load users" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query.search || query.role || query.isActive !== undefined
                    ? 'No users match these filters'
                    : 'No users yet'
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
            showTotal: (total) => `${total} user${total === 1 ? '' : 's'}`,
          }}
        />
      </Card>

      {/* Both are mounted only while open, which is what lets them start from a
          clean form or a fresh fetch rather than resetting the previous one. */}
      {formOpen ? (
        <UserFormModal
          user={formUser}
          onClose={() => setFormOpen(false)}
          onSaved={() => void fetch()}
        />
      ) : null}

      {detailsId !== undefined ? (
        <UserDetailsDrawer userId={detailsId} onClose={() => setDetailsId(undefined)} />
      ) : null}
    </Space>
  );
}
