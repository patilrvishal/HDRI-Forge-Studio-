import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initBlenderBridge } from './bridge/BlenderBridgeListener'
import { ErikLiveBadge } from './erikLive/ErikLiveBadge'
import { isTauri } from '@tauri-apps/api/core'

initBlenderBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {(import.meta.env.DEV || isTauri()) && <ErikLiveBadge />}
  </StrictMode>,
)
