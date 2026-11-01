import { useState } from 'react';
import { AppLayout } from './components/Layout/AppLayout';
import { SplashScreen } from './components/Layout/SplashScreen';
import './styles/globals.css';

function App() {
  const [showSplash, setShowSplash] = useState(true);
  return (
    <>
      <AppLayout />
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    </>
  );
}

export default App;