import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { AppLayout } from './components/Layout/AppLayout';
import { SplashScreen } from './components/Layout/SplashScreen';
import { isIntroEnabled } from './utils/introPref';
import { revealMain } from './utils/revealMain';
import './styles/globals.css';

function App() {
  // The intro can be switched off from its own checkbox or from Help > Startup intro.
  // In the desktop app the intro is its own window (see main.tsx); this in-page overlay is for the browser build only.
  const [showSplash, setShowSplash] = useState(() => !isTauri() && isIntroEnabled());
  // Failsafe: never leave the hidden main window hidden if the intro window fails.
  useEffect(() => {
    if (!isTauri()) return;
    const t = window.setTimeout(() => void revealMain(), 30000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <>
      <AppLayout />
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    </>
  );
}

export default App;