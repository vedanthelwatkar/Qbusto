/**
 * Landing screen.
 *
 * Deliberately thin: there is no dashboard endpoint yet, so rather than invent
 * numbers it shows the session the user is actually working in and which
 * modules their permissions open up.
 */

import { Card, Col, Empty, Row, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { NAV_MODULES } from '@/routes/modules';
import { useAuthStore } from '@/stores/auth.store';
import { displayName, hasPermission, roleLabel } from '@/utils/permissions';

const { Text } = Typography;

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);

  const available = NAV_MODULES.filter(
    (entry) => entry.path !== '/' && hasPermission(user, entry.module)
  );

  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader
        title={`Welcome back, ${displayName(user)}`}
        description="Cinema food ordering management"
        extra={user ? <Tag color="processing">{roleLabel(user.role)}</Tag> : undefined}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small" title="Signed in as">
            <Text strong>{user?.username}</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Chain">
            <Text strong>#{user?.chainId}</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Cinema">
            <Text strong>{user?.cinemaId ? `#${user.cinemaId}` : 'All cinemas'}</Text>
          </Card>
        </Col>
      </Row>

      <Card title="Your modules">
        {available.length === 0 ? (
          <Empty description="You have not been granted access to any module yet" />
        ) : (
          <Row gutter={[16, 16]}>
            {available.map((entry) => (
              <Col xs={24} sm={12} lg={8} key={entry.path}>
                <Link to={entry.path}>
                  <Card size="small" hoverable>
                    <Space>
                      {entry.icon}
                      <span>{entry.label}</span>
                      {entry.implemented ? null : <Tag>Soon</Tag>}
                    </Space>
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </Space>
  );
}
