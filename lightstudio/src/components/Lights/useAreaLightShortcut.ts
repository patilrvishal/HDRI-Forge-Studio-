import { useEffect } from 'react';
import { useLightsStore } from '../../store/lightsStore';
import { toggleAreaLight } from '../../three/areaLightApi';

/** Ctrl + Space toggles Area Light mode on the selected light. */
export function useAreaLightShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const id = useLightsStore.getState().selectedLightId;
      if (!id) return;
      if (toggleAreaLight(id) !== null) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
