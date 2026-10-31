/**
 * Renders + caches the RGBA appearance texture for each light. The cache is keyed
 * by a signature of everything that affects the pixels, so unchanged lights are free
 * and editing one light re-renders only that light.
 */
import type { LightAppearance, AppearanceImage } from './types';
import { averageRadiance, renderAppearance } from './evaluate';
import { useAppearanceStore } from './appearanceStore';

export interface LightTexture {
  width: number;
  height: number;
  /** Linear float RGBA, un-premultiplied, row 0 = top of the light. */
  data: Float32Array;
  /** Mean premultiplied radiance factor + coverage - drives RectAreaLight colour/intensity. */
  mean: { r: number; g: number; b: number; coverage: number };
  signature: string;
}

const cache = new Map<string, LightTexture>();

export function textureSize(aspect: number, longSide: number): { w: number; h: number } {
  const a = Math.min(16, Math.max(1 / 16, aspect || 1));
  if (a >= 1) return { w: longSide, h: Math.max(4, Math.round(longSide / a)) };
  return { w: Math.max(4, Math.round(longSide * a)), h: longSide };
}

function imagesFor(app: LightAppearance): Map<string, AppearanceImage> {
  const all = useAppearanceStore.getState().images;
  return new Map(Object.entries(all));
}

/** Pure render (no cache) - used for thumbnails and exports. */
export function renderTexture(app: LightAppearance, aspect: number, longSide: number): LightTexture {
  const { w, h } = textureSize(aspect, longSide);
  const data = renderAppearance(app, w, h, aspect, { images: imagesFor(app) });
  return { width: w, height: h, data, mean: averageRadiance(data), signature: '' };
}

/** Cached render for a live light. */
export function getLightTexture(lightId: string, app: LightAppearance | undefined, aspect: number, longSide = 192): LightTexture | null {
  if (!app) {
    cache.delete(lightId);
    return null;
  }
  const asp = Math.round(aspect * 1000) / 1000;
  const sig = `${longSide}|${asp}|${useAppearanceStore.getState().imagesVersion}|${JSON.stringify(app)}`;
  const hit = cache.get(lightId);
  if (hit && hit.signature === sig) return hit;
  const t = renderTexture(app, aspect, longSide);
  t.signature = sig;
  cache.set(lightId, t);
  return t;
}

export function dropLightTexture(lightId: string): void {
  cache.delete(lightId);
}

export function clearTextureCache(): void {
  cache.clear();
}
