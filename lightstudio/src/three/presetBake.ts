/**
 * Preset thumbnails baked from the preset's own lights.
 *
 * Each thumbnail is the real equirectangular map the preset produces: the same analytic bake the HDRI
 * Preview and the exports use (`generateAnalyticalHDRI`), run small, then tone-mapped for the screen.
 * What you see on the card is therefore exactly where each light lands in the map and how big it is.
 */

import * as THREE from 'three';
import type { PresetLight } from '../types/Preset';
import { generateAnalyticalHDRI } from './HDRIExporter';

const BAKE_W = 144;
const BAKE_H = 72;
const CACHE = new Map<string, string>();

/** The scene objects the viewport would create for these lights (same placement rules as engine.ts). */
export function sceneFromPresetLights(lights: PresetLight[]): THREE.Scene {
  const scene = new THREE.Scene();
  for (const pl of lights) {
    const s = pl.transform.spherical;
    const lng = (s.lng * Math.PI) / 180;
    const pos = new THREE.Vector3(s.radius * Math.cos(lng), s.height, s.radius * Math.sin(lng));
    // engine.ts: brightness 0-1000 -> intensity 0-10, times opacity %
    const intensity = (pl.brightness / 1000) * 10 * (pl.opacity / 100);

    let obj: THREE.Light;
    if (pl.type === 'area' || pl.type === 'overhead') {
      const rect = new THREE.RectAreaLight(pl.color, intensity, pl.areaWidth ?? (pl.type === 'overhead' ? 4 : 2), pl.areaHeight ?? (pl.type === 'overhead' ? 4 : 2));
      rect.position.copy(pos);
      rect.lookAt(0, 0, 0);
      rect.userData.edgeSoftness = pl.edgeSoftness ?? 50;
      rect.userData.opacity = pl.opacity / 100;
      obj = rect;
    } else if (pl.type === 'spot' || pl.type === 'rim') {
      const spot = new THREE.SpotLight(pl.color, intensity, 50, ((pl.spotAngle ?? (pl.type === 'rim' ? 30 : 45)) * Math.PI) / 180, pl.spotPenumbra ?? 0.5, 2);
      spot.position.copy(pos);
      spot.lookAt(0, 0, 0);                                  // the bake reads the light's own facing, not its target
      obj = spot;
    } else if (pl.type === 'directional') {
      const dir = new THREE.DirectionalLight(pl.color, intensity);
      dir.position.copy(pos);
      dir.lookAt(0, 0, 0);
      obj = dir;
    } else {
      const point = new THREE.PointLight(pl.color, intensity, 50, 2);
      point.position.copy(pos);
      obj = point;
    }
    obj.updateMatrixWorld(true);
    scene.add(obj);
  }
  return scene;
}

/** HDR float RGBA -> 8-bit RGBA. Log tone map so a hot key and a dim fill both stay readable, plus a
 *  soft glow so pinpoint lights (spots, bulbs) are still visible at thumbnail size. */
export function toneMapThumbnail(px: Float32Array, out: Uint8ClampedArray, w: number, h: number): void {
  const lum: number[] = [];
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    if (l > 1e-4) lum.push(l);
  }
  lum.sort((a, b) => a - b);
  const top = lum.length ? lum[Math.min(lum.length - 1, Math.floor(lum.length * 0.995))] : 1;
  const k = 400 / Math.max(top, 1e-3);                      // lifts dim lights, keeps the hottest at white
  const denom = Math.log(1 + k * Math.max(top, 1e-3));
  const mapped = new Float32Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const gain = l > 1e-6 ? Math.log(1 + k * l) / denom / l : 0;
    for (let c = 0; c < 3; c++) mapped[p * 3 + c] = Math.pow(Math.min(1, Math.max(0, px[i + c] * gain)), 1 / 1.6);
  }
  // separable box blur (wraps in x, like the sphere does) for the glow
  const R = 2;
  const tmp = new Float32Array(mapped.length);
  const glow = new Float32Array(mapped.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let d = -R; d <= R; d++) acc += mapped[(y * w + ((x + d + w) % w)) * 3 + c];
        tmp[(y * w + x) * 3 + c] = acc / (2 * R + 1);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let d = -R; d <= R; d++) acc += tmp[(Math.min(h - 1, Math.max(0, y + d)) * w + x) * 3 + c];
        glow[(y * w + x) * 3 + c] = acc / (2 * R + 1);
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.max(mapped[p * 3 + c], Math.min(1, glow[p * 3 + c] * 1.7));
      out[p * 4 + c] = Math.round(255 * v);
    }
    out[p * 4 + 3] = 255;
  }
}

/** Baked 2:1 JPEG data URL for a preset's lights. Cached by content. */
export async function bakePresetThumbnail(lights: PresetLight[]): Promise<string> {
  const key = JSON.stringify(lights.map((l) => [l.type, l.color, l.brightness, l.opacity, l.transform.spherical, l.areaWidth, l.areaHeight, l.edgeSoftness, l.spotAngle, l.spotPenumbra]));
  const hit = CACHE.get(key);
  if (hit) return hit;

  const scene = sceneFromPresetLights(lights);
  const px = await generateAnalyticalHDRI(scene, BAKE_W, BAKE_H, new THREE.Vector3(0, 0, 0), [], { yieldEveryRows: BAKE_H + 1 });
  const canvas = document.createElement('canvas');
  canvas.width = BAKE_W;
  canvas.height = BAKE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(BAKE_W, BAKE_H);
  toneMapThumbnail(px, img.data, BAKE_W, BAKE_H);
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/jpeg', 0.82);
  CACHE.set(key, url);
  return url;
}
