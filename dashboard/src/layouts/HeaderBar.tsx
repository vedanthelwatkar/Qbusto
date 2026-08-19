/**
 * Top bar: navigation toggle on the left, current user on the right.
 *
 * The toggle means two different things by width - collapse the rail on
 * desktop, open the drawer on mobile - which is why the layout passes the
 * handler in rather than this deciding for itself.
 */

import { Avatar, Button, Dropdown, Space, Tag, Typography, type MenuProps } from 'antd';
import { KeyOutlined, LogoutOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';

import { useAuthStore } from '@/stores/auth.store';
import { displayName, roleLabel } from '@/utils/permissions';

const { Text } = Typography;

interface HeaderBarProps {
  onToggleNav: () => void;
  onChangePassword: () => void;
}

export default function HeaderBar({ onToggleNav, onChangePassword }: HeaderBarProps) {
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  const items: MenuProps['items'] = [
    {
      key: 'identity',
      label: (
        <div className="user-menu__identity">
          <Text strong>{displayName(user)}</Text>
          <Text type="secondary">{user?.username}</Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    { key: 'change-password', icon: <KeyOutlined />, label: 'Change password' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Log out', danger: true },
  ];

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'change-password') onChangePassword();
    if (key === 'logout') void signOut();
  };

  return (
    <div className="header-bar">
      <Button
        type="text"
        aria-label="Toggle navigation"
        icon={<MenuOutlined />}
        onClick={onToggleNav}
      />

      <Space size="middle" align="center">
        {user ? <Tag color="processing">{roleLabel(user.role)}</Tag> : null}

        <Dropdown
          menu={{ items, onClick: handleMenuClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button type="text" className="header-bar__user">
            <Space size="small">
              <Avatar size="small" icon={<UserOutlined />} />
              <span className="header-bar__user-name">{displayName(user)}</span>
            </Space>
          </Button>
        </Dropdown>
      </Space>
    </div>
  );
}
