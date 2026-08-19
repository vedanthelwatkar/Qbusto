import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';

import App from '@/App';
import '@/styles/global.scss';

const container = document.getElementById('root');

if (!container) throw new Error('Root element #root was not found in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
