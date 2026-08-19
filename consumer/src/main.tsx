import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/variables.scss'
import './styles/global.scss'
import './styles/shared.scss'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
