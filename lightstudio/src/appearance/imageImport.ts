/**
 * Decoding of user images for Image / Sky content: PNG, JPG, WebP (sRGB -> linear),
 * Radiance .hdr and OpenEXR (already linear). Everything is normalised to a
 * linear-float RGBA image, top row first, and capped at MAX_SIDE so a scene with
 * a few images stays light.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import type { AppearanceImage } from './types';
import { srgbToLinearChannel } from './evaluate';

export const MAX_SIDE = 512;

let counter = 0;
export const newImageId = (): string => `img_${Date.now().toString(36)}_${(counter++).toString(36)}`;

function downscale(src: Float32Array, w: number, h: number): { data: Float32Array; width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= MAX_SIDE) return { data: src, width: w, height: h };
  const k = MAX_SIDE / long;
  const nw = Math.max(1, Math.round(w * k));
  const nh = Math.max(1, Math.round(h * k));
  const out = new Float32Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y / nh) * h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / nh) * h));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x / nw) * w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / nw) * w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * w + xx) * 4;
        r += src[i] * src[i + 3]; g += src[i + 1] * src[i + 3]; b += src[i + 2] * src[i + 3]; a += src[i + 3]; n++;
      }
      const o = (y * nw + x) * 4;
      // Average premultiplied so transparent pixels do not bleed their colour in.
      out[o] = a > 0 ? r / a : 0; out[o + 1] = a > 0 ? g / a : 0; out[o + 2] = a > 0 ? b / a : 0; out[o + 3] = a / n;
    }
  }
  return { data: out, width: nw, height: nh };
}

async function decodeLdr(file: Blob): Promise<{ data: Float32Array; width: number; height: number; ldr?: boolean }> {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const out = new Float32Array(bmp.width * bmp.height * 4);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinearChannel(i / 255);
  for (let i = 0; i < bmp.width * bmp.height; i++) {
    out[i * 4] = lut[id.data[i * 4]];
    out[i * 4 + 1] = lut[id.data[i * 4 + 1]];
    out[i * 4 + 2] = lut[id.data[i * 4 + 2]];
    out[i * 4 + 3] = id.data[i * 4 + 3] / 255;
  }
  const width = bmp.width, height = bmp.height; // read before close(): a closed bitmap reports 0
  bmp.close();
  return { data: out, width, height, ldr: true };
}

function decodeFloatTexture(parsed: { width: number; height: number; data: ArrayLike<number> }, flip: boolean): { data: Float32Array; width: number; height: number } {
  const { width, height } = parsed;
  const stride = Math.round(parsed.data.length / (width * height));
  const out = new Float32Array(width * height * 4);
  const half = parsed.data instanceof Uint16Array;
  // EXRLoader delivers rows bottom-up (GL convention) and needs a flip; RGBELoader is already top-down.
  for (let y = 0; y < height; y++) {
    const sy = flip ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const s = (sy * width + x) * stride;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = parsed.data[s + Math.min(c, stride - 1)];
        out[o + c] = half ? THREE.DataUtils.fromHalfFloat(v) : v;
      }
      out[o + 3] = stride >= 4 ? (half ? THREE.DataUtils.fromHalfFloat(parsed.data[s + 3]) : parsed.data[s + 3]) : 1;
    }
  }
  return { data: out, width, height };
}

export async function decodeImageBuffer(buf: ArrayBuffer, name: string, type = ''): Promise<{ data: Float32Array; width: number; height: number; ldr?: boolean }> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.hdr') || lower.endsWith('.pic')) {
    const l = new RGBELoader();
    l.setDataType(THREE.FloatType);
    return decodeFloatTexture(l.parse(buf) as unknown as { width: number; height: number; data: ArrayLike<number> }, false);
  }
  if (lower.endsWith('.exr')) {
    const l = new EXRLoader();
    l.setDataType(THREE.FloatType);
    return decodeFloatTexture(l.parse(buf) as unknown as { width: number; height: number; data: ArrayLike<number> }, true);
  }
  return decodeLdr(new Blob([buf], { type: type || 'image/png' }));
}

export async function importImageFile(file: File): Promise<AppearanceImage> {
  const buf = await file.arrayBuffer();
  const dec = await decodeImageBuffer(buf, file.name, file.type);
  const ds = downscale(dec.data, dec.width, dec.height);
  return { id: newImageId(), name: file.name.replace(/\.[^.]+$/, ''), width: ds.width, height: ds.height, data: ds.data, ldr: dec.ldr };
}

// ── (de)serialisation for project files: half-float base64 ───────────────────

export interface SerializedImage {
  id: string;
  name: string;
  width: number;
  height: number;
  /** base64 of Uint16 half-float RGBA */
  data: string;
  ldr?: boolean;
}

export function serializeImage(img: AppearanceImage): SerializedImage {
  const u16 = new Uint16Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) u16[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, Math.max(-65000, img.data[i])));
  const bytes = new Uint8Array(u16.buffer);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return { id: img.id, name: img.name, width: img.width, height: img.height, data: btoa(bin), ldr: img.ldr };
}

export function deserializeImage(s: SerializedImage): AppearanceImage {
  const bin = atob(s.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(bytes.buffer);
  const data = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) data[i] = THREE.DataUtils.fromHalfFloat(u16[i]);
  return { id: s.id, name: s.name, width: s.width, height: s.height, data, ldr: s.ldr };
}
