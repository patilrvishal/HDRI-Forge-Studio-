/**
 * Export of light appearance textures: single RGBA image per light (OpenEXR float or
 * PNG) and a "pack" zip for Area Light mode (one texture per light plus a JSON
 * describing where each rectangle sits, so a 3D app can rebuild the emitters).
 */
import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import type { Light } from '../types/Light';
import { encodeEXRRGBA } from './exr';
import { renderTexture, type LightTexture } from './textures';
import { linearToSrgbChannel } from './evaluate';
import { newAppearance } from './content';

export function downloadBuffer(name: string, data: ArrayBuffer | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 250);
}

/** PNG (sRGB, straight alpha) from linear RGBA; values above 1 are clipped. */
export async function texturePng(tex: LightTexture): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = tex.width;
  c.height = tex.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(tex.width, tex.height);
  for (let i = 0; i < tex.width * tex.height; i++) {
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.round(linearToSrgbChannel(Math.min(1, Math.max(0, tex.data[i * 4 + k]))) * 255);
    img.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, tex.data[i * 4 + 3])) * 255);
  }
  ctx.putImageData(img, 0, 0);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export function textureExr(tex: LightTexture): ArrayBuffer {
  return encodeEXRRGBA(tex.data, tex.width, tex.height, true);
}

const safeName = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'light';

export function lightAspect(l: Light): number {
  return Math.max(0.01, (l.areaWidth ?? 2) / Math.max(0.01, l.areaHeight ?? 2));
}

/** Render + download the RGBA texture of one light. */
export async function exportLightTexture(l: Light, format: 'exr' | 'png', longSide = 1024): Promise<void> {
  const app = l.appearance ?? newAppearance('flat');
  const tex = renderTexture(app, lightAspect(l), longSide);
  const base = safeName(l.name);
  if (format === 'exr') downloadBuffer(`${base}.exr`, textureExr(tex), 'image/x-exr');
  else downloadBuffer(`${base}.png`, await texturePng(tex), 'image/png');
}

interface PackEntry {
  name: string;
  file: string;
  position: [number, number, number];
  normal: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  width: number;
  height: number;
  brightness: number;
  opacity: number;
  color: string;
  spread: number;
  cameraVisible: boolean;
}

/** Zip of every Area-Light-mode light: RGBA texture + placement JSON. */
export async function exportAreaLightPack(scene: THREE.Scene, lights: Light[], format: 'exr' | 'png', longSide = 1024): Promise<number> {
  const files: Record<string, Uint8Array> = {};
  const entries: PackEntry[] = [];
  const textures: LightTexture[] = [];
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const byId = new Map(lights.map((l) => [l.id, l]));
  scene.traverse((o) => {
    if (!(o as THREE.RectAreaLight).isRectAreaLight) return;
    const ra = o as THREE.RectAreaLight;
    const l = byId.get(ra.userData.lightId);
    if (!l || !l.areaTex?.enabled || !l.visible) return;
    const aspect = ra.width / Math.max(0.001, ra.height);
    const tex = renderTexture(l.appearance ?? newAppearance('flat'), aspect, longSide);
    const idx = entries.length;
    const file = `${String(idx + 1).padStart(2, '0')}_${safeName(l.name)}.${format}`;
    ra.getWorldQuaternion(q);
    ra.getWorldPosition(p);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).toArray().map((n) => +n.toFixed(6)) as [number, number, number];
    entries.push({
      name: l.name,
      file,
      position: p.toArray().map((n) => +n.toFixed(6)) as [number, number, number],
      normal: v(0, 0, -1),
      right: v(-1, 0, 0), // texture u runs to the viewer's right = light -X
      up: v(0, 1, 0),
      width: +ra.width.toFixed(6),
      height: +ra.height.toFixed(6),
      brightness: l.brightness,
      opacity: l.opacity,
      color: l.color,
      spread: l.areaTex.spread,
      cameraVisible: l.areaTex.camVisibility,
    });
    textures.push(tex);
  });
  const count = entries.length;
  if (!count) return 0;
  for (let i = 0; i < count; i++) {
    files[entries[i].file] = format === 'exr' ? new Uint8Array(textureExr(textures[i])) : await texturePng(textures[i]);
  }
  files['area_lights.json'] = strToU8(
    JSON.stringify(
      {
        generator: 'HDRI Forge Studio',
        note: 'Each light is a rectangle: place it at `position`, facing along `normal`, with `right`/`up` as its in-plane axes (texture u runs along `right`, v along `up`).',
        lights: entries,
      },
      null,
      2,
    ),
  );
  downloadBuffer('area_lights_pack.zip', zipSync(files), 'application/zip');
  return count;
}

