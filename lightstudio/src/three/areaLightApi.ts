import { useLightsStore } from '../store/lightsStore';
import { createDefaultTexturedArea } from '../types/Light';

/** Area Light mode on/off for one light (Ctrl+Space, the light list menu, the properties toggle). */
export function toggleAreaLight(lightId: string): boolean | null {
  const st = useLightsStore.getState();
  const l = st.lights.find((x) => x.id === lightId);
  if (!l || !(l.type === 'area' || l.type === 'overhead') || l.objectKey) return null;
  const cur = l.areaTex ?? createDefaultTexturedArea();
  const next = !cur.enabled;
  st.updateLight(l.id, { areaTex: { ...cur, enabled: next } });
  return next;
}
