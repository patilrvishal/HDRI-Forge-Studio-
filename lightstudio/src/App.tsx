import { useState } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { SplashScreen } from './components/Layout/SplashScreen';
import { isIntroEnabled } from './utils/introPref';
import './styles/globals.css';

function App() {
  // The intro can be switched off from its own checkbox or from Help > Startup intro.
  const [showSplash, setShowSplash] = useState(isIntroEnabled);
  return (
    <>
      <AppLayout />
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    </>
  );
}

export default App;