/**
 * Turns an HDRI asset (a file plus its Edit HDRI Environments layer stack, or a procedural
 * sky) into a float image / THREE texture, with caching so sliders stay responsive.
 */
import * as THREE from 'three';
import type { HDRIAsset } from '../store/hdriAssetStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { useAppearanceStore } from '../appearance/appearanceStore';
import { decodeImageBuffer } from '../appearance/imageImport';
import type { FloatImage } from '../filters/filters';
import { applyEdits, renderSky } from './apply';

/** Longest side of the working image. Editing 4K maps at full size would be sluggish. */
export const EDIT_MAX_W = 2048;

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Box-filter down to at most maxW wide (keeps 2:1 maps 2:1). */
export function resizeEnv(img: FloatImage, maxW: number): FloatImage {
  if (img.width <= maxW) return img;
  const k = maxW / img.width;
  const nw = maxW, nh = Math.max(1, Math.round(img.height * k));
  const out = new Float32Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y / nh) * img.height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / nh) * img.height));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x / nw) * img.width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / nw) * img.width));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * img.width + xx) * 4;
        r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
      }
      const o = (y * nw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 1;
    }
  }
  return { data: out, width: nw, height: nh };
}

const sourceCache = new Map<string, { key: string; img: FloatImage }>();
const editedCache = new Map<string, { sig: string; img: FloatImage }>();

/** Decoded (unedited) image of an asset - a file or a rendered sky. */
export async function getSourceImage(asset: HDRIAsset, skyWidth = 1024): Promise<FloatImage | null> {
  if (asset.kind === 'sky' && asset.sky) {
    const w = skyWidth, h = skyWidth / 2;
    return { data: renderSky(asset.sky, w, h), width: w, height: h };
  }
  if (!asset.dataBase64) return null;
  const key = asset.id + ':' + asset.dataBase64.length;
  const hit = sourceCache.get(asset.id);
  if (hit && hit.key === key) return hit.img;
  try {
    const dec = await decodeImageBuffer(b64ToBuffer(asset.dataBase64), asset.fileName || 'x.hdr');
    const img = resizeEnv({ data: dec.data, width: dec.width, height: dec.height }, EDIT_MAX_W);
    sourceCache.set(asset.id, { key, img });
    return img;
  } catch (e) {
    console.warn('[hdriedit] could not decode', asset.name, e);
    return null;
  }
}

const otherAssetImages = new Map<string, FloatImage>();

/** Image of another asset for Mix layers (unedited, small, cached). */
async function preloadMixSources(asset: HDRIAsset): Promise<void> {
  for (const l of asset.edits ?? []) {
    if (l.edit.kind !== 'mix') continue;
    const otherId = l.edit.p.assetId;
    if (!otherId || otherId === asset.id) continue;
    const other = useHDRIAssetStore.getState().assets.find((a) => a.id === otherId);
    if (!other) continue;
    const img = await getEditedImage(other, 1024, new Set([asset.id]));
    if (img) otherAssetImages.set(other.id, img);
  }
}

export const hasEdits = (a: HDRIAsset): boolean => a.kind === 'sky' || !!a.edits?.some((e) => e.enabled);

/**
 * The asset's image with all edit layers applied. `maxW` caps the resolution (the preview
 * and the viewport use smaller sizes than the export).
 */
export async function getEditedImage(asset: HDRIAsset, maxW = EDIT_MAX_W, visiting: Set<string> = new Set()): Promise<FloatImage | null> {
  if (visiting.has(asset.id)) return null; // mixing an HDRI into itself would recurse forever
  visiting.add(asset.id);
  const sig = JSON.stringify([asset.kind, asset.sky, asset.edits, asset.dataBase64 ? asset.dataBase64.length : 0, maxW, useAppearanceStore.getState().imagesVersion]);
  const hit = editedCache.get(asset.id + ':' + maxW);
  if (hit && hit.sig === sig) return hit.img;
  const src = await getSourceImage(asset, Math.min(maxW, EDIT_MAX_W));
  if (!src) return null;
  const base = resizeEnv(src, maxW);
  await preloadMixSources(asset);
  const resolveImage = (id: string) => otherAssetImages.get(id) ?? useAppearanceStoreImage(id);
  const data = applyEdits(base, asset.edits, { resolveAsset: resolveImage });
  const img: FloatImage = { data, width: base.width, height: base.height };
  editedCache.set(asset.id + ':' + maxW, { sig, img });
  visiting.delete(asset.id);
  return img;
}

function useAppearanceStoreImage(id: string): FloatImage | undefined {
  const im = useAppearanceStore.getState().images[id];
  return im ? { data: im.data, width: im.width, height: im.height } : undefined;
}

/** A float DataTexture the HDRI exporter/preview samples directly. */
export function imageToDataTexture(img: FloatImage): THREE.DataTexture {
  const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.FloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function invalidateEdited(assetId?: string): void {
  if (!assetId) editedCache.clear();
  else for (const k of Array.from(editedCache.keys())) if (k.startsWith(assetId + ':')) editedCache.delete(k);
}
