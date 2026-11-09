import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { SplashScreen } from './components/Layout/SplashScreen'
import { isSplashWindow, revealMain } from './utils/revealMain'
import { isIntroEnabled } from './utils/introPref'
import { initBlenderBridge } from './bridge/BlenderBridgeListener'
import { ErikLiveBadge } from './erikLive/ErikLiveBadge'
import { isTauri } from '@tauri-apps/api/core'
import { initA11yLabels } from './utils/a11yLabels'

if (isSplashWindow()) {
  // the desktop app's intro: only the video, in its own small window; the main window opens when it ends or is skipped
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  if (!isIntroEnabled()) void revealMain()
  createRoot(document.getElementById('root')!).render(<SplashScreen standalone onDone={() => void revealMain()} />)
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
    getCurrentWindow().onCloseRequested(() => { void revealMain(false) })).catch(() => {})
} else {
  initBlenderBridge()
  initA11yLabels()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      {(import.meta.env.DEV || isTauri()) && <ErikLiveBadge />}
    </StrictMode>,
  )
}
