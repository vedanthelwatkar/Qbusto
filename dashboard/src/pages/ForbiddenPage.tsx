import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';

/** Shown when the signed-in user has no read permission for a module. */
export default function ForbiddenPage() {
  return (
    <Result
      status="403"
      title="No access"
      subTitle="You do not have permission to view this section. Ask an administrator if you need it."
      extra={
        <Link to="/">
          <Button type="primary">Back to dashboard</Button>
        </Link>
      }
    />
  );
}
