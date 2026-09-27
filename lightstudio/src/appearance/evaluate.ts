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

/** Piecewise-linear ramp lookup. */
export function evalRamp(stops: RampStop[], t: number): number {
  const n = stops.length;
  if (n === 0) return 1;
  if (n === 1 || t <= stops[0].pos) return stops[0].value;
  if (t >= stops[n - 1].pos) return stops[n - 1].value;
  for (let i = 1; i < n; i++) {
    if (t <= stops[i].pos) {
      const a = stops[i - 1];
      const b = stops[i];
      const u = (t - a.pos) / (b.pos - a.pos || 1e-6);
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
      const u = (t - stops[i - 1].pos) / (stops[i].pos - stops[i - 1].pos || 1e-6);
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

function bulbSampler(p: BulbParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const ramp = sortStops(p.ramp);
  const m = Math.min(aspect, 1);
  const width = Math.max(1e-3, p.width);
  const extent = Math.max(1e-3, p.extent);
  return (x, y, o) => {
    const rr = Math.hypot(x * aspect, y) / m;
    const v = evalRamp(ramp, clamp(rr / width)) * p.intensity;
    o[0] = c[0] * v; o[1] = c[1] * v; o[2] = c[2] * v;
    o[3] = 1 - smoothstep(extent * 0.92, extent, rr);
  };
}

function gradientSampler(p: GradientParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const vr = sortStops(p.valueRamp);
  const ar = sortStops(p.alphaRamp);
  const cr = sortStops(p.colorRamp);
  const ca = Math.cos(p.angle * D2R), sa = Math.sin(p.angle * D2R);
  const m = Math.min(aspect, 1);
  const tmp: RGB = [1, 1, 1];
  return (x, y, o) => {
    let t: number;
    if (p.mode === 'radial') t = clamp(Math.hypot(x * aspect, y) / m);
    else t = clamp((x * ca + y * sa) * 0.5 + 0.5);
    const v = evalRamp(vr, t) * p.intensity;
    if (p.useColorRamp && cr.length) {
      evalColorRamp(cr, t, tmp);
      o[0] = tmp[0] * v; o[1] = tmp[1] * v; o[2] = tmp[2] * v;
    } else {
      o[0] = c[0] * v; o[1] = c[1] * v; o[2] = c[2] * v;
    }
    o[3] = clamp(evalRamp(ar, t));
  };
}

function boxGradSampler(p: BoxGradParams): Sampler {
  const c = hexToLinear(p.color);
  const hr = sortStops(p.hRamp);
  const vr = sortStops(p.vRamp);
  const edge = (d: number, e: { pos: number; soft: number }) => smoothstep(e.pos - e.soft * 0.5, e.pos + e.soft * 0.5 + 1e-4, d);
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

function polygonSampler(p: PolygonParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const n = Math.max(3, Math.round(p.sides));
  const sector = (2 * Math.PI) / n;
  const m = Math.min(aspect, 1);
  const cr = clamp(p.cornerRadius) * p.radius * 0.5;
  const R = Math.max(1e-3, p.radius - cr);
  const cosHalf = Math.cos(sector / 2);
  const soft = Math.max(1e-4, p.softness);
  return (x, y, o) => {
    const px = (x * aspect) / m, py = y / m;
    const len = Math.hypot(px, py);
    let a = Math.atan2(py, px) + Math.PI / 2; // one vertex points up
    a = ((a % sector) + sector) % sector;
    const d = len * Math.cos(a - sector / 2) - R * cosHalf - cr;
    o[0] = c[0] * p.intensity; o[1] = c[1] * p.intensity; o[2] = c[2] * p.intensity;
    const t = clamp((soft * 0.5 - d) / soft);
    o[3] = t * t * (3 - 2 * t);
  };
}

function bilinear(img: AppearanceImage, u: number, v: number, out: Float64Array, wrap: ImageParams['wrap']): void {
  const w = img.width, h = img.height;
  let fx = u * w - 0.5, fy = v * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const idx = (xi: number, yi: number) => {
    if (wrap === 'repeat') {
      xi = ((xi % w) + w) % w; yi = ((yi % h) + h) % h;
    } else if (wrap === 'mirror') {
      const mx = ((xi % (2 * w)) + 2 * w) % (2 * w); xi = mx >= w ? 2 * w - 1 - mx : mx;
      const my = ((yi % (2 * h)) + 2 * h) % (2 * h); yi = my >= h ? 2 * h - 1 - my : my;
    } else {
      xi = xi < 0 ? 0 : xi >= w ? w - 1 : xi; yi = yi < 0 ? 0 : yi >= h ? h - 1 : yi;
    }
    return (yi * w + xi) * 4;
  };
  const i00 = idx(x0, y0), i10 = idx(x0 + 1, y0), i01 = idx(x0, y0 + 1), i11 = idx(x0 + 1, y0 + 1);
  const d = img.data;
  for (let k = 0; k < 4; k++) {
    out[k] = lerp(lerp(d[i00 + k], d[i10 + k], tx), lerp(d[i01 + k], d[i11 + k], tx), ty);
  }
}

function imageSampler(p: ImageParams, aspect: number, ctx: EvalContext): Sampler {
  const img = p.imageId ? ctx.images.get(p.imageId) : undefined;
  const c = hexToLinear(p.color);
  const gain = Math.pow(2, p.exposure);
  if (!img) {
    // Nothing loaded: fully transparent so the layer contributes nothing.
    return (_x, _y, o) => { o[0] = o[1] = o[2] = o[3] = 0; };
  }
  const ia = img.width / img.height;
  let hh = 1;
  if (p.fit === 'fit') hh = Math.min(1, aspect / ia);
  else if (p.fit === 'fill') hh = Math.max(1, aspect / ia);
  else hh = 1;
  const hw = p.fit === 'stretch' ? aspect : hh * ia;
  const tmp = new Float64Array(4);
  return (x, y, o) => {
    const u = (x * aspect) / hw * 0.5 + 0.5;
    const v = 1 - (y / hh * 0.5 + 0.5);
    if (p.wrap === 'clamp' && (u < 0 || u > 1 || v < 0 || v > 1)) {
      o[0] = o[1] = o[2] = o[3] = 0;
      return;
    }
    bilinear(img, u, v, tmp, p.wrap);
    const lum = 0.2126 * tmp[0] + 0.7152 * tmp[1] + 0.0722 * tmp[2];
    switch (p.channel) {
      case 'rgb':
        o[0] = tmp[0] * c[0] * gain; o[1] = tmp[1] * c[1] * gain; o[2] = tmp[2] * c[2] * gain; o[3] = 1;
        break;
      case 'luminance':
        o[0] = lum * c[0] * gain; o[1] = lum * c[1] * gain; o[2] = lum * c[2] * gain; o[3] = 1;
        break;
      case 'alpha':
        o[0] = c[0] * gain; o[1] = c[1] * gain; o[2] = c[2] * gain; o[3] = tmp[3];
        break;
      default:
        o[0] = tmp[0] * c[0] * gain; o[1] = tmp[1] * c[1] * gain; o[2] = tmp[2] * c[2] * gain; o[3] = tmp[3];
    }
  };
}

/** Catmull-Rom spline through the control points, sampled to a polyline. */
export function sampleCurve(p: LumiCurveParams): { x: number; y: number; w: number; t: number }[] {
  const pts = p.points;
  const n = pts.length;
  if (n < 2) return [];
  const out: { x: number; y: number; w: number; t: number }[] = [];
  const segs = p.closed ? n : n - 1;
  const at = (i: number) => (p.closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
  const per = p.smooth ? 24 : 1;
  for (let s = 0; s < segs; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    for (let k = 0; k < per; k++) {
      const u = k / per;
      let x: number, y: number;
      if (p.smooth) {
        const u2 = u * u, u3 = u2 * u;
        const cr = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
        x = cr(p0.x, p1.x, p2.x, p3.x);
        y = cr(p0.y, p1.y, p2.y, p3.y);
      } else {
        x = lerp(p1.x, p2.x, u);
        y = lerp(p1.y, p2.y, u);
      }
      out.push({ x, y, w: lerp(p1.w, p2.w, u), t: (s + u) / segs });
    }
  }
  const last = p.closed ? pts[0] : pts[n - 1];
  out.push({ x: last.x, y: last.y, w: last.w, t: 1 });
  return out;
}

function lumiCurveSampler(p: LumiCurveParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const poly = sampleCurve(p).map((q) => ({ x: q.x * aspect, y: q.y, w: q.w, t: q.t }));
  const ramp = sortStops(p.ramp);
  const m = Math.min(aspect, 1);
  const th = Math.max(1e-3, p.thickness) * m;
  const soft = Math.max(1e-4, p.softness) * th;
  const glow = Math.max(0, p.glow);
  const gf = Math.max(0.05, p.glowFalloff);
  const taperAt = (t: number) => {
    switch (p.taper) {
      case 'ends': return Math.sin(clamp(t) * Math.PI);
      case 'start': return clamp(t);
      case 'end': return 1 - clamp(t);
      default: return 1;
    }
  };
  return (x, y, o) => {
    const px = x * aspect, py = y;
    let best = Infinity, bt = 0, bw = 1;
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i], b = poly[i + 1];
      const vx = b.x - a.x, vy = b.y - a.y;
      const l2 = vx * vx + vy * vy;
      let u = l2 > 1e-12 ? ((px - a.x) * vx + (py - a.y) * vy) / l2 : 0;
      u = clamp(u);
      const dx = px - (a.x + vx * u), dy = py - (a.y + vy * u);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bt = lerp(a.t, b.t, u);
        bw = lerp(a.w, b.w, u);
      }
    }
    if (!isFinite(best)) { o[0] = o[1] = o[2] = o[3] = 0; return; }
    const d = Math.sqrt(best);
    const radius = th * Math.max(0.02, bw * taperAt(bt));
    const core = clamp((radius + soft * 0.5 - d) / soft);
    const coreS = core * core * (3 - 2 * core);
    const glowV = glow > 0 ? glow * Math.exp(-Math.pow(d / (th * 4 * gf), 2)) : 0;
    const k = evalRamp(ramp, bt) * p.intensity;
    const v = coreS + glowV;
    o[0] = c[0] * k * v; o[1] = c[1] * k * v; o[2] = c[2] * k * v;
    o[3] = clamp(coreS + glowV);
  };
}

function scrimSampler(p: ScrimParams, aspect: number): Sampler {
  const c = hexToLinear(p.color);
  const w = Math.max(0.02, p.width), h = Math.max(0.02, p.height);
  const soft = Math.max(1e-3, p.edgeSoftness);
  const lz = Math.max(0.05, p.lightZ);
  const ls2 = p.lightSize * p.lightSize;
  const fall = Math.max(0.1, p.falloff);
  return (x, y, o) => {
    // Scrim panel coordinates
    const sx = x / w, sy = y / h;
    const edgeX = 1 - Math.abs(sx), edgeY = 1 - Math.abs(sy);
    const cov = smoothstep(-soft * 0.25, soft * 0.75 + 1e-4, Math.min(edgeX, edgeY));
    const dx = (x - p.lightX) * aspect, dy = y - p.lightY;
    const d2 = dx * dx + dy * dy + lz * lz + ls2;
    const cosT = lz / Math.sqrt(d2);
    // Inverse-square falloff normalised to 1 directly below the light.
    let I = Math.pow(cosT, fall) * (lz * lz) / d2;
    I = lerp(I, 1, clamp(p.diffusion));
    let frame = 1;
    if (p.frame > 0) {
      const de = Math.min(edgeX, edgeY);
      frame = lerp(0.15, 1, smoothstep(0, p.frame, de));
    }
    const k = I * frame * p.intensity;
    o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k;
    o[3] = cov;
  };
}

function skySampler(p: SkyParams, aspect: number, ctx: EvalContext): Sampler {
  const zen = hexToLinear(p.zenithColor);
  const hor = hexToLinear(p.horizonColor);
  const gnd = hexToLinear(p.groundColor);
  const clouds = p.cloudsImageId ? ctx.images.get(p.cloudsImageId) : undefined;
  const sunX = ((((p.sunAzimuth % 360) + 360) % 360) / 180 - 1);
  const sunY = p.sunElevation >= 0 ? lerp(p.horizon, 1, p.sunElevation / 90) : lerp(p.horizon, -1, -p.sunElevation / 90);
  const sunR = 0.045 * Math.max(0.1, p.sunSize);
  // A bigger sun keeps its total energy: peak scales with 1/size^2
  const sunPeak = p.sunIntensity / Math.max(0.01, p.sunSize * p.sunSize);
  const haze = clamp((p.turbidity - 1) / 9);
  const soft = Math.max(1e-3, p.horizonSoftness);
  const fall = Math.max(0.1, p.falloff);
  const tmp = new Float64Array(4);
  return (x, y, o) => {
    const above = smoothstep(p.horizon - soft * 0.5, p.horizon + soft * 0.5 + 1e-4, y);
    const tUp = clamp((y - p.horizon) / Math.max(1e-3, 1 - p.horizon));
    const skyT = Math.pow(tUp, fall);
    // Turbidity thickens the horizon glow.
    const skyMix = clamp(skyT * (1 - haze * 0.5));
    let r = lerp(hor[0], zen[0], skyMix), g = lerp(hor[1], zen[1], skyMix), b = lerp(hor[2], zen[2], skyMix);
    // Sun
    const dx = (x - sunX) * aspect, dy = y - sunY;
    const d = Math.hypot(dx, dy);
    const disc = 1 - smoothstep(sunR * 0.9, sunR, d);
    const halo = Math.exp(-Math.pow(d / (sunR * (3 + haze * 6)), 2)) * 0.25;
    const sun = (disc + halo) * sunPeak;
    if (sun > 0 && above > 0) { r += sun; g += sun * 0.95; b += sun * 0.85; }
    if (clouds) {
      bilinear(clouds, x * 0.5 + 0.5, 1 - (y * 0.5 + 0.5), tmp, 'repeat');
      const lum = 0.2126 * tmp[0] + 0.7152 * tmp[1] + 0.0722 * tmp[2];
      const k = lerp(1, lum, clamp(p.cloudsAmount));
      r *= k; g *= k; b *= k;
    }
    // below the horizon fade into the ground colour
    const gr = lerp(gnd[0], r, above), gg = lerp(gnd[1], g, above), gb = lerp(gnd[2], b, above);
    o[0] = gr * p.intensity; o[1] = gg * p.intensity; o[2] = gb * p.intensity;
    o[3] = lerp(p.groundAlpha, 1, above);
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
    case 'sky': base = skySampler(c.p, aspect, ctx); break;
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
        if (l.content.type === 'image' && l.content.p.channel !== 'alpha') {
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
