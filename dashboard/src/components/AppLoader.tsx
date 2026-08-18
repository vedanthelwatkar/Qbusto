import { Spin } from 'antd';

/** Full-height loading state, used while the session is being restored. */
export default function AppLoader({ tip = 'Loading' }: { tip?: string }) {
  return (
    <div className="app-loader">
      <Spin size="large" description={tip}>
        <div className="app-loader__target" />
      </Spin>
    </div>
  );
}
