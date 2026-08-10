/**
 * Sign in.
 *
 * Every failure is shown as the backend worded it - wrong credentials (401), a
 * deactivated account (403), a rate limit (429) and an unreachable server all
 * arrive here already normalised, so none of them need special cases and none
 * of them leak more than the server chose to say.
 */

import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, useLocation } from 'react-router-dom';

import { NAV_MODULES } from '@/routes/modules';
import { toApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth.store';
import type { LoginCredentials } from '@/types/auth';
import { hasPermission } from '@/utils/permissions';

const { Title, Text } = Typography;

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const signIn = useAuthStore((state) => state.signIn);
  const location = useLocation();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') {
    // Wherever they were headed before being bounced here, or the first screen
    // they can actually open. Not a fixed '/': a user without a Dashboard grant
    // would land on a 403 the moment they signed in.
    const from = (location.state as LocationState | null)?.from?.pathname;
    const landing = NAV_MODULES.find((entry) => hasPermission(user, entry.module))?.path ?? '/';

    return <Navigate to={from ?? landing} replace />;
  }

  const handleSubmit = async (values: LoginCredentials) => {
    setSubmitting(true);
    setError(null);

    try {
      // No navigation here: signIn flips the status, and the redirect above
      // runs on the next render. Doing both would race two redirects.
      await signIn(values);
    } catch (caught) {
      console.log('🚀 ~ handleSubmit ~ caught:', caught);
      setError(toApiError(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <Card className="login__card" variant="borderless">
        <div className="login__heading">
          <Title level={3}>QBusto</Title>
          <Text type="secondary">Sign in to the management dashboard</Text>
        </div>

        {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

        <Form<LoginCredentials>
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
          disabled={submitting}
        >
          <Form.Item
            name="username"
            label="Username"
            rules={[
              { required: true, message: 'Enter your username' },
              { max: 50, message: 'Usernames are at most 50 characters' },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="username"
              autoComplete="username"
              autoFocus
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="password"
              autoComplete="current-password"
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={submitting}>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
