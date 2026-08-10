import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <Result
      status="404"
      title="Page not found"
      subTitle="That page does not exist."
      extra={
        <Link to="/">
          <Button type="primary">Back to dashboard</Button>
        </Link>
      }
    />
  );
}
