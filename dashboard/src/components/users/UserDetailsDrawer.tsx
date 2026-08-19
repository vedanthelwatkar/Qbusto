/**
 * Read-only view of one user.
 *
 * Fetches the user again instead of showing the row from the table, because
 * permissions are the point of this panel and GET /api/users only includes them
 * on the single-user endpoint.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Empty, Skeleton, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { toApiError } from '@/services/api';
import * as usersService from '@/services/users.service';
import type { User, UserPermission } from '@/types/auth';
import { displayName, roleLabel } from '@/utils/permissions';

const { Text } = Typography;

interface UserDetailsDrawerProps {
  userId: number;
  onClose: () => void;
}

const PERMISSION_COLUMNS: ColumnsType<UserPermission> = [
  { title: 'Module', dataIndex: 'moduleName', key: 'moduleName' },
  {
    title: 'Access',
    key: 'access',
    render: (_, permission) => {
      const granted = [
        permission.canRead ? 'Read' : null,
        permission.canEdit ? 'Edit' : null,
        permission.canDelete ? 'Delete' : null,
      ].filter((label): label is string => label !== null);

      return granted.length === 0 ? (
        <Text type="secondary">None</Text>
      ) : (
        granted.map((label) => <Tag key={label}>{label}</Tag>)
      );
    },
  },
];

export default function UserDetailsDrawer({ userId, onClose }: UserDetailsDrawerProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * The drawer closes itself and tells the parent afterwards, through
   * `afterOpenChange`. Unmounting on the click instead would skip the slide-out
   * and make it look like the panel had been torn away.
   */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    usersService
      .getUser(userId)
      .then((loaded) => {
        if (!active) return;
        setUser(loaded);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={520}
      title={user ? displayName(user) : 'User'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {user ? (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Username">{user.username}</Descriptions.Item>
            <Descriptions.Item label="Role">{roleLabel(user.role)}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {user.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Mobile">
              {user.mobile ?? <Text type="secondary">Not set</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Chain">#{user.chainId}</Descriptions.Item>
            <Descriptions.Item label="Cinema">
              {user.cinemaId ? `#${user.cinemaId}` : <Text type="secondary">All cinemas</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Created">
              {user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}
            </Descriptions.Item>
          </Descriptions>

          <Typography.Title level={5} className="details-drawer__section">
            Permissions
          </Typography.Title>

          {user.role === 'owner' ? (
            <Alert
              type="info"
              showIcon
              message="Owners have full access to every module and are not governed by permission rows."
            />
          ) : (user.permissions ?? []).length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No modules granted - this user can sign in but sees nothing"
            />
          ) : (
            <Table<UserPermission>
              rowKey={(permission) => permission.moduleName ?? ''}
              size="small"
              columns={PERMISSION_COLUMNS}
              dataSource={user.permissions}
              pagination={false}
            />
          )}
        </>
      ) : null}
    </Drawer>
  );
}
