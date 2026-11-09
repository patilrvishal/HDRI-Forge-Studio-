import { isTauri } from '@tauri-apps/api/core';

/** Desktop app: the main window starts hidden while the intro video plays in its own window. Show it and close the intro window. */
let revealing = false;
export async function revealMain(closeSplash = true): Promise<void> {
  if (!isTauri() || revealing) return;
  revealing = true;
  try {
    const { Window } = await import('@tauri-apps/api/window');
    const main = await Window.getByLabel('main');
    await main?.show();
    await main?.setFocus();
    const splash = await Window.getByLabel('splash');
    if (closeSplash) await splash?.destroy();
  } catch {
    /* the main window is also shown by its own failsafe */
  }
}

/** True when this page is the standalone intro window (desktop app only). */
export function isSplashWindow(): boolean {
  return isTauri() && new URLSearchParams(window.location.search).get('splash') === '1';
}
