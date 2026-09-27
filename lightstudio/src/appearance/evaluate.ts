/**
 * Light Appearance evaluator: turns a LightAppearance description into a
 * linear-float RGBA image. Pure maths - no DOM - so it runs in the app, in
 * workers and in Node tests.
 *
 * Coordinates: every content sampler works in "light space" x,y in [-1,1]
 * (y up). `aspect` = light width / light height so circular content stays
 * circular on a rectangular light.
 */
import type {
  AppearanceBlend,
  AppearanceGlobals,
  AppearanceImage,
  BoxGradParams,
  BulbParams,
  ContentLayer,
  ContentTransform,
  CurvePoint,
  EvalContext,
  FlatParams,
  GradientParams,
  ImageParams,
  LightAppearance,
  LumiCurveParams,
  PolygonParams,
  RampStop,
  ScrimParams,
  SkyParams,
} from './types';
import { applyFilters } from '../filters/filters';
import { skyRadiance, skyState, SUN_RADIUS } from './preetham';

// ── small helpers ───────────────────────────────────────────────────────────

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};
const D2R = Math.PI / 180;

export type RGB = [number, number, number];

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export { l2s as linearToSrgbChannel, s2l as srgbToLinearChannel };

const colorCache = new Map<string, RGB>();
/** '#rrggbb' (sRGB) -> linear RGB. */
export function hexToLinear(hex: string): RGB {
  const hit = colorCache.get(hex);
  if (hit) return hit;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.padEnd(6, '0').slice(0, 6), 16) || 0;
  const out: RGB = [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)];
  colorCache.set(hex, out);
  return out;
}

/** Ramp lookup honouring each stop's interpolation (linear / cosine / step). */
export function evalRamp(stops: RampStop[], t: number): number {
  const n = stops.length;
  if (n === 0) return 1;
  if (n === 1 || t <= stops[0].pos) return stops[0].value;
  if (t >= stops[n - 1].pos) return stops[n - 1].value;
  for (let i = 1; i < n; i++) {
    if (t <= stops[i].pos) {
      const a = stops[i - 1];
      const b = stops[i];
      let u = (t - a.pos) / (b.pos - a.pos || 1e-6);
      if (a.interp === 'step') u = 0;
      else if (a.interp === 'cosine') u = 0.5 - 0.5 * Math.cos(Math.PI * u);
      return lerp(a.value, b.value, u);
    }
  }
  return stops[n - 1].value;
}

export function evalColorRamp(stops: RampStop[], t: number, out: RGB): void {
  const n = stops.length;
  if (n === 0) {
    out[0] = out[1] = out[2] = 1;
    return;
  }
  const col = (s: RampStop) => hexToLinear(s.color ?? '#ffffff');
  if (n === 1 || t <= stops[0].pos) {
    const c = col(stops[0]);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return;
  }
  if (t >= stops[n - 1].pos) {
    const c = col(stops[n - 1]);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return;
  }
  for (let i = 1; i < n; i++) {
    if (t <= stops[i].pos) {
      const a = col(stops[i - 1]);
      const b = col(stops[i]);
      let u = (t - stops[i - 1].pos) / (stops[i].pos - stops[i - 1].pos || 1e-6);
      const mode = stops[i - 1].interp;
      if (mode === 'step') u = 0;
      else if (mode === 'cosine') u = 0.5 - 0.5 * Math.cos(Math.PI * u);
      out[0] = lerp(a[0], b[0], u);
      out[1] = lerp(a[1], b[1], u);
      out[2] = lerp(a[2], b[2], u);
      return;
    }
  }
}

const sortStops = (s: RampStop[]) => [...s].sort((a, b) => a.pos - b.pos);

// ── samplers ────────────────────────────────────────────────────────────────

/** Writes r,g,b (linear HDR) and a (0..1 shape coverage) into `out`. */
type Sampler = (x: number, y: number, out: Float64Array) => void;

function flatSampler(p: FlatParams): Sampler {
  const c = hexToLinear(p.color);
  const r = c[0] * p.intensity, g = c[1] * p.intensity, b = c[2] * p.intensity;
  const a = clamp(p.alpha);
  return (_x, _y, o) => { o[0] = r; o[1] = g; o[2] = b; o[3] = a; };
}

/** Distance from the centre in a shape's own metric: 0 at the centre, 1 at the edge. */
function shapeDist(shape: 'round' | 'rect' | 'hex', px: number, py: number): number {
  switch (shape) {
    case 'rect': return Math.max(Math.abs(px), Math.abs(py));
    case 'hex': {
      const ax = Math.abs(px), ay = Math.abs(py);
      return Math.max(ax * 0.8660254 + ay * 0.5, ay);
    }
    default: return Math.hypot(px, py);
  }
}

function bulbSampler(p: BulbParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const alphaRamp = sortStops(p.alphaRamp);
  const colorRamp = sortStops(p.colorRamp);
  const width = Math.max(0.01, p.width / 100);
  const tmp: RGB = [1, 1, 1];
  // Without "Outside" the falloff stops at the inner bounding box (the inscribed circle / box);
  // with it the falloff runs out to the corners for a softbox look.
  const outsideK = p.outside ? (p.shape === 'round' ? Math.SQRT2 : 1) : 1;
  return (x, y, o) => {
    const m = Math.min(aspect, 1);
    const yy = y - p.position / 50;
    // round / hex stay round on a rectangular light; rect follows the light edges
    const d = p.shape === 'rect' ? Math.max(Math.abs(x), Math.abs(yy)) : shapeDist(p.shape, (x * aspect) / m, yy / m);
    const t = d / (width * outsideK);
    const a = evalRamp(alphaRamp, clamp(t));
    if (p.colorMode === 'ramp') {
      evalColorRamp(colorRamp, clamp(t), tmp);
      o[0] = tmp[0] * p.intensity; o[1] = tmp[1] * p.intensity; o[2] = tmp[2] * p.intensity;
    } else {
      o[0] = c[0] * p.intensity; o[1] = c[1] * p.intensity; o[2] = c[2] * p.intensity;
    }
    o[3] = t > 1 && !p.outside ? 0 : t > 1 ? evalRamp(alphaRamp, 1) : a;
    if (p.half && y < 0) o[3] = 0;
  };
}

function gradientSampler(p: GradientParams, aspect: number): Sampler {
  const vr = sortStops(p.valueRamp);
  const ar = sortStops(p.alphaRamp);
  const cr = sortStops(p.colorRamp);
  const ca = Math.cos(p.rotation * D2R), sa = Math.sin(p.rotation * D2R);
  const m = Math.min(aspect, 1);
  const ext = Math.max(0.01, p.extent);
  const tmp: RGB = [1, 1, 1];
  return (x, y, o) => {
    const dx = x - p.originX, dy = y - p.originY;
    let t: number;
    if (p.mode === 'radial') t = clamp(Math.hypot(dx * aspect, dy) / (m * ext));
    else t = clamp((dx * ca + dy * sa) / ext * 0.5 + 0.5);
    const v = evalRamp(vr, t) * p.intensity;
    evalColorRamp(cr, t, tmp);
    o[0] = tmp[0] * v; o[1] = tmp[1] * v; o[2] = tmp[2] * v;
    o[3] = clamp(evalRamp(ar, t));
  };
}

function boxGradSampler(p: BoxGradParams): Sampler {
  const c = hexToLinear(p.color);
  const hr = sortStops(p.hRamp);
  const vr = sortStops(p.vRamp);
  const edge = (d: number, e: { pos: number; soft: number }) => {
    const lo = e.pos - e.soft * 0.5, hi = e.pos + e.soft * 0.5 + 1e-4;
    if (p.edgeInterp === 'step') return d >= e.pos ? 1 : 0;
    return smoothstep(lo, hi, d);
  };
  return (x, y, o) => {
    // distance from each edge measured edge -> centre in 0..1
    const dl = (x + 1), dr = (1 - x), db = (y + 1), dt = (1 - y);
    const box = edge(dl, p.left) * edge(dr, p.right) * edge(dt, p.top) * edge(db, p.bottom);
    const h = evalRamp(hr, x * 0.5 + 0.5);
    const v = evalRamp(vr, y * 0.5 + 0.5);
    let comb: number;
    switch (p.combine) {
      case 'add': comb = h + v; break;
      case 'min': comb = Math.min(h, v); break;
      case 'max': comb = Math.max(h, v); break;
      default: comb = h * v;
    }
    const k = comb * p.intensity;
    o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k;
    o[3] = box;
  };
}

/** Signed distance to a regular polygon (circumradius r, n sides, one vertex up). */
function sdRegularPolygon(px: number, py: number, r: number, n: number): number {
  const an = Math.PI / n;
  const acx = Math.cos(an), acy = Math.sin(an);
  const bn = ((Math.atan2(px, py) % (2 * an)) + 2 * an) % (2 * an) - an;
  const len = Math.hypot(px, py);
  let qx = len * Math.cos(bn), qy = len * Math.abs(Math.sin(bn));
  qx -= r * acx; qy -= r * acy;
  qy += clamp(-qy, 0, r * acy);
  return Math.hypot(qx, qy) * (qx < 0 ? -1 : 1);
}

function polygonSampler(p: PolygonParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const n = Math.max(3, Math.min(12, Math.round(p.sides)));
  const m = Math.min(aspect, 1);
  const soft = Math.max(1e-4, p.softness);
  // the polygon scales down as softness grows so the soft edge fits inside the light
  const size = Math.max(0.05, 1 - p.softness * 0.5);
  const an = Math.PI / n;
  const apothem = size * Math.cos(an);
  const rr = clamp(p.radius) * apothem;
  const rc = Math.max(1e-4, (apothem - rr) / Math.cos(an));
  return (x, y, o) => {
    const px = (x * aspect) / m, py = y / m;
    const d = sdRegularPolygon(px, py, rc, n) - rr;
    o[0] = c[0] * p.intensity; o[1] = c[1] * p.intensity; o[2] = c[2] * p.intensity;
    const t = clamp((soft * 0.5 * size - d) / (soft * size + 1e-4));
    o[3] = t * t * (3 - 2 * t);
  };
}

function bilinear(img: AppearanceImage, u: number, v: number, out: Float64Array): void {
  const w = img.width, h = img.height;
  const fx = u * w - 0.5, fy = v * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const cl = (a: number, n: number) => (a < 0 ? 0 : a >= n ? n - 1 : a);
  const i00 = (cl(y0, h) * w + cl(x0, w)) * 4, i10 = (cl(y0, h) * w + cl(x0 + 1, w)) * 4;
  const i01 = (cl(y0 + 1, h) * w + cl(x0, w)) * 4, i11 = (cl(y0 + 1, h) * w + cl(x0 + 1, w)) * 4;
  const d = img.data;
  for (let k = 0; k < 4; k++) {
    out[k] = lerp(lerp(d[i00 + k], d[i10 + k], tx), lerp(d[i01 + k], d[i11 + k], tx), ty);
  }
}

function imageSampler(p: ImageParams, aspect: number, ctx: EvalContext): Sampler {
  const img = p.imageId ? ctx.images.get(p.imageId) : undefined;
  const c = hexToLinear(p.color);
  const gain = Math.pow(2, p.exposure);
  if (!img) return (_x, _y, o) => { o[0] = o[1] = o[2] = o[3] = 0; };
  const cr = sortStops(p.colorRamp);
  const gam = p.gamma !== 1 ? 1 / Math.max(0.05, p.gamma) : 1;
  const m = Math.min(aspect, 1);
  const tmp = new Float64Array(4);
  const rgb: RGB = [1, 1, 1];
  // "Color transform" reverses the encoding of LDR images. Off = use the stored values as they are.
  const rawLdr = img.ldr && !p.colorTransform;
  return (x, y, o) => {
    // The image always stretches over the light (use Restore aspect to match its proportions).
    let u = x * 0.5 + 0.5;
    if (p.flip) u = 1 - u;
    const v = 1 - (y * 0.5 + 0.5);
    if (p.half && y < 0) { o[0] = o[1] = o[2] = o[3] = 0; return; }
    bilinear(img, u, v, tmp);
    let r = tmp[0], g = tmp[1], b = tmp[2], a = tmp[3];
    if (rawLdr) { r = l2s(Math.max(0, r)); g = l2s(Math.max(0, g)); b = l2s(Math.max(0, b)); }
    if (p.unpremultiply && a > 1e-4) { r /= a; g /= a; b /= a; }
    if (p.invertAlpha) a = 1 - a;
    if (gam !== 1) { r = Math.pow(Math.max(0, r), gam); g = Math.pow(Math.max(0, g), gam); b = Math.pow(Math.max(0, b), gam); }
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (p.saturation !== 1) { r = l + (r - l) * p.saturation; g = l + (g - l) * p.saturation; b = l + (b - l) * p.saturation; }
    if (p.colorMode === 'flat') { r = l * c[0]; g = l * c[1]; b = l * c[2]; }
    else if (p.colorMode === 'ramp') {
      const t = p.rampMode === 'radial' ? clamp(Math.hypot((x * aspect) / m, y / m)) : clamp(x * 0.5 + 0.5);
      evalColorRamp(cr, t, rgb);
      r = l * rgb[0]; g = l * rgb[1]; b = l * rgb[2];
    }
    o[0] = r * gain; o[1] = g * gain; o[2] = b * gain; o[3] = clamp(a);
  };
}

// ── Lumi-Curve ──────────────────────────────────────────────────────────────

interface CurveSample { x: number; y: number; t: number }

/** Cubic Bezier through the points using their tangent handles, sampled to a polyline. */
export function sampleCurve(p: LumiCurveParams): CurveSample[] {
  const pts = p.points;
  const n = pts.length;
  if (n < 2) return [];
  const segs = p.closed ? n : n - 1;
  const out: CurveSample[] = [];
  const per = 28;
  for (let s = 0; s < segs; s++) {
    const a = pts[s], b = pts[(s + 1) % n];
    const p0x = a.x, p0y = a.y;
    const p1x = a.x + a.outX, p1y = a.y + a.outY;
    const p2x = b.x + b.inX, p2y = b.y + b.inY;
    const p3x = b.x, p3y = b.y;
    for (let k = 0; k < per; k++) {
      const u = k / per, v = 1 - u;
      const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      out.push({ x: b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x, y: b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y, t: (s + u) / segs });
    }
  }
  const last = p.closed ? pts[0] : pts[n - 1];
  out.push({ x: last.x, y: last.y, t: 1 });
  return out;
}

/** Tangent handles that make a smooth curve: 1/3 of the distance to each neighbour. */
export function smoothTangents(pts: { x: number; y: number }[], closed: boolean): CurvePoint[] {
  const n = pts.length;
  return pts.map((q, i) => {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;
    const dNext = Math.hypot(next.x - q.x, next.y - q.y), dPrev = Math.hypot(q.x - prev.x, q.y - prev.y);
    const ux = dx / l, uy = dy / l;
    return { x: q.x, y: q.y, outX: ux * dNext / 3, outY: uy * dNext / 3, inX: -ux * dPrev / 3, inY: -uy * dPrev / 3 };
  });
}

/** This point's own falloff direction: an explicit Freeform Offset override if
 *  set, else the auto default (perpendicular to the point's local tangent,
 *  same convention as every other offset direction in this file: rotate the
 *  forward tangent -90deg to get the "outward" normal). */
export function pointOffsetDir(q: CurvePoint): { ux: number; uy: number } {
  if (q.offsetDirX !== undefined && q.offsetDirY !== undefined) {
    const l = Math.hypot(q.offsetDirX, q.offsetDirY) || 1;
    return { ux: q.offsetDirX / l, uy: q.offsetDirY / l };
  }
  let tx = q.outX - q.inX, ty = q.outY - q.inY;
  const l = Math.hypot(tx, ty);
  if (l > 1e-6) { tx /= l; ty /= l; } else { tx = 1; ty = 0; }
  return { ux: -ty, uy: tx };
}

function lumiCurveSampler(p: LumiCurveParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const poly = sampleCurve(p).map((q) => ({ x: q.x * aspect, y: q.y, t: q.t }));
  const green = sortStops(p.greenRamp);
  const blue = sortStops(p.symmetrical ? p.greenRamp : p.blueRamp);
  const lengthRamp = sortStops(p.lengthRamp);
  const gOff = Math.max(1e-3, p.greenOffset), bOff = Math.max(1e-3, p.blueOffset);
  const m = Math.min(aspect, 1);
  const rs = clamp(p.roundnessStart, 0, 0.49), re = clamp(p.roundnessEnd, 0, 0.49);
  const sBlend = clamp(p.startBlend, 1, 6), eBlend = clamp(p.endBlend, 1, 6);
  const sAng = p.startAngle * D2R, eAng = p.endAngle * D2R;
  const dirA = (p.offsetAngle * D2R);
  const dux = Math.cos(dirA), duy = Math.sin(dirA);
  const total = poly.length;
  // Freeform Offset: each control point can aim its own falloff direction, so
  // the effective direction varies continuously along the curve instead of
  // being one global constant (vertical/horizontal/angle) or the pure local
  // normal (normal). Precomputed once per sampler build, not per pixel.
  let freeformDirs: { ux: number; uy: number }[] | null = null;
  if (p.offsetType === 'freeform' && p.points.length >= 2) {
    const n = p.points.length;
    const segs = p.closed ? n : n - 1;
    const dirs = p.points.map(pointOffsetDir);
    freeformDirs = poly.map((q) => {
      const raw = clamp(q.t) * segs;
      const s0 = Math.max(0, Math.min(segs - 1, Math.floor(raw)));
      const frac = clamp(raw - s0);
      const d0 = dirs[s0 % n], d1 = dirs[(s0 + 1) % n];
      let ux = d0.ux + (d1.ux - d0.ux) * frac;
      let uy = d0.uy + (d1.uy - d0.uy) * frac;
      const l = Math.hypot(ux, uy) || 1;
      return { ux: ux / l, uy: uy / l };
    });
  }
  return (x, y, o) => {
    const px = x * aspect, py = y;
    let best = Infinity, bt = 0, side = 1, bTx = 1, bTy = 0, atStart = false, atEnd = false, along = 0;
    for (let i = 0; i + 1 < total; i++) {
      const a = poly[i], b = poly[i + 1];
      const vx = b.x - a.x, vy = b.y - a.y;
      const l2 = vx * vx + vy * vy;
      if (l2 < 1e-12) continue;
      const uRaw = ((px - a.x) * vx + (py - a.y) * vy) / l2;
      const u = clamp(uRaw);
      const cx = a.x + vx * u, cy = a.y + vy * u;
      let dx = px - cx, dy = py - cy;
      let d2: number;
      if (p.offsetType === 'vertical' || p.offsetType === 'horizontal' || p.offsetType === 'angle' || p.offsetType === 'freeform') {
        // distance measured along a fixed (or, for freeform, per-point-interpolated) direction instead of along the curve normal
        const ux = p.offsetType === 'vertical' ? 0 : p.offsetType === 'horizontal' ? 1 : p.offsetType === 'angle' ? dux : freeformDirs![i].ux;
        const uy = p.offsetType === 'vertical' ? 1 : p.offsetType === 'horizontal' ? 0 : p.offsetType === 'angle' ? duy : freeformDirs![i].uy;
        const denom = vx * uy - vy * ux;
        if (Math.abs(denom) < 1e-9) { d2 = dx * dx + dy * dy; }
        else {
          // intersect the line through the pixel along (ux,uy) with this segment
          const s = -((a.x - px) * uy - (a.y - py) * ux) / denom;
          if (s < 0 || s > 1) { d2 = Infinity; }
          else {
            const ix = a.x + vx * s, iy = a.y + vy * s;
            dx = px - ix; dy = py - iy;
            d2 = dx * dx + dy * dy;
          }
        }
      } else d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bt = lerp(a.t, b.t, u);
        const l = Math.sqrt(l2);
        bTx = vx / l; bTy = vy / l;
        side = bTx * dy - bTy * dx >= 0 ? 1 : -1;
        atStart = i === 0 && uRaw < 0;
        atEnd = i + 2 >= total && uRaw > 1;
        along = uRaw < 0 ? -uRaw * l : uRaw > 1 ? (uRaw - 1) * l : 0;
      }
    }
    if (!isFinite(best)) { o[0] = o[1] = o[2] = o[3] = 0; return; }
    const d = Math.sqrt(best);
    const off = (side > 0 ? gOff : bOff) * m;
    const u01 = d / off;
    if (u01 >= 1) { o[0] = o[1] = o[2] = o[3] = 0; return; }
    let v = evalRamp(side > 0 ? green : blue, u01);
    v *= evalRamp(lengthRamp, bt);
    // End caps: roundness sets how far past the end the light reaches; blend sets how sharply it drops
    if (!p.closed && (atStart || atEnd)) {
      const r = atStart ? rs : re;
      const blend = atStart ? sBlend : eBlend;
      const ang = atStart ? sAng : eAng;
      const capLen = r * 2 * off;
      const beyond = along * Math.cos(ang) + d * Math.sin(ang) * 0;
      const f = capLen > 1e-6 ? clamp(1 - beyond / capLen) : 0;
      v *= Math.pow(f, blend);
    }
    o[0] = c[0] * p.intensity * v; o[1] = c[1] * p.intensity * v; o[2] = c[2] * p.intensity * v;
    o[3] = clamp(v);
  };
}

// ── Scrim ───────────────────────────────────────────────────────────────────

function scrimSampler(p: ScrimParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const fall = sortStops(p.falloff);
  const zoom = Math.max(0.05, p.zoom);
  const h = Math.max(0.05, p.height);
  // light frame: aim from the light position toward the handle point on the scrim
  const lp = { x: p.posX, y: p.posY, z: h };
  const aimX = p.handleX - p.posX, aimY = p.handleY - p.posY;
  let ax = aimX, ay = aimY, az = -h;
  // tilt leans the light further along its rotation direction
  const tilt = p.tilt * D2R, rot = p.rotation * D2R;
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; ay /= al; az /= al;
  const lean = Math.sin(tilt);
  ax += Math.cos(rot) * lean; ay += Math.sin(rot) * lean; az = -Math.sqrt(Math.max(0.01, 1 - ax * ax - ay * ay));
  const nl = Math.hypot(ax, ay, az) || 1;
  const nx = ax / nl, ny = ay / nl, nz = az / nl; // light emission direction
  // spread: half-angle of the emission cone -> cosine exponent
  const halfSpread = clamp(p.spread, 5, 180) * 0.5 * D2R;
  const k = Math.max(0.05, Math.log(0.5) / Math.log(Math.max(0.05, Math.cos(Math.min(halfSpread, 1.5)))));
  // tangent frame of the emitter (u along rotation, v perpendicular)
  let ux = Math.cos(rot), uy = Math.sin(rot), uz = 0;
  const dotUN = ux * nx + uy * ny + uz * nz;
  ux -= dotUN * nx; uy -= dotUN * ny; uz -= dotUN * nz;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const vx2 = ny * uz - nz * uy, vy2 = nz * ux - nx * uz, vz2 = nx * uy - ny * ux;
  // sample points across the polygon light
  const samples: { x: number; y: number; z: number; w: number }[] = [];
  if (p.kind === 'polygon') {
    const n = Math.max(3, Math.min(25, Math.round(p.sides)));
    const G = 7;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const su = ((i + 0.5) / G) * 2 - 1, sv = ((j + 0.5) / G) * 2 - 1;
      // inside test of the regular polygon inscribed in the unit circle
      if (n > 4 ? sdRegularPolygon(su, sv, 1, n) > 0 : false) continue;
      const a = su * p.width * 0.5, b = sv * p.depth * 0.5;
      samples.push({ x: lp.x + ux * a + vx2 * b, y: lp.y + uy * a + vy2 * b, z: lp.z + uz * a + vz2 * b, w: 1 });
    }
  } else samples.push({ x: lp.x, y: lp.y, z: lp.z, w: 1 });
  const wSum = samples.length || 1;
  const fade = Math.max(0, p.surfaceFade);
  return (x, y, o) => {
    // scrim surface point (front view), scaled by zoom
    const sx = x / zoom, sy = y / zoom;
    let e = 0;
    for (const s of samples) {
      const dx = sx - s.x, dy = sy - s.y, dz = -s.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      const r = Math.sqrt(r2);
      const cosL = (dx * nx + dy * ny + dz * nz) / r;
      if (cosL <= 0) continue;
      const cosS = -dz / r;
      let wgt = Math.pow(cosL, k) * cosS / r2;
      if (p.kind === 'spot') {
        const ang = Math.acos(clamp(cosL, 0, 1));
        wgt *= evalRamp(fall, clamp(ang / halfSpread));
      }
      if (fade > 0) wgt *= smoothstep(0, fade, s.z);
      e += wgt;
    }
    e = (e / wSum) * h * h; // normalised so the brightness does not depend on the height
    const v = e * p.intensity;
    o[0] = c[0] * v; o[1] = c[1] * v; o[2] = c[2] * v; o[3] = 1;
  };
}

// ── Sky ─────────────────────────────────────────────────────────────────────

function skySampler(p: SkyParams, aspect: number): Sampler {
  const st = skyState(Math.max(1.7, p.turbidity), p.altitude);
  const sunAlt = p.altitude * D2R, sunAz = p.azimuth * D2R;
  const sd: [number, number, number] = [Math.cos(sunAlt) * Math.sin(sunAz), Math.sin(sunAlt), Math.cos(sunAlt) * Math.cos(sunAz)];
  const skyAlpha = sortStops(p.skyAlpha);
  const discFall = sortStops(p.discFalloff);
  // texture space: x = azimuth -180..180, y = altitude 0..90 (bottom = horizon)
  const pixAng = (2 * Math.PI) / 192; // rough angular size of a texel so the disc never vanishes
  const R = Math.max(SUN_RADIUS * Math.max(0.05, p.discSize), pixAng * 0.6);
  // energy at the real size is kept for any size (bigger disc = dimmer)
  const peak = (60000 * (SUN_RADIUS * SUN_RADIUS)) / (R * R) * Math.max(0, p.energyBoost);
  const rgb: RGB = [0, 0, 0];
  const albedoLift = 1 + p.albedo * 0.35;
  void aspect;
  return (x, y, o) => {
    const az = x * Math.PI;
    const alt = clamp((y + 1) * 0.5, 0, 1) * (Math.PI / 2);
    const vd: [number, number, number] = [Math.cos(alt) * Math.sin(az), Math.sin(alt), Math.cos(alt) * Math.cos(az)];
    const cosG = clamp(vd[0] * sd[0] + vd[1] * sd[1] + vd[2] * sd[2], -1, 1);
    const gamma = Math.acos(cosG);
    let r = 0, g = 0, b = 0;
    if (p.skyVisible) {
      skyRadiance(st, Math.PI / 2 - alt, gamma, rgb);
      // ground bounce brightens the low sky
      const lift = lerp(albedoLift, 1, clamp(alt / (Math.PI / 2)));
      r = rgb[0] * lift; g = rgb[1] * lift; b = rgb[2] * lift;
    }
    if (p.discVisible && gamma < R * 1.6) {
      const t = clamp(gamma / R);
      const f = evalRamp(discFall, t) * (gamma <= R ? 1 : Math.max(0, 1 - (gamma - R) / (R * 0.6)));
      r += peak * f * 1.0; g += peak * f * 0.94; b += peak * f * 0.85;
    }
    const a = p.skyVisible ? evalRamp(skyAlpha, clamp((y + 1) * 0.5)) : p.discVisible && gamma < R * 1.6 ? 1 : 0;
    o[0] = r; o[1] = g; o[2] = b; o[3] = clamp(a);
  };
}

/** Builds the sampler for a layer including its transform + invert. */
export function makeLayerSampler(layer: ContentLayer, aspect: number, ctx: EvalContext): Sampler {
  const c = layer.content;
  let base: Sampler;
  switch (c.type) {
    case 'flat': base = flatSampler(c.p); break;
    case 'bulb': base = bulbSampler(c.p, aspect); break;
    case 'gradient': base = gradientSampler(c.p, aspect); break;
    case 'boxgrad': base = boxGradSampler(c.p); break;
    case 'polygon': base = polygonSampler(c.p, aspect); break;
    case 'image': base = imageSampler(c.p, aspect, ctx); break;
    case 'lumicurve': base = lumiCurveSampler(c.p, aspect); break;
    case 'scrim': base = scrimSampler(c.p, aspect); break;
    case 'sky': base = skySampler(c.p, aspect); break;
  }
  const t: ContentTransform = layer.transform;
  const identity = t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0 && t.offsetX === 0 && t.offsetY === 0 && !t.flipX && !t.flipY;
  if (identity) return base;
  const rot = -t.rotation * D2R;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const isx = 1 / (Math.abs(t.scaleX) < 1e-4 ? 1e-4 : t.scaleX);
  const isy = 1 / (Math.abs(t.scaleY) < 1e-4 ? 1e-4 : t.scaleY);
  return (x, y, o) => {
    let X = (x - t.offsetX) * aspect;
    let Y = y - t.offsetY;
    const rx = X * cs - Y * sn;
    const ry = X * sn + Y * cs;
    X = rx * isx; Y = ry * isy;
    if (t.flipX) X = -X;
    if (t.flipY) Y = -Y;
    base(X / aspect, Y, o);
  };
}

// ── blending ────────────────────────────────────────────────────────────────

function blendChannel(mode: AppearanceBlend, b: number, t: number): number {
  switch (mode) {
    case 'multiply': return b * t;
    case 'add': return b + t;
    case 'subtract': return Math.max(0, b - t);
    case 'screen': {
      const bc = Math.min(b, 1), tc = Math.min(t, 1);
      return bc + tc - bc * tc + Math.max(b - 1, 0) + Math.max(t - 1, 0);
    }
    case 'overlay': {
      const bc = Math.min(b, 1), tc = Math.min(t, 1);
      const v = bc < 0.5 ? 2 * bc * tc : 1 - 2 * (1 - bc) * (1 - tc);
      return v + Math.max(b - 1, 0);
    }
    case 'min': return Math.min(b, t);
    case 'max': return Math.max(b, t);
    case 'difference': return Math.abs(b - t);
    case 'divide': return b / Math.max(t, 1e-4);
    default: return t;
  }
}
export const blendValue = blendChannel;

// ── colour grading ──────────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  const d = mx - mn;
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Applies the global grade to one linear RGB triple in place. */
export function gradeRGB(rgb: RGB, g: AppearanceGlobals, tint: RGB, gain: number): void {
  let r = rgb[0] * gain * tint[0], gg = rgb[1] * gain * tint[1], b = rgb[2] * gain * tint[2];
  if (g.hue !== 0 || g.saturation !== 0) {
    // Hue / saturation on a bounded copy (keeps HDR magnitude via the luminance ratio).
    const mx = Math.max(r, gg, b, 1e-9);
    const sc = Math.max(1, mx);
    let [h, s, l] = rgbToHsl(r / sc, gg / sc, b / sc);
    h = (h + g.hue / 360 + 1) % 1;
    s = clamp(s * (1 + g.saturation / 100));
    if (s < 1e-9) { r = gg = b = l * sc; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3) * sc;
      gg = hue2rgb(p, q, h) * sc;
      b = hue2rgb(p, q, h - 1 / 3) * sc;
    }
  }
  if (g.contrast !== 0) {
    const e = Math.max(0.05, 1 + g.contrast / 100);
    const pivot = 0.18;
    r = Math.pow(Math.max(r, 0) / pivot, e) * pivot;
    gg = Math.pow(Math.max(gg, 0) / pivot, e) * pivot;
    b = Math.pow(Math.max(b, 0) / pivot, e) * pivot;
  }
  if (g.gamma !== 1) {
    const ig = 1 / Math.max(0.05, g.gamma);
    r = Math.pow(Math.max(r, 0), ig);
    gg = Math.pow(Math.max(gg, 0), ig);
    b = Math.pow(Math.max(b, 0), ig);
  }
  rgb[0] = r; rgb[1] = gg; rgb[2] = b;
}

// ── main entry ──────────────────────────────────────────────────────────────

/**
 * Renders the appearance to a Float32Array RGBA (linear, un-premultiplied),
 * row 0 = top of the light. `aspect` = width/height of the light.
 */
export function renderAppearance(app: LightAppearance, W: number, H: number, aspect: number, ctx: EvalContext): Float32Array {
  const out = new Float32Array(W * H * 4);
  const ar = aspect > 0 ? aspect : 1;
  const master = makeLayerSampler(app.master, ar, ctx);
  const vbs = app.valueBlend.filter((l) => l.enabled).map((l) => ({ l, s: makeLayerSampler(l, ar, ctx) }));
  const ams = app.alphaMultiply.filter((l) => l.enabled).map((l) => ({ l, s: makeLayerSampler(l, ar, ctx) }));
  const g = app.global;
  const gain = Math.pow(2, g.brightness);
  const tint = hexToLinear(g.tint);
  const opacity = clamp(g.opacity / 100, 0, 2);
  const o = new Float64Array(4);
  const rgb: RGB = [0, 0, 0];
  const masterOn = app.master.enabled;
  const invScale = 1 / Math.max(0.05, g.scale ?? 1);

  for (let py = 0; py < H; py++) {
    let v = 1 - ((py + 0.5) / H) * 2;
    if (g.flipY) v = -v;
    v *= invScale;
    for (let px = 0; px < W; px++) {
      let u = ((px + 0.5) / W) * 2 - 1;
      if (g.flipX) u = -u;
      u *= invScale;
      let r = 0, gr = 0, b = 0, a = 0;
      if (masterOn) {
        master(u, v, o);
        r = o[0]; gr = o[1]; b = o[2]; a = o[3];
        if (app.master.invert) a = 1 - a;
      }
      for (let i = 0; i < vbs.length; i++) {
        const { l, s } = vbs[i];
        s(u, v, o);
        const w = clamp(l.amount / 100, 0, 1) * (l.invert ? 1 - o[3] : o[3]);
        if (w <= 0) continue;
        r = lerp(r, blendChannel(l.blend, r, o[0]), w);
        gr = lerp(gr, blendChannel(l.blend, gr, o[1]), w);
        b = lerp(b, blendChannel(l.blend, b, o[2]), w);
      }
      for (let i = 0; i < ams.length; i++) {
        const { l, s } = ams[i];
        s(u, v, o);
        // For an alpha layer the mask is its shape coverage (times its own luminance for images)
        let mask = o[3];
        if (l.content.type === 'image') {
          mask *= clamp(0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2]);
        }
        if (l.invert) mask = 1 - mask;
        const amt = clamp(l.amount / 100, 0, 1);
        const m = lerp(1, mask, amt);
        a = l.blend === 'add' ? clamp(a + mask * amt) : a * m;
      }
      rgb[0] = r; rgb[1] = gr; rgb[2] = b;
      gradeRGB(rgb, g, tint, gain);
      const idx = (py * W + px) * 4;
      out[idx] = rgb[0];
      out[idx + 1] = rgb[1];
      out[idx + 2] = rgb[2];
      out[idx + 3] = clamp(a * opacity, 0, 1);
    }
  }
  if (app.filters?.some((f) => f.enabled)) {
    return applyFilters({ data: out, width: W, height: H }, app.filters, false, (id) => ctx.images.get(id));
  }
  return out;
}

/** Mean premultiplied radiance of an RGBA image - drives area-light intensity/colour. */
export function averageRadiance(data: Float32Array): { r: number; g: number; b: number; coverage: number } {
  let r = 0, g = 0, b = 0, a = 0;
  const n = data.length / 4;
  for (let i = 0; i < n; i++) {
    const al = data[i * 4 + 3];
    r += data[i * 4] * al;
    g += data[i * 4 + 1] * al;
    b += data[i * 4 + 2] * al;
    a += al;
  }
  return { r: r / n, g: g / n, b: b / n, coverage: a / n };
}
