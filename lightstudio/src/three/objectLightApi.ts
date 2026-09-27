import * as THREE from 'three';
import { useLightsStore } from '../store/lightsStore';
import { useHistoryStore } from '../store/historyStore';
import { useObjectHdriStore, defaultObjectHdri } from '../store/objectHdriStore';
import { createDefaultLight, type Light } from '../types/Light';
import { computeEmitterRect, objectKey } from './objectBinding';

/** The light (if any) that is currently driven by this object. */
export function getObjectLight(key: string): Light | undefined {
  return useLightsStore.getState().lights.find((l) => l.objectKey === key);
}

/** Turn a scene object into a light. Returns the new light's id. */
export function enableObjectLight(obj: THREE.Object3D): string | null {
  const key = objectKey(obj);
  const existing = getObjectLight(key);
  if (existing) return existing.id;
  const rect = computeEmitterRect(obj, new THREE.Vector3(0, 0, 0), 'auto');
  if (!rect) return null;
  useHistoryStore.getState().record('Use Object as Light');
  const light = createDefaultLight({
    name: `${obj.name || 'Object'} Light`,
    type: 'area',
    areaLight: true,
    objectKey: key,
    objectSide: 'auto',
    objectGlow: true,
    brightness: 100,
    opacity: 100,
    areaWidth: Math.max(0.1, rect.width),
    areaHeight: Math.max(0.1, rect.height),
    // The object itself is the visible source, so the wireframe gizmo starts hidden.
    gearVisible: false,
  });
  useLightsStore.setState((s) => ({ lights: [...s.lights, light] }));
  return light.id;
}

/** Stop using an object as a light (removes the linked light; the object stops glowing). */
export function disableObjectLight(key: string): void {
  const linked = useLightsStore.getState().lights.filter((l) => l.objectKey === key);
  if (!linked.length) return;
  useHistoryStore.getState().record('Stop Using Object as Light');
  useLightsStore.setState((s) => ({
    lights: s.lights.filter((l) => l.objectKey !== key),
    selectedLightId: linked.some((l) => l.id === s.selectedLightId) ? null : s.selectedLightId,
  }));
}

export function setIncludeInHdri(obj: THREE.Object3D, include: boolean): void {
  const key = objectKey(obj);
  const store = useObjectHdriStore.getState();
  if (include) store.set(key, { ...(store.get(key) ?? defaultObjectHdri()), include: true });
  else if (store.get(key)) store.set(key, { include: false });
}
