/**
 * Image filters shared by lights and HDRIs: Diffusion Blur and Motion Blur, each in a
 * SPHERICAL flavour (equirectangular HDRI maps - pole aware, wraps horizontally) and a
 * PLANAR flavour (light textures - flat rectangles).
 *
 * Diffusion is energy conserving: the image is converted to flux (radiance x solid
 * angle for spherical maps, premultiplied by alpha for planar) before blurring, so the
 * total amount of light in the result matches the input.
 */

export interface FloatImage {
  /** Linear RGBA, row 0 = top. */
  data: Float32Array;
  width: number;
  height: number;
}

export interface DiffusionParams {
  type: 'diffusion';
  /** 0-100. Spherical: up to ~60 degrees of blur. Planar: up to half the light size. */
  amount: number;
  /** Keep the total light constant. */
  energy: boolean;
}

export interface MotionParams {
  type: 'motion';
  /** 'advanced' enables curve / tilt / noise / speed map. */
  mode: 'linear' | 'advanced';
  /** Direction in degrees (0 = right, 90 = up). */
  angle: number;
  /** 0-100. Spherical: up to 90 degrees of streak. Planar: up to the light width. */
  length: number;
  /** -100..100 bend of the path (advanced). */
  curve: number;
  /** -90..90 degrees the direction turns along the path (advanced). */
  tilt: number;
  /** 0-100 random jitter of the path (advanced). */
  noise: number;
  /** Taps along the path (quality), 8-128. */
  samples: number;
  /** Optional second image: its luminance scales the streak length per pixel (advanced). */
  speedMap?: FloatImage | null;
  /** Serializable reference to the speed map (resolved by the caller when speedMap is not set). */
  speedImageId?: string | null;
  energy: boolean;
}

export type FilterParams = DiffusionParams | MotionParams;

export interface FilterSpec {
  id: string;
  enabled: boolean;
  params: FilterParams;
}

export const defaultDiffusion = (): DiffusionParams => ({ type: 'diffusion', amount: 20, energy: true });
export const defaultMotion = (): MotionParams => ({
  type: 'motion', mode: 'linear', angle: 0, length: 20, curve: 0, tilt: 0, noise: 0, samples: 32, speedMap: null, energy: true,
});

// ── box-blur Gaussian approximation ──────────────────────────────────────────

type Boundary = 'wrap' | 'reflect' | 'zero';

/** Box sizes whose three successive passes approximate a Gaussian of the given sigma. */
function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
  return out;
}

function fold(i: number, n: number, b: Boundary): number {
  if (i >= 0 && i < n) return i;
  if (b === 'wrap') return ((i % n) + n) % n;
  if (b === 'reflect') {
    const p = 2 * n;
    let m = ((i % p) + p) % p;
    if (m >= n) m = p - 1 - m;
    return m;
  }
  return -1;
}

/** One running-sum box pass over a line of `n` RGBA pixels held in `src`; result in `dst`. */
function boxLine(src: Float32Array, dst: Float32Array, n: number, r: number, b: Boundary): void {
  if (r <= 0) {
    dst.set(src.subarray(0, n * 4));
    return;
  }
  const inv = 1 / (2 * r + 1);
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let i = -r; i <= r; i++) {
    const k = fold(i, n, b);
    if (k < 0) continue;
    s0 += src[k * 4]; s1 += src[k * 4 + 1]; s2 += src[k * 4 + 2]; s3 += src[k * 4 + 3];
  }
  for (let i = 0; i < n; i++) {
    dst[i * 4] = s0 * inv; dst[i * 4 + 1] = s1 * inv; dst[i * 4 + 2] = s2 * inv; dst[i * 4 + 3] = s3 * inv;
    const add = fold(i + r + 1, n, b), sub = fold(i - r, n, b);
    if (add >= 0) { s0 += src[add * 4]; s1 += src[add * 4 + 1]; s2 += src[add * 4 + 2]; s3 += src[add * 4 + 3]; }
    if (sub >= 0) { s0 -= src[sub * 4]; s1 -= src[sub * 4 + 1]; s2 -= src[sub * 4 + 2]; s3 -= src[sub * 4 + 3]; }
  }
}

/** Gaussian-ish blur of one line: three box passes. */
function gaussLine(line: Float32Array, tmp: Float32Array, n: number, sigma: number, b: Boundary): void {
  if (sigma < 0.3) return;
  const boxes = boxesForGauss(sigma);
  let a = line, c = tmp;
  for (const w of boxes) {
    const r = Math.min((w - 1) >> 1, b === 'wrap' ? (n >> 1) - 1 : n);
    boxLine(a, c, n, Math.max(0, r), b);
    const t = a; a = c; c = t;
  }
  if (a !== line) line.set(a.subarray(0, n * 4));
}

function blurRows(img: Float32Array, w: number, h: number, sigmaForRow: (y: number) => number, b: Boundary): void {
  const line = new Float32Array(w * 4);
  const tmp = new Float32Array(w * 4);
  for (let y = 0; y < h; y++) {
    const s = sigmaForRow(y);
    if (s < 0.3) continue;
    const o = y * w * 4;
    line.set(img.subarray(o, o + w * 4));
    gaussLine(line, tmp, w, s, b);
    img.set(line, o);
  }
}

function blurColumns(img: Float32Array, w: number, h: number, sigma: number, b: Boundary): void {
  if (sigma < 0.3) return;
  const line = new Float32Array(h * 4);
  const tmp = new Float32Array(h * 4);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      line[y * 4] = img[i]; line[y * 4 + 1] = img[i + 1]; line[y * 4 + 2] = img[i + 2]; line[y * 4 + 3] = img[i + 3];
    }
    gaussLine(line, tmp, h, sigma, b);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      img[i] = line[y * 4]; img[i + 1] = line[y * 4 + 1]; img[i + 2] = line[y * 4 + 2]; img[i + 3] = line[y * 4 + 3];
    }
  }
}

// ── spherical helpers ────────────────────────────────────────────────────────

/** Solid angle weight of row y in an equirectangular map (proportional; constant factors cancel). */
export function rowSolidAngle(y: number, h: number): number {
  const p1 = (y / h) * Math.PI, p2 = ((y + 1) / h) * Math.PI;
  return Math.cos(p1) - Math.cos(p2);
}

const sum3 = (d: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s;
};

/** Total flux of an equirectangular image (radiance x solid angle), all colour channels. */
export function sphericalFlux(img: FloatImage): number {
  let s = 0;
  for (let y = 0; y < img.height; y++) {
    const sa = rowSolidAngle(y, img.height);
    let row = 0;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      row += img.data[i] + img.data[i + 1] + img.data[i + 2];
    }
    s += row * sa;
  }
  return s;
}

// ── diffusion ────────────────────────────────────────────────────────────────

export function diffusionSpherical(img: FloatImage, p: DiffusionParams): Float32Array {
  const { width: w, height: h } = img;
  const out = new Float32Array(img.data);
  const amount = Math.max(0, Math.min(100, p.amount));
  if (amount <= 0) return out;
  const sigmaDeg = (amount / 100) * 60;
  const sigmaY = (sigmaDeg / 180) * h;
  const sigmaXEq = (sigmaDeg / 360) * w;
  const before = p.energy ? sphericalFlux(img) : 0;

  // Blur radiance x solid angle AND the solid angle itself, then divide: a solid-angle
  // weighted average. Flat regions stay flat and light is not pushed into the tiny
  // polar pixels; the alpha channel carries the weight while we work.
  const sa = new Float32Array(h);
  for (let y = 0; y < h; y++) sa[y] = rowSolidAngle(y, h) * h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    out[i] *= sa[y]; out[i + 1] *= sa[y]; out[i + 2] *= sa[y]; out[i + 3] = sa[y];
  }
  blurRows(out, w, h, (y) => {
    const lat = ((y + 0.5) / h - 0.5) * Math.PI;
    return Math.min(w / 4, sigmaXEq / Math.max(0.02, Math.cos(lat)));
  }, 'wrap');
  blurColumns(out, w, h, sigmaY, 'reflect');
  for (let i = 0; i < out.length; i += 4) {
    const wgt = out[i + 3];
    const inv = wgt > 1e-9 ? 1 / wgt : 0;
    out[i] *= inv; out[i + 1] *= inv; out[i + 2] *= inv; out[i + 3] = img.data[i + 3];
  }
  if (p.energy) renormalizeFlux(out, w, h, before);
  return out;
}

/** Scale an equirect image so its total flux equals `target`. */
function renormalizeFlux(d: Float32Array, w: number, h: number, target: number): void {
  const now = sphericalFlux({ data: d, width: w, height: h });
  if (now > 0 && target > 0) {
    const k = target / now;
    for (let i = 0; i < d.length; i += 4) { d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
  }
}

export function diffusionPlanar(img: FloatImage, p: DiffusionParams): Float32Array {
  const { width: w, height: h } = img;
  const out = new Float32Array(img.data);
  const amount = Math.max(0, Math.min(100, p.amount));
  if (amount <= 0) return out;
  const sigma = (amount / 100) * 0.5 * Math.min(w, h);
  // premultiply so transparent texels carry no colour
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    out[i] *= a; out[i + 1] *= a; out[i + 2] *= a;
  }
  const before = sum3(out);
  blurRows(out, w, h, () => sigma, 'zero');
  blurColumns(out, w, h, sigma, 'zero');
  if (p.energy) {
    const after = sum3(out);
    if (after > 0 && before > 0) {
      const k = before / after;
      for (let i = 0; i < out.length; i += 4) { out[i] *= k; out[i + 1] *= k; out[i + 2] *= k; }
    }
  }
  // un-premultiply
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a > 1e-6) { out[i] /= a; out[i + 1] /= a; out[i + 2] /= a; } else { out[i] = out[i + 1] = out[i + 2] = 0; }
  }
  return out;
}

// ── motion blur ──────────────────────────────────────────────────────────────

function hash01(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function sampleBilinear(img: Float32Array, w: number, h: number, x: number, y: number, wrapX: boolean, out: number[]): void {
  const fx = x - 0.5, fy = y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const px = (xi: number) => (wrapX ? ((xi % w) + w) % w : Math.min(w - 1, Math.max(0, xi)));
  const py = (yi: number) => Math.min(h - 1, Math.max(0, yi));
  const xa = px(x0), xb = px(x0 + 1), ya = py(y0), yb = py(y0 + 1);
  const i00 = (ya * w + xa) * 4, i10 = (ya * w + xb) * 4, i01 = (yb * w + xa) * 4, i11 = (yb * w + xb) * 4;
  for (let k = 0; k < 4; k++) {
    const a = img[i00 + k] + (img[i10 + k] - img[i00 + k]) * tx;
    const b = img[i01 + k] + (img[i11 + k] - img[i01 + k]) * tx;
    out[k] = a + (b - a) * ty;
  }
}

function motionCore(img: FloatImage, p: MotionParams, spherical: boolean): Float32Array {
  const { width: w, height: h } = img;
  const src = new Float32Array(img.data);
  const length = Math.max(0, Math.min(100, p.length)) / 100;
  if (length <= 0) return src;

  // Spherical: gather radiance x solid angle and the solid angle (kept in alpha) and divide,
  // a solid-angle weighted average. Planar: premultiply by alpha.
  const sa = new Float32Array(h);
  if (spherical) {
    for (let y = 0; y < h; y++) sa[y] = rowSolidAngle(y, h) * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      src[i] *= sa[y]; src[i + 1] *= sa[y]; src[i + 2] *= sa[y]; src[i + 3] = sa[y];
    }
  } else {
    for (let i = 0; i < src.length; i += 4) { const a = src[i + 3]; src[i] *= a; src[i + 1] *= a; src[i + 2] *= a; }
  }
  const before = p.energy ? (spherical ? sphericalFlux(img) : sum3(src)) : 0;

  const out = new Float32Array(src.length);
  const N = Math.max(4, Math.min(256, Math.round(p.samples)));
  const adv = p.mode === 'advanced';
  const a0 = (p.angle * Math.PI) / 180;
  const tilt = adv ? (p.tilt * Math.PI) / 180 : 0;
  const curve = adv ? p.curve / 100 : 0;
  const noise = adv ? p.noise / 100 : 0;
  const speed = adv ? p.speedMap : null;
  // streak length in pixels (horizontal-equivalent at the equator / light width)
  const lenX = spherical ? length * 0.25 * w : length * w; // 100 = 90 degrees of the 360 wide map
  const tmp = [0, 0, 0, 0];
  const spd = [0, 0, 0, 0];

  for (let y = 0; y < h; y++) {
    const lat = ((y + 0.5) / h - 0.5) * Math.PI;
    const cx = spherical ? 1 / Math.max(0.05, Math.cos(lat)) : 1;
    for (let x = 0; x < w; x++) {
      let L = lenX;
      if (speed) {
        sampleBilinear(speed.data, speed.width, speed.height, ((x + 0.5) / w) * speed.width, ((y + 0.5) / h) * speed.height, spherical, spd);
        L *= Math.max(0, 0.2126 * spd[0] + 0.7152 * spd[1] + 0.0722 * spd[2]);
      }
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < N; k++) {
        const s = (k + 0.5) / N - 0.5; // -0.5 .. 0.5
        const ang = a0 + tilt * s;
        const dx = Math.cos(ang), dy = -Math.sin(ang); // +angle = up on screen
        const along = s * L;
        let perp = curve * (0.25 - s * s) * 2 * L;
        if (noise > 0) perp += (hash01(x, y, k) - 0.5) * 2 * noise * 0.3 * L;
        let ox = along * dx - perp * dy;
        const oy = along * dy + perp * dx;
        // equirect maps are stretched horizontally near the poles
        ox *= cx;
        sampleBilinear(src, w, h, x + 0.5 + ox, y + 0.5 + oy, spherical, tmp);
        r += tmp[0]; g += tmp[1]; b += tmp[2]; a += tmp[3];
      }
      const i = (y * w + x) * 4;
      out[i] = r / N; out[i + 1] = g / N; out[i + 2] = b / N; out[i + 3] = a / N;
    }
  }

  if (spherical) {
    for (let i = 0; i < out.length; i += 4) {
      const wgt = out[i + 3];
      const inv = wgt > 1e-9 ? 1 / wgt : 0;
      out[i] *= inv; out[i + 1] *= inv; out[i + 2] *= inv; out[i + 3] = img.data[i + 3];
    }
    if (p.energy) renormalizeFlux(out, w, h, before);
  } else {
    if (p.energy) {
      const after = sum3(out);
      if (after > 0 && before > 0) {
        const k = before / after;
        for (let i = 0; i < out.length; i += 4) { out[i] *= k; out[i + 1] *= k; out[i + 2] *= k; }
      }
    }
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      if (a > 1e-6) { out[i] /= a; out[i + 1] /= a; out[i + 2] /= a; } else { out[i] = out[i + 1] = out[i + 2] = 0; }
    }
  }
  return out;
}

export const motionSpherical = (img: FloatImage, p: MotionParams): Float32Array => motionCore(img, p, true);
export const motionPlanar = (img: FloatImage, p: MotionParams): Float32Array => motionCore(img, p, false);

// ── stack ────────────────────────────────────────────────────────────────────

export function applyFilters(
  img: FloatImage,
  filters: FilterSpec[] | undefined,
  spherical: boolean,
  resolveImage?: (id: string) => FloatImage | undefined,
): Float32Array {
  let cur = img.data;
  if (!filters) return cur;
  for (const f of filters) {
    if (!f.enabled) continue;
    const input: FloatImage = { data: cur, width: img.width, height: img.height };
    if (f.params.type === 'diffusion') cur = spherical ? diffusionSpherical(input, f.params) : diffusionPlanar(input, f.params);
    else {
      let mp = f.params;
      if (!mp.speedMap && mp.speedImageId && resolveImage) mp = { ...mp, speedMap: resolveImage(mp.speedImageId) ?? null };
      cur = spherical ? motionSpherical(input, mp) : motionPlanar(input, mp);
    }
  }
  return cur;
}
