import { Card, Empty, Space } from 'antd';

import PageHeader from '@/components/PageHeader';

/**
 * Placeholder for a module whose screens have not been built yet. Exists so the
 * navigation structure is complete and every menu entry leads somewhere.
 */
export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <Space orientation="vertical" size="large" className="stack">
      <PageHeader title={title} />
      <Card>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`${title} is not available yet. This screen is coming soon.`}
        />
      </Card>
    </Space>
  );
}
