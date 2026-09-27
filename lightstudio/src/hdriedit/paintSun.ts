/**
 * LightPaint the Sun: point at a place (on a reflective surface in the viewport, or on the
 * Canvas map) and the sun of the current Sky is moved so it appears there.
 *
 * Targets, in order: the selected light whose content is a Sky, otherwise the selected
 * procedural sky HDRI (or the first one).
 */
import * as THREE from 'three';
import { useLightsStore } from '../store/lightsStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import type { Light } from '../types/Light';
import type { ContentLayer, LightAppearance } from '../appearance/types';

const R2D = 180 / Math.PI;

/** The Sky layer of a light's appearance (master first, then value blends), if any. */
function skyLayerOf(a: LightAppearance | undefined): { where: 'master' | 'valueBlend'; index: number; layer: ContentLayer } | null {
  if (!a) return null;
  if (a.master.content.type === 'sky' && a.master.enabled) return { where: 'master', index: 0, layer: a.master };
  const i = a.valueBlend.findIndex((l) => l.content.type === 'sky' && l.enabled);
  return i >= 0 ? { where: 'valueBlend', index: i, layer: a.valueBlend[i] } : null;
}

export function lightHasSky(l: Light | undefined | null): boolean {
  return !!skyLayerOf(l?.appearance);
}

export function hasSunTarget(): boolean {
  const ls = useLightsStore.getState();
  const light = ls.lights.find((l) => l.id === ls.selectedLightId);
  if (lightHasSky(light)) return true;
  return useHDRIAssetStore.getState().assets.some((a) => a.kind === 'sky');
}

/** Direction (world, unit) the sun should have as seen from the capture point. */
export function paintSunToDirection(dir: THREE.Vector3): 'light' | 'sky' | null {
  const d = dir.clone().normalize();
  const ls = useLightsStore.getState();
  const light = ls.lights.find((l) => l.id === ls.selectedLightId);
  const sky = skyLayerOf(light?.appearance);
  if (light && sky) {
    const scene = (window as unknown as { __lightforgeScene?: { scene: THREE.Scene } }).__lightforgeScene?.scene;
    let ra: THREE.RectAreaLight | null = null;
    scene?.traverse((o) => {
      if ((o as THREE.RectAreaLight).isRectAreaLight && o.userData.lightId === light.id) ra = o as THREE.RectAreaLight;
    });
    if (!ra) return null;
    const rect = ra as THREE.RectAreaLight;
    const q = rect.getWorldQuaternion(new THREE.Quaternion());
    const pos = rect.getWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const centre = pos.clone().normalize();
    const cosc = d.dot(centre);
    if (cosc <= 0.02) return null; // pointing away from the light's own hemisphere
    // gnomonic projection into the light's plane, exactly as the HDRI export does
    const dist = Math.max(0.01, pos.length());
    const tanW = Math.tan(Math.min(Math.max(0.02, Math.atan2(rect.width / 2, dist)), 1.55));
    const tanH = Math.tan(Math.min(Math.max(0.02, Math.atan2(rect.height / 2, dist)), 1.55));
    const lx = d.dot(right) / cosc, ly = d.dot(up) / cosc;
    const x = Math.max(-1, Math.min(1, -(lx / tanW))); // texture u runs to the viewer's right = light -X
    const y = Math.max(-1, Math.min(1, ly / tanH));
    // Sky content is laid out in texture space: x = azimuth -180..180, y = altitude 0..90
    const az = x * 180;
    const alt = Math.max(0, Math.min(90, ((y + 1) / 2) * 90));
    const app = light.appearance!;
    const patchLayer = (layer: ContentLayer): ContentLayer => ({ ...layer, content: { ...layer.content, p: { ...layer.content.p, azimuth: az, altitude: alt } } as unknown as ContentLayer['content'] });
    const next: LightAppearance = sky.where === 'master'
      ? { ...app, master: patchLayer(app.master) }
      : { ...app, valueBlend: app.valueBlend.map((l, i) => (i === sky.index ? patchLayer(l) : l)) };
    ls.updateLight(light.id, { appearance: next });
    return 'light';
  }

  const hs = useHDRIAssetStore.getState();
  const asset = hs.assets.find((a) => a.id === hs.selectedAssetId && a.kind === 'sky') ?? hs.assets.find((a) => a.kind === 'sky');
  if (asset?.sky) {
    let az = Math.atan2(d.z, d.x) * R2D;
    if (az < 0) az += 360;
    const el = Math.asin(Math.max(-1, Math.min(1, d.y))) * R2D;
    hs.updateAsset(asset.id, { sky: { ...asset.sky, sunAzimuth: az, sunElevation: el } });
    return 'sky';
  }
  return null;
}
