/**
 * Applies an edit-layer stack to an equirectangular float image. Pure maths (no DOM),
 * shared by the app, the exporter and the tests.
 *
 * Direction convention matches HDRIExporter.pixelToDirection:
 *   theta = (u - 0.5) * 2PI, phi = v * PI,
 *   dir = (sin(phi) cos(theta), cos(phi), sin(phi) sin(theta)).
 */
import { applyFilters, blurPremultiplied, rowSolidAngle, type FloatImage } from '../filters/filters';
import { gradeRGB, hexToLinear, type RGB } from '../appearance/evaluate';
import { defaultGlobals } from '../appearance/types';
import { skyRadiance, skyState, SUN_RADIUS } from '../appearance/preetham';
import type { EditLayer, EditRegion, SkyEnvParams } from './types';

export interface EditContext {
  /** Other HDRIs available to Mix layers, already decoded (linear RGBA, top row first). */
  resolveAsset?: (id: string) => FloatImage | undefined;
}

const D2R = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

interface DirTables {
  w: number;
  h: number;
  cosT: Float32Array;
  sinT: Float32Array;
  sinP: Float32Array;
  cosP: Float32Array;
  sa: Float32Array;
}
const tableCache = new Map<string, DirTables>();
export function dirTables(w: number, h: number): DirTables {
  const key = w + 'x' + h;
  let t = tableCache.get(key);
  if (t) return t;
  t = {
    w, h,
    cosT: new Float32Array(w), sinT: new Float32Array(w),
    sinP: new Float32Array(h), cosP: new Float32Array(h), sa: new Float32Array(h),
  };
  for (let x = 0; x < w; x++) {
    const th = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
    t.cosT[x] = Math.cos(th); t.sinT[x] = Math.sin(th);
  }
  for (let y = 0; y < h; y++) {
    const ph = ((y + 0.5) / h) * Math.PI;
    t.sinP[y] = Math.sin(ph); t.cosP[y] = Math.cos(ph);
    t.sa[y] = rowSolidAngle(y, h) / w;
  }
  if (tableCache.size > 6) tableCache.clear();
  tableCache.set(key, t);
  return t;
}

export function uvToDir(u: number, v: number): [number, number, number] {
  const th = (u - 0.5) * 2 * Math.PI, ph = v * Math.PI;
  return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
}

export function dirToUv(d: [number, number, number]): [number, number] {
  const ph = Math.acos(Math.max(-1, Math.min(1, d[1])));
  const th = Math.atan2(d[2], d[0]);
  return [th / (2 * Math.PI) + 0.5, ph / Math.PI];
}

/**
 * Region mask 0..1 for every pixel (null = the whole map, unmasked). Feather widens
 * the edge inward from the nominal size.
 */
export function regionMask(r: EditRegion, w: number, h: number): Float32Array | null {
  if (r.shape === 'global' && !r.invert) return null;
  const m = new Float32Array(w * h);
  if (r.shape === 'global') { m.fill(r.invert ? 0 : 1); return m; }
  const t = dirTables(w, h);
  const c = uvToDir(r.u, r.v);
  const feather = clamp01(r.feather / 100);
  if (r.shape === 'circle') {
    const size = Math.max(0.05, r.size) * D2R;
    const inner = size * (1 - feather);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = t.sinP[y] * t.cosT[x], dy = t.cosP[y], dz = t.sinP[y] * t.sinT[x];
        const ang = Math.acos(Math.max(-1, Math.min(1, dx * c[0] + dy * c[1] + dz * c[2])));
        let v = ang >= size ? 0 : ang <= inner ? 1 : 1 - smooth((ang - inner) / Math.max(1e-6, size - inner));
        m[y * w + x] = r.invert ? 1 - v : v;
      }
    }
    return m;
  }
  // rectangle: gnomonic projection into the tangent plane at the centre
  const up0: [number, number, number] = Math.abs(c[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
  let rx = up0[1] * c[2] - up0[2] * c[1], ry = up0[2] * c[0] - up0[0] * c[2], rz = up0[0] * c[1] - up0[1] * c[0];
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  let ux = c[1] * rz - c[2] * ry, uy = c[2] * rx - c[0] * rz, uz = c[0] * ry - c[1] * rx;
  const roll = r.rotation * D2R, cr = Math.cos(roll), sr = Math.sin(roll);
  const rx2 = rx * cr + ux * sr, ry2 = ry * cr + uy * sr, rz2 = rz * cr + uz * sr;
  const ux2 = -rx * sr + ux * cr, uy2 = -ry * sr + uy * cr, uz2 = -rz * sr + uz * cr;
  const halfW = Math.tan(Math.min(89, Math.max(0.05, r.size)) * D2R);
  const halfH = Math.tan(Math.min(89, Math.max(0.05, r.sizeV)) * D2R);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = t.sinP[y] * t.cosT[x], dy = t.cosP[y], dz = t.sinP[y] * t.sinT[x];
      const cosc = dx * c[0] + dy * c[1] + dz * c[2];
      let v = 0;
      if (cosc > 0.02) {
        const lx = (dx * rx2 + dy * ry2 + dz * rz2) / cosc / halfW;
        const ly = (dx * ux2 + dy * uy2 + dz * uz2) / cosc / halfH;
        const e = Math.max(Math.abs(lx), Math.abs(ly));
        const lo = 1 - feather;
        v = e >= 1 ? 0 : e <= lo ? 1 : 1 - smooth((e - lo) / Math.max(1e-6, 1 - lo));
      }
      m[y * w + x] = r.invert ? 1 - v : v;
    }
  }
  return m;
}

function bilinearWrap(img: Float32Array, w: number, h: number, u: number, v: number, out: number[]): void {
  const fx = u * w - 0.5, fy = Math.min(h - 1, Math.max(0, v * h - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const xa = ((x0 % w) + w) % w, xb = (((x0 + 1) % w) + w) % w;
  const ya = y0, yb = Math.min(h - 1, y0 + 1);
  for (let k = 0; k < 4; k++) {
    const a = img[(ya * w + xa) * 4 + k] + (img[(ya * w + xb) * 4 + k] - img[(ya * w + xa) * 4 + k]) * tx;
    const b = img[(yb * w + xa) * 4 + k] + (img[(yb * w + xb) * 4 + k] - img[(yb * w + xa) * 4 + k]) * tx;
    out[k] = a + (b - a) * ty;
  }
}

// ── layer operations ────────────────────────────────────────────────────────

function mixInto(dst: Float32Array, src: Float32Array, mask: Float32Array | null, k: number): void {
  const n = dst.length / 4;
  for (let i = 0; i < n; i++) {
    const a = (mask ? mask[i] : 1) * k;
    if (a <= 0) continue;
    const o = i * 4;
    dst[o] = lerp(dst[o], src[o], a); dst[o + 1] = lerp(dst[o + 1], src[o + 1], a); dst[o + 2] = lerp(dst[o + 2], src[o + 2], a);
  }
}

function applyAdjust(img: FloatImage, layer: EditLayer, mask: Float32Array | null, k: number): void {
  if (layer.edit.kind !== 'adjust') return;
  const p = layer.edit.p;
  const g = { ...defaultGlobals(), brightness: 0, hue: p.hue, saturation: p.saturation, contrast: p.contrast, gamma: p.gamma };
  const tint = hexToLinear(p.tint);
  const tm = Math.max(tint[0], tint[1], tint[2], 1e-6);
  const amt = clamp01(p.tintAmount / 100);
  const tintRgb: RGB = [lerp(1, tint[0] / tm, amt), lerp(1, tint[1] / tm, amt), lerp(1, tint[2] / tm, amt)];
  const gain = Math.pow(2, p.exposure);
  const rgb: RGB = [0, 0, 0];
  const d = img.data;
  const n = d.length / 4;
  for (let i = 0; i < n; i++) {
    const a = (mask ? mask[i] : 1) * k;
    if (a <= 0) continue;
    const o = i * 4;
    rgb[0] = d[o]; rgb[1] = d[o + 1]; rgb[2] = d[o + 2];
    gradeRGB(rgb, g, tintRgb, gain);
    d[o] = lerp(d[o], rgb[0], a); d[o + 1] = lerp(d[o + 1], rgb[1], a); d[o + 2] = lerp(d[o + 2], rgb[2], a);
  }
}

function applyBlocker(img: FloatImage, layer: EditLayer, mask: Float32Array | null, k: number): void {
  if (layer.edit.kind !== 'blocker') return;
  const p = layer.edit.p;
  const amt = clamp01(p.amount / 100) * k;
  const col = hexToLinear(p.color);
  const d = img.data;
  const n = d.length / 4;
  for (let i = 0; i < n; i++) {
    const a = (mask ? mask[i] : 1) * amt;
    if (a <= 0) continue;
    const o = i * 4;
    if (p.mode === 'multiply') {
      const f = 1 - a;
      d[o] *= f; d[o + 1] *= f; d[o + 2] *= f;
    } else {
      d[o] = lerp(d[o], col[0] * p.intensity, a); d[o + 1] = lerp(d[o + 1], col[1] * p.intensity, a); d[o + 2] = lerp(d[o + 2], col[2] * p.intensity, a);
    }
  }
}

/** Fill the masked area from its surroundings (normalized convolution, widening until covered). */
function inpaint(img: FloatImage, hole: Float32Array, smear: number): Float32Array {
  const { width: w, height: h } = img;
  const n = w * h;
  const work = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const wgt = 1 - hole[i];
    work[i * 4] = img.data[i * 4] * wgt; work[i * 4 + 1] = img.data[i * 4 + 1] * wgt; work[i * 4 + 2] = img.data[i * 4 + 2] * wgt; work[i * 4 + 3] = wgt;
  }
  const out = new Float32Array(img.data);
  const filled = new Uint8Array(n);
  let remaining = 0;
  for (let i = 0; i < n; i++) if (hole[i] > 0.01) remaining++;
  let sigma = Math.max(2, (smear / 100) * 0.03 * w);
  for (let pass = 0; pass < 8 && remaining > 0; pass++) {
    const blur = new Float32Array(work);
    blurPremultiplied(blur, w, h, sigma, sigma * 0.5);
    remaining = 0;
    for (let i = 0; i < n; i++) {
      if (hole[i] <= 0.01 || filled[i]) continue;
      const wt = blur[i * 4 + 3];
      if (wt > 0.04) {
        out[i * 4] = blur[i * 4] / wt; out[i * 4 + 1] = blur[i * 4 + 1] / wt; out[i * 4 + 2] = blur[i * 4 + 2] / wt;
        filled[i] = 1;
      } else remaining++;
    }
    sigma *= 2;
  }
  return out;
}

function applyFill(img: FloatImage, layer: EditLayer, mask: Float32Array | null, k: number): void {
  if (layer.edit.kind !== 'fill') return;
  const p = layer.edit.p;
  const { width: w, height: h } = img;
  const m = mask ?? new Float32Array(w * h).fill(1);
  if (p.mode === 'remove') {
    const filled = inpaint(img, m, p.smear);
    mixInto(img.data, filled, m, k);
    return;
  }
  // clone (or move): copy the source area over, optionally scaled, optionally removing the original
  const du = p.sourceU - layer.region.u, dv = p.sourceV - layer.region.v;
  const src = new Float32Array(img.data);
  const gain = p.gain ?? 1;
  if (p.removeSource) {
    const srcMask = regionMask({ ...layer.region, u: p.sourceU, v: p.sourceV, invert: false }, w, h);
    if (srcMask) mixInto(img.data, inpaint(img, srcMask, p.smear), srcMask, k);
  }
  const tmp = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = m[y * w + x] * k;
      if (a <= 0) continue;
      bilinearWrap(src, w, h, (x + 0.5) / w + du, (y + 0.5) / h + dv, tmp);
      const o = (y * w + x) * 4;
      img.data[o] = lerp(img.data[o], tmp[0] * gain, a); img.data[o + 1] = lerp(img.data[o + 1], tmp[1] * gain, a); img.data[o + 2] = lerp(img.data[o + 2], tmp[2] * gain, a);
    }
  }
}

function applyMix(img: FloatImage, layer: EditLayer, mask: Float32Array | null, k: number, ctx: EditContext): void {
  if (layer.edit.kind !== 'mix') return;
  const p = layer.edit.p;
  const other = p.assetId ? ctx.resolveAsset?.(p.assetId) : undefined;
  if (!other) return;
  const { width: w, height: h } = img;
  const tmp = [0, 0, 0, 0];
  const shift = p.rotation / 360;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = (mask ? mask[y * w + x] : 1) * k;
      if (a <= 0) continue;
      bilinearWrap(other.data, other.width, other.height, (x + 0.5) / w - shift, (y + 0.5) / h, tmp);
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const s = tmp[c] * p.intensity, b = img.data[o + c];
        let r: number;
        switch (p.blend) {
          case 'add': r = b + s; break;
          case 'multiply': r = b * s; break;
          case 'screen': { const bc = Math.min(b, 1), sc = Math.min(s, 1); r = bc + sc - bc * sc + Math.max(b - 1, 0) + Math.max(s - 1, 0); break; }
          default: r = s;
        }
        img.data[o + c] = lerp(b, r, a);
      }
    }
  }
}

export interface SunInfo { u: number; v: number; flux: number; radius: number; color: RGB; peak: number; pixels: number }

/**
 * Find the sun inside a region: the brightest pixel there and the connected area brighter
 * than `threshold` of the peak. Returns null when nothing bright is found.
 */
export function detectSun(img: FloatImage, region: EditRegion, thresholdPct: number): { info: SunInfo; blob: Float32Array } | null {
  const { width: w, height: h } = img;
  const t = dirTables(w, h);
  const mask = regionMask({ ...region, shape: region.shape === 'global' ? 'global' : 'circle', feather: 0, invert: false }, w, h);
  let peak = 0, pi = -1;
  for (let i = 0; i < w * h; i++) {
    if (mask && mask[i] < 0.5) continue;
    const l = lum(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    if (l > peak) { peak = l; pi = i; }
  }
  if (pi < 0 || peak <= 0) return null;
  const thr = peak * Math.max(0.01, thresholdPct / 100);
  // flood fill from the peak over pixels above the threshold (wraps horizontally)
  const blob = new Float32Array(w * h);
  const stack = [pi];
  blob[pi] = 1;
  let flux = 0, sr = 0, sg = 0, sb = 0, count = 0, sw = 0, su = 0, sv = 0, omega = 0;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i / w) | 0;
    const l = lum(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    const wgt = t.sa[y];
    flux += l * wgt;
    sr += img.data[i * 4] * wgt; sg += img.data[i * 4 + 1] * wgt; sb += img.data[i * 4 + 2] * wgt;
    omega += wgt; count++;
    const wl = l * wgt; sw += wl; su += ((x + 0.5) / w) * wl; sv += ((y + 0.5) / h) * wl;
    for (const [nx, ny] of [[(x + 1) % w, y], [(x - 1 + w) % w, y], [x, y + 1], [x, y - 1]] as const) {
      if (ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (blob[ni]) continue;
      if (mask && mask[ni] < 0.5) continue;
      if (lum(img.data[ni * 4], img.data[ni * 4 + 1], img.data[ni * 4 + 2]) >= thr) { blob[ni] = 1; stack.push(ni); }
    }
  }
  const norm = Math.max(1e-9, (sr + sg + sb) / 3);
  return {
    info: {
      u: su / Math.max(1e-9, sw), v: sv / Math.max(1e-9, sw), flux, radius: Math.sqrt((omega * 2 * Math.PI) / Math.PI), // t.sa lacks the 2PI of azimuth
      color: [sr / norm, sg / norm, sb / norm], peak, pixels: count,
    },
    blob,
  };
}

function applySun(img: FloatImage, layer: EditLayer, k: number): void {
  if (layer.edit.kind !== 'sun') return;
  const p = layer.edit.p;
  const { width: w, height: h } = img;
  const found = detectSun(img, layer.region, p.threshold);
  if (!found) return;
  const { info, blob } = found;
  const t = dirTables(w, h);

  // grow the blob a little so the sun's halo edge goes too, then paint the surroundings in
  const hole = new Float32Array(blob);
  const grown = new Float32Array(w * h);
  const rad = Math.max(1, Math.round(Math.sqrt(info.pixels) * 0.35));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hole[y * w + x]) continue;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      grown[yy * w + (((x + dx) % w) + w) % w] = 1;
    }
  }
  const filled = inpaint(img, grown, 40);
  const bg = new Float32Array(img.data);
  for (let i = 0; i < w * h; i++) {
    if (grown[i]) { bg[i * 4] = filled[i * 4]; bg[i * 4 + 1] = filled[i * 4 + 1]; bg[i * 4 + 2] = filled[i * 4 + 2]; }
  }
  if (p.action === 'remove') {
    for (let i = 0; i < img.data.length; i += 4) {
      const a = grown[i / 4] * k;
      if (a > 0) { img.data[i] = lerp(img.data[i], bg[i], a); img.data[i + 1] = lerp(img.data[i + 1], bg[i + 1], a); img.data[i + 2] = lerp(img.data[i + 2], bg[i + 2], a); }
    }
    return;
  }
  // resize / move: repaint a disc of the new size carrying the same energy (x intensity)
  const scale = Math.max(0.05, p.scale);
  const newR = Math.max(info.radius * scale, 1e-3);
  const [tu, tv] = p.action === 'move' ? [p.targetU, p.targetV] : [info.u, info.v];
  const c = uvToDir(tu, tv);
  const soft = 0.2;
  // total energy of the sun pixels (sum over rgb) so the repainted disc matches it exactly
  let fluxRgb = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (blob[i]) fluxRgb += (img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) * t.sa[y];
  }
  const target = fluxRgb * Math.max(0, p.intensity);
  const disc = new Float32Array(w * h);
  let discFlux = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = t.sinP[y] * t.cosT[x], dy = t.cosP[y], dz = t.sinP[y] * t.sinT[x];
      const ang = Math.acos(Math.max(-1, Math.min(1, dx * c[0] + dy * c[1] + dz * c[2])));
      const v = 1 - smooth((ang - newR * (1 - soft)) / Math.max(1e-6, newR * soft * 2));
      if (v > 0) { disc[y * w + x] = v; discFlux += v * (info.color[0] + info.color[1] + info.color[2]) * t.sa[y]; }
    }
  }
  const scaleL = discFlux > 0 ? target / discFlux : 0;
  // background first (sun removed at the old place), then the new disc added on top
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const old = grown[i] * k;
    if (old > 0) { img.data[o] = lerp(img.data[o], bg[o], old); img.data[o + 1] = lerp(img.data[o + 1], bg[o + 1], old); img.data[o + 2] = lerp(img.data[o + 2], bg[o + 2], old); }
    const d = disc[i] * k;
    if (d > 0) {
      img.data[o] += info.color[0] * scaleL * d; img.data[o + 1] += info.color[1] * scaleL * d; img.data[o + 2] += info.color[2] * scaleL * d;
    }
  }
}

/** Applies all enabled layers, returning a new buffer (the input is not modified). */
export function applyEdits(base: FloatImage, layers: EditLayer[] | undefined, ctx: EditContext = {}): Float32Array {
  const img: FloatImage = { data: new Float32Array(base.data), width: base.width, height: base.height };
  if (!layers?.length) return img.data;
  for (const layer of layers) {
    if (!layer.enabled) continue;
    const k = clamp01(layer.opacity / 100);
    if (k <= 0) continue;
    const mask = regionMask(layer.region, img.width, img.height);
    switch (layer.edit.kind) {
      case 'adjust': applyAdjust(img, layer, mask, k); break;
      case 'blocker': applyBlocker(img, layer, mask, k); break;
      case 'fill': applyFill(img, layer, mask, k); break;
      case 'mix': applyMix(img, layer, mask, k, ctx); break;
      case 'sun': applySun(img, layer, k); break;
      case 'blur': {
        const blurred = applyFilters(img, layer.edit.p.filters, true, ctx.resolveAsset);
        if (blurred !== img.data) mixInto(img.data, blurred, mask, k);
        break;
      }
    }
  }
  return img.data;
}

// ── procedural sky ──────────────────────────────────────────────────────────

/** Render a Hosek-Wilkie procedural sky as an equirectangular float image (alpha = 1). */
export function renderSky(p: SkyEnvParams, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  const t = dirTables(w, h);
  // Ground albedo is a real physical input to the sky model itself now (see
  // evaluate.ts's skySampler for the same change) - it shapes the whole sky's
  // color/brightness, not just an ad-hoc near-horizon brightness lift.
  const st = skyState(Math.max(1, p.turbidity), p.altitude, p.albedo);
  const alt = p.altitude * D2R, az = p.azimuth * D2R;
  const sd: [number, number, number] = [Math.cos(alt) * Math.cos(az), Math.sin(alt), Math.cos(alt) * Math.sin(az)];
  // A disc smaller than a pixel would vanish or alias, so keep at least ~1 pixel of radius and
  // raise/lower its brightness so the sun still carries exactly the same energy.
  const R = Math.max(SUN_RADIUS * Math.max(0.05, p.discSize), (2 * Math.PI) / w);
  const peak = (60000 * SUN_RADIUS * SUN_RADIUS) / (R * R) * Math.max(0, p.energyBoost);
  const rgb: [number, number, number] = [0, 0, 0];
  const horizonRgb: [number, number, number] = [0, 0, 0];
  skyRadiance(st, Math.PI / 2 - 0.01, Math.PI / 2, horizonRgb);
  const ground = clamp01(p.albedo);
  const falls = [...p.discFalloff].sort((a, b) => a.pos - b.pos);
  const fall = (x: number) => {
    if (falls.length === 0) return 1;
    if (x <= falls[0].pos) return falls[0].value;
    for (let i = 1; i < falls.length; i++) if (x <= falls[i].pos) { const a = falls[i - 1], b = falls[i]; return lerp(a.value, b.value, (x - a.pos) / (b.pos - a.pos || 1e-6)); }
    return falls[falls.length - 1].value;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = t.sinP[y] * t.cosT[x], dy = t.cosP[y], dz = t.sinP[y] * t.sinT[x];
      const gamma = Math.acos(Math.max(-1, Math.min(1, dx * sd[0] + dy * sd[1] + dz * sd[2])));
      let r = 0, g = 0, b = 0;
      if (dy >= 0) {
        if (p.skyVisible) {
          skyRadiance(st, Math.acos(Math.max(0, Math.min(1, dy))), gamma, rgb);
          r = rgb[0]; g = rgb[1]; b = rgb[2];
        }
        if (p.discVisible && gamma < R * 1.6) {
          const u = clamp01(gamma / R);
          const f = fall(u) * (gamma <= R ? 1 : Math.max(0, 1 - (gamma - R) / (R * 0.6)));
          r += peak * f; g += peak * f * 0.94; b += peak * f * 0.85;
        }
      } else {
        // below the horizon: the ground reflects part of the horizon light
        const k = ground * 0.5 * (p.skyVisible ? 1 : 0);
        r = horizonRgb[0] * k; g = horizonRgb[1] * k; b = horizonRgb[2] * k;
      }
      const o = (y * w + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 1;
    }
  }
  return out;
}
