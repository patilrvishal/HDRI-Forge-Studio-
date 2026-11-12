/**
 * Image filters shared by lights and HDRIs, following HDR Light Studio's filter set:
 *   Diffusion Blur, Motion Blur, Motion Blur (Advanced) and Reflection,
 * each in a SPHERICAL flavour (equirectangular HDRI maps - pole aware, wraps horizontally)
 * and a PLANAR flavour (light textures - flat rectangles).
 *
 * Diffusion is energy conserving: the total amount of light in the result matches the input.
 */

export interface FloatImage {
  /** Linear RGBA, row 0 = top. */
  data: Float32Array;
  width: number;
  height: number;
}

export type Accuracy = 'low' | 'medium' | 'high';

export interface DiffusionParams {
  type: 'diffusion';
  /** Percentage: 0-100. Higher = more blur. */
  amount: number;
  /** Higher settings are smoother but slower. */
  accuracy: Accuracy;
  /** Planar: scale the blurred content to fit inside the image so the soft edges are kept. */
  scaleToFit: boolean;
  /** Energy conserving - the light content stays the same as the blur grows. */
  energy: boolean;
}

export interface NoiseProfile {
  /** Scales the noise distribution; smaller values give a smoother result. */
  spread: number;
  /** Varies the noise, repeatably. */
  seed: number;
  /** Scales the noise height; 0 removes all noise. */
  amplitude: number;
  /** Clamp the noise to positive values only. */
  groundClamp: boolean;
}

export interface MotionParams {
  type: 'motion';
  /** 'advanced' = Motion Blur (Advanced): curvature, tilt, noise profile and depth image. */
  mode: 'linear' | 'advanced';
  /** Spherical: U and V direction of travel in HDRI map image space (-1..1). */
  u: number;
  v: number;
  /** Planar: blur angle in degrees. */
  angle: number;
  /** Blur length 0-100: larger = faster movement. */
  length: number;
  /** Spherical: 1 = physically accurate; higher keeps more of the un-blurred image in the travel direction. */
  bias: number;
  accuracy: Accuracy;
  /** Planar: scale content to fit so the blur does not spill over the edges. */
  scaleToFit: boolean;
  /** Advanced: 0 = straight path, higher = more curved. */
  curvature: number;
  /** Advanced: orientation of the curve in degrees (0 curves left). */
  tilt: number;
  /** Advanced: noise on the path. */
  noise: NoiseProfile;
  /** Advanced: a depth image - black pixels stay un-blurred, white ones get the full blur. */
  speedMap?: FloatImage | null;
  /** Serializable reference to the depth image (resolved by the caller when speedMap is not set). */
  speedImageId?: string | null;
  energy: boolean;
}

export interface ReflectionParams {
  type: 'reflection';
  /** Direction of the reflection axis in degrees (spherical: meridian azimuth; planar: line angle). */
  axis: number;
  /** Planar: axis position from the centre, -1..1. */
  offset: number;
  /** Which side is reflected onto the other. */
  direction: 'forward' | 'backward';
  /** Brightness of the reflected light. */
  brightness: number;
  /** 0-1 opacity of the reflection. */
  alpha: number;
  /** 0-1 softness of the transition across the axis. */
  blend: number;
}

export type FilterParams = DiffusionParams | MotionParams | ReflectionParams;

export interface FilterSpec {
  id: string;
  enabled: boolean;
  params: FilterParams;
}

export const defaultDiffusion = (): DiffusionParams => ({ type: 'diffusion', amount: 20, accuracy: 'medium', scaleToFit: false, energy: true });
export const defaultNoise = (): NoiseProfile => ({ spread: 1, seed: 1, amplitude: 0.5, groundClamp: false });
export const defaultMotion = (): MotionParams => ({
  type: 'motion', mode: 'linear', u: 1, v: 0, angle: 0, length: 20, bias: 1, accuracy: 'medium', scaleToFit: false,
  curvature: 0, tilt: 0, noise: defaultNoise(), speedMap: null, speedImageId: null, energy: true,
});
export const defaultMotionAdvanced = (): MotionParams => ({ ...defaultMotion(), mode: 'advanced', curvature: 0.5, noise: { ...defaultNoise(), amplitude: 0 } });
export const defaultReflection = (): ReflectionParams => ({ type: 'reflection', axis: 0, offset: 0, direction: 'forward', brightness: 1, alpha: 1, blend: 0.1 });

const PASSES: Record<Accuracy, number> = { low: 2, medium: 3, high: 5 };
const SAMPLES: Record<Accuracy, number> = { low: 16, medium: 32, high: 72 };

// ── box-blur Gaussian approximation ──────────────────────────────────────────

type Boundary = 'wrap' | 'reflect' | 'zero';

/** Box sizes whose successive passes approximate a Gaussian of the given sigma. */
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

/** Gaussian-ish blur of one line: successive box passes (more passes = smoother). */
function gaussLine(line: Float32Array, tmp: Float32Array, n: number, sigma: number, b: Boundary, passes: number): void {
  if (sigma < 0.3) return;
  const boxes = boxesForGauss(sigma, passes);
  let a = line, c = tmp;
  for (const w of boxes) {
    const r = Math.min((w - 1) >> 1, b === 'wrap' ? (n >> 1) - 1 : n);
    boxLine(a, c, n, Math.max(0, r), b);
    const t = a; a = c; c = t;
  }
  if (a !== line) line.set(a.subarray(0, n * 4));
}

function blurRows(img: Float32Array, w: number, h: number, sigmaForRow: (y: number) => number, b: Boundary, passes = 3): void {
  const line = new Float32Array(w * 4);
  const tmp = new Float32Array(w * 4);
  for (let y = 0; y < h; y++) {
    const s = sigmaForRow(y);
    if (s < 0.3) continue;
    const o = y * w * 4;
    line.set(img.subarray(o, o + w * 4));
    gaussLine(line, tmp, w, s, b, passes);
    img.set(line, o);
  }
}

function blurColumns(img: Float32Array, w: number, h: number, sigma: number, b: Boundary, passes = 3): void {
  if (sigma < 0.3) return;
  const line = new Float32Array(h * 4);
  const tmp = new Float32Array(h * 4);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      line[y * 4] = img[i]; line[y * 4 + 1] = img[i + 1]; line[y * 4 + 2] = img[i + 2]; line[y * 4 + 3] = img[i + 3];
    }
    gaussLine(line, tmp, h, sigma, b, passes);
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

/** Scale an equirect image so its total flux equals `target`. */
function renormalizeFlux(d: Float32Array, w: number, h: number, target: number): void {
  const now = sphericalFlux({ data: d, width: w, height: h });
  if (now > 0 && target > 0) {
    const k = target / now;
    for (let i = 0; i < d.length; i += 4) { d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
  }
}

// ── diffusion ────────────────────────────────────────────────────────────────

export function diffusionSpherical(img: FloatImage, p: DiffusionParams): Float32Array {
  const { width: w, height: h } = img;
  const out = new Float32Array(img.data);
  const amount = Math.max(0, Math.min(100, p.amount));
  if (amount <= 0) return out;
  const passes = PASSES[p.accuracy ?? 'medium'];
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
  }, 'wrap', passes);
  blurColumns(out, w, h, sigmaY, 'reflect', passes);
  for (let i = 0; i < out.length; i += 4) {
    const wgt = out[i + 3];
    const inv = wgt > 1e-9 ? 1 / wgt : 0;
    out[i] *= inv; out[i + 1] *= inv; out[i + 2] *= inv; out[i + 3] = img.data[i + 3];
  }
  if (p.energy) renormalizeFlux(out, w, h, before);
  return out;
}

/** Shrink an RGBA image about its centre by factor k (0<k<=1), the rest becomes transparent. */
function shrinkAboutCentre(src: Float32Array, w: number, h: number, k: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5 - w / 2) / k + w / 2 - 0.5, sy = (y + 0.5 - h / 2) / k + h / 2 - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) continue;
      const tx = sx - x0, ty = sy - y0;
      const at = (xx: number, yy: number, c: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[(yy * w + xx) * 4 + c]);
      for (let c = 0; c < 4; c++) {
        const a = at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx;
        const b = at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx;
        out[(y * w + x) * 4 + c] = a * (1 - ty) + b * ty;
      }
    }
  }
  return out;
}

export function diffusionPlanar(img: FloatImage, p: DiffusionParams): Float32Array {
  const { width: w, height: h } = img;
  const amount = Math.max(0, Math.min(100, p.amount));
  if (amount <= 0) return new Float32Array(img.data);
  const passes = PASSES[p.accuracy ?? 'medium'];
  const sigma = (amount / 100) * 0.5 * Math.min(w, h);
  let work = new Float32Array(img.data);
  // premultiply so transparent texels carry no colour
  for (let i = 0; i < work.length; i += 4) {
    const a = work[i + 3];
    work[i] *= a; work[i + 1] *= a; work[i + 2] *= a;
  }
  const before = sum3(work);
  // Scale to fit: pull the content in so its soft edges stay inside the image
  if (p.scaleToFit) work = shrinkAboutCentre(work, w, h, Math.max(0.2, 1 - (2.2 * sigma) / Math.min(w, h)));
  const target = p.scaleToFit ? sum3(work) : before;
  blurRows(work, w, h, () => sigma, 'zero', passes);
  blurColumns(work, w, h, sigma, 'zero', passes);
  if (p.energy) {
    const after = sum3(work);
    if (after > 0 && target > 0) {
      const k = before / after;
      for (let i = 0; i < work.length; i += 4) { work[i] *= k; work[i + 1] *= k; work[i + 2] *= k; }
    }
  }
  // un-premultiply
  for (let i = 0; i < work.length; i += 4) {
    const a = work[i + 3];
    if (a > 1e-6) { work[i] /= a; work[i + 1] /= a; work[i + 2] /= a; } else { work[i] = work[i + 1] = work[i + 2] = 0; }
  }
  return work;
}

/** In-place separable blur of a premultiplied image (rgb already multiplied by the weight in alpha). */
export function blurPremultiplied(data: Float32Array, w: number, h: number, sigmaX: number, sigmaY: number): void {
  blurRows(data, w, h, () => sigmaX, 'wrap');
  blurColumns(data, w, h, sigmaY, 'reflect');
}

// ── motion blur ──────────────────────────────────────────────────────────────

function hash01(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** Smooth 1-D value noise (0..1) with a seed. */
function valueNoise(t: number, seed: number, phase: number): number {
  const i = Math.floor(t + phase), f = t + phase - i;
  const a = hash01(i, seed, 7), b = hash01(i + 1, seed, 7);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
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
  let src = new Float32Array(img.data);
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
  if (!spherical && p.scaleToFit) src = shrinkAboutCentre(src, w, h, Math.max(0.2, 1 - length * 0.9));

  const out = new Float32Array(src.length);
  const N = SAMPLES[p.accuracy ?? 'medium'];
  const adv = p.mode === 'advanced';
  // direction of travel
  let dirX: number, dirY: number;
  if (spherical) {
    const l = Math.hypot(p.u, p.v) || 1;
    dirX = p.u / l; dirY = p.v / l;
  } else {
    const a = (p.angle * Math.PI) / 180;
    dirX = Math.cos(a); dirY = -Math.sin(a);
  }
  const curv = adv ? p.curvature : 0;
  const tilt = ((adv ? p.tilt : 0) * Math.PI) / 180;
  const noise = adv ? p.noise : null;
  const speed = adv ? p.speedMap : null;
  const bias = Math.max(0.1, p.bias ?? 1);
  // perpendicular direction the curve bends toward: tilt 0 = to the left of travel
  const perpBaseX = dirY, perpBaseY = -dirX;
  const pcx = perpBaseX * Math.cos(tilt) - perpBaseY * Math.sin(tilt);
  const pcy = perpBaseX * Math.sin(tilt) + perpBaseY * Math.cos(tilt);
  // streak length in pixels: 100 = a quarter of the map width (90 degrees) / a full light width
  const lenX = spherical ? length * 0.25 * w : length * w;
  const tmp = [0, 0, 0, 0];
  const spd = [0, 0, 0, 0];
  const weights = new Float32Array(N);
  let wsum = 0;
  for (let k = 0; k < N; k++) {
    const s = (k + 0.5) / N - 0.5;
    weights[k] = bias === 1 ? 1 : Math.pow(Math.max(0.0001, 1 - 2 * Math.abs(s)), bias - 1);
    wsum += weights[k];
  }

  for (let y = 0; y < h; y++) {
    const lat = ((y + 0.5) / h - 0.5) * Math.PI;
    const cx = spherical ? 1 / Math.max(0.05, Math.cos(lat)) : 1;
    for (let x = 0; x < w; x++) {
      let L = lenX;
      if (speed) {
        sampleBilinear(speed.data, speed.width, speed.height, ((x + 0.5) / w) * speed.width, ((y + 0.5) / h) * speed.height, spherical, spd);
        L *= Math.max(0, Math.min(1, 0.2126 * spd[0] + 0.7152 * spd[1] + 0.0722 * spd[2]));
      }
      const phase = noise ? hash01(x, y, noise.seed) * 50 : 0;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < N; k++) {
        const s = (k + 0.5) / N - 0.5; // -0.5 .. 0.5
        const along = s * L;
        let perp = curv * (0.25 - s * s) * 2 * L;
        if (noise && noise.amplitude > 0) {
          let n = valueNoise((s + 0.5) * 6 / Math.max(0.05, noise.spread), noise.seed, phase) * 2 - 1;
          if (noise.groundClamp) n = Math.max(0, n);
          perp += n * noise.amplitude * 0.3 * L;
        }
        let ox = along * dirX + perp * pcx;
        const oy = along * dirY + perp * pcy;
        // equirect maps are stretched horizontally near the poles
        ox *= cx;
        sampleBilinear(src, w, h, x + 0.5 + ox, y + 0.5 + oy, spherical, tmp);
        const wk = weights[k];
        r += tmp[0] * wk; g += tmp[1] * wk; b += tmp[2] * wk; a += tmp[3] * wk;
      }
      const i = (y * w + x) * 4;
      out[i] = r / wsum; out[i + 1] = g / wsum; out[i + 2] = b / wsum; out[i + 3] = a / wsum;
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

// ── reflection ───────────────────────────────────────────────────────────────

const smooth01 = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/**
 * Reflection filter: mirrors one side of the design onto the other across an axis, for a
 * symmetrical lighting design. Spherical: the axis is a meridian (a vertical plane through the
 * origin); planar: a line through the image.
 */
export function reflectionFilter(img: FloatImage, p: ReflectionParams, spherical: boolean): Float32Array {
  const { width: w, height: h } = img;
  const out = new Float32Array(img.data);
  const tmp = [0, 0, 0, 0];
  const sign = p.direction === 'forward' ? 1 : -1;
  const soft = Math.max(1e-4, p.blend);
  const ang = (p.axis * Math.PI) / 180;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mx: number, my: number, side: number;
      if (spherical) {
        // longitude difference from the axis meridian, wrapped to -pi..pi
        const lon = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
        let d = lon - ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        side = sign * d; // > 0: destination side (receives the reflection)
        const mLon = ang - d;
        mx = ((mLon / (2 * Math.PI)) + 0.5) * w;
        my = y + 0.5;
        side = side / (Math.PI / 2);
      } else {
        // signed distance from the axis line through (offset) at angle
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const px = (x + 0.5) / w * 2 - 1 - nx * p.offset, py = (y + 0.5) / h * 2 - 1 - ny * p.offset;
        const dist = px * nx + py * ny;
        side = sign * dist;
        const rx = px - 2 * dist * nx + nx * p.offset, ry = py - 2 * dist * ny + ny * p.offset;
        mx = ((rx + 1) / 2) * w; my = ((ry + 1) / 2) * h;
      }
      if (side <= 0) continue;
      if (!spherical && (mx < 0 || my < 0 || mx > w || my > h)) continue;
      sampleBilinear(img.data, w, h, mx, my, spherical, tmp);
      const k = Math.max(0, Math.min(1, p.alpha)) * smooth01(side / soft);
      const i = (y * w + x) * 4;
      out[i] += tmp[0] * p.brightness * k;
      out[i + 1] += tmp[1] * p.brightness * k;
      out[i + 2] += tmp[2] * p.brightness * k;
      if (!spherical) out[i + 3] = Math.max(out[i + 3], tmp[3] * k);
    }
  }
  return out;
}

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
    const par = f.params;
    if (par.type === 'diffusion') cur = spherical ? diffusionSpherical(input, par) : diffusionPlanar(input, par);
    else if (par.type === 'reflection') cur = reflectionFilter(input, par, spherical);
    else {
      let mp = par;
      if (!mp.speedMap && mp.speedImageId && resolveImage) mp = { ...mp, speedMap: resolveImage(mp.speedImageId) ?? null };
      cur = spherical ? motionSpherical(input, mp) : motionPlanar(input, mp);
    }
  }
  return cur;
}
