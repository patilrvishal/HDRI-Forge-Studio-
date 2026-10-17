import * as THREE from 'three';
import type { HDRIShape, HDRIShapeBlendMode, HDRIShapeType } from '../types/HDRIShape';
import type { EnvLayer, GradientBackgroundConfig } from './HDRIExporter';
import { paintGradientOntoContext } from './HDRIExporter';

/** The subset of HDRIShape fields the low-level rasterizer actually needs -
 *  used for both a real shape and its synthesized drop-shadow patch. */
interface Patch {
  type: HDRIShapeType;
  color: string;
  blendMode?: HDRIShapeBlendMode;
  opacity: number;
  u: number;
  v: number;
  width: number;
  height: number;
  rotation: number;
  softness: number;
}

/**
 * Photoshop blend mode formulas, applied per-channel on 0-1 normalized
 * src (this shape's color) and dst (whatever's already painted beneath it).
 * The result still gets mixed with dst by the pixel's own coverage alpha
 * afterward, same as any blend mode in Photoshop respects layer opacity.
 */
function blendChannel(mode: HDRIShapeBlendMode, src: number, dst: number): number {
  const EPS = 1e-4;
  switch (mode) {
    case 'darken': return Math.min(src, dst);
    case 'multiply': return src * dst;
    case 'color-burn': return src <= EPS ? 0 : 1 - Math.min(1, (1 - dst) / src);
    case 'lighten': return Math.max(src, dst);
    case 'screen': return 1 - (1 - src) * (1 - dst);
    case 'color-dodge': return src >= 1 - EPS ? 1 : Math.min(1, dst / (1 - src));
    case 'linear-dodge': return Math.min(1, src + dst);
    case 'overlay': return dst <= 0.5 ? 2 * src * dst : 1 - 2 * (1 - src) * (1 - dst);
    case 'hard-light': return src <= 0.5 ? 2 * src * dst : 1 - 2 * (1 - src) * (1 - dst);
    case 'soft-light': {
      if (src <= 0.5) return dst - (1 - 2 * src) * dst * (1 - dst);
      const d = dst <= 0.25 ? ((16 * dst - 12) * dst + 4) * dst : Math.sqrt(dst);
      return dst + (2 * src - 1) * (d - dst);
    }
    case 'difference': return Math.abs(src - dst);
    case 'exclusion': return src + dst - 2 * src * dst;
    case 'subtract': return Math.max(0, dst - src);
    case 'normal':
    default:
      return src;
  }
}

/** The shape layer is rasterised at the OUTPUT resolution (clamped here), not a fixed size. A fixed 1024x512
 *  layer sampled up to 2K/4K/8K turned every shape pixel into a visible block, so exporting at a higher
 *  resolution never made the edges any cleaner. 4096 wide keeps the 8-bit canvas around 33 MB. */
const LAYER_MIN_W = 1024;
const LAYER_MAX_W = 4096;
export function shapesLayerWidth(targetW?: number): number {
  const w = Math.max(LAYER_MIN_W, Math.min(LAYER_MAX_W, Math.round(targetW || LAYER_MIN_W)));
  return w - (w % 2);
}
/** Every edge is at least this many output pixels wide, however hard the shape is set. A hard edge sampled at a low
 *  resolution (1K, or magnified in a glass reflection) shows as a staircase; a few pixels of ramp turns that into a
 *  soft edge that sharpens by itself as the resolution goes up (0.9 deg at 1K, 0.2 deg at 4K, 0.1 deg at 8K). */
export const EDGE_MIN_PX = 2.5;
/** Anti-aliased band starts this far inside the edge; only pixels past it pay for the footprint estimate. */
const AA_NEAR = 0.6;
/** Pixels further outside the edge than this cannot receive any coverage. */
const AA_REJECT = 1.25;

/** #rrggbb -> [r,g,b] 0-255. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Pixel (px,py) -> world direction, using the SAME equirectangular
 * convention as HDRIExporter's pixelToDirection/sampleEnvTexture (phi = v*PI
 * measured from the top/north pole, theta = (u-0.5)*2PI). Every direction
 * used anywhere in the shapes pipeline goes through this one convention so
 * the flat HDRI Preview render and the shape's own placement always agree.
 */
function directionAt(px: number, py: number, w: number, h: number): [number, number, number] {
  const u = (px + 0.5) / w;
  const v = (py + 0.5) / h;
  const phi = v * Math.PI;
  const theta = (u - 0.5) * 2 * Math.PI;
  const sinPhi = Math.sin(phi);
  return [sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta)];
}

/**
 * Paint every visible shape directly into a raw RGBA buffer using true
 * spherical geometry, instead of drawing flat 2D primitives onto the
 * equirect canvas. A shape is defined as a small flat patch tangent to the
 * sphere at its (u,v) center - exactly like a real HDRI light card - and
 * every affected pixel is tested by projecting its direction into that
 * patch's local tangent plane (gnomonic projection). This is what makes a
 * shape's outline genuinely follow the equirectangular distortion: near the
 * equator it reads as a normal rectangle/circle, and the closer it sits to
 * a pole the more its footprint curves and spreads around the band, because
 * that is what a fixed-size flat patch actually looks like once unwrapped
 * onto a lat/long map. Wrapping at the u=0/u=1 seam falls out for free since
 * every test works in 3D direction space, not canvas pixel space.
 */
function paintPatch(data: Uint8ClampedArray, shape: Patch, w: number, h: number): void {
  const [r, g, b] = hexToRgb(shape.color);
  const baseAlpha = Math.max(0, Math.min(1, shape.opacity / 100));
  if (baseAlpha <= 0) return;
  const feather = Math.max(0, Math.min(1, shape.softness / 100));

  // Center direction C, from the same u/v -> direction convention as above.
  const [cx, cy, cz] = directionAt(shape.u * w - 0.5, shape.v * h - 0.5, w, h);

  // Tangent-plane basis at C: right = worldUp x C, up = C x right. Falls
  // back to a fixed right vector at the poles, where worldUp x C -> 0.
  let rx = cz, ry = 0, rz = -cx;
  const rLen = Math.hypot(rx, rz);
  if (rLen < 1e-6) {
    rx = 1; ry = 0; rz = 0;
  } else {
    rx /= rLen; rz /= rLen;
  }
  let ux = cy * rz - cz * ry;
  let uy = cz * rx - cx * rz;
  let uz = cx * ry - cy * rx;

  // Rotation spins the patch's own local basis around C, so "Rotation"
  // still means something sensible at any latitude, not just at the equator.
  if (shape.type !== 'circle' && shape.rotation !== 0) {
    const a = (shape.rotation * Math.PI) / 180;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const nrx = rx * cosA + ux * sinA;
    const nry = ry * cosA + uy * sinA;
    const nrz = rz * cosA + uz * sinA;
    const nux = -rx * sinA + ux * cosA;
    const nuy = -ry * sinA + uy * cosA;
    const nuz = -rz * sinA + uz * cosA;
    rx = nrx; ry = nry; rz = nrz;
    ux = nux; uy = nuy; uz = nuz;
  }

  // width/height are fractions of the full map (2PI wide, PI tall) - convert
  // to angular half-extents in radians so the patch has a genuine fixed
  // angular size on the sphere, the same way a real light's physical size
  // does, rather than a fixed pixel size that would ignore the projection.
  const halfW = Math.max(0.005, shape.width) * Math.PI;
  const halfH = Math.max(0.005, shape.height) * (Math.PI / 2);
  const isStrip = shape.type === 'gradient-strip';
  const isCircle = shape.type === 'circle';
  const circleRadius = (halfW + halfH) / 2;

  const tanHalfW = Math.tan(Math.min(halfW, 1.55));
  const tanHalfH = Math.tan(Math.min(halfH, 1.55));
  const tanRadius = Math.tan(Math.min(circleRadius, 1.55));

  // Bound the scan to rows the patch can plausibly reach, then sweep the
  // full width within those rows - direction-space testing already handles
  // wraparound and pole spread correctly, this bound just skips rows that
  // are provably too far from the patch to matter.
  const centerPhi = Math.acos(Math.max(-1, Math.min(1, cy)));
  const marginRad = Math.min(Math.PI, Math.max(halfW, halfH) * 1.4 + 0.12);
  const phiMin = Math.max(0, centerPhi - marginRad);
  const phiMax = Math.min(Math.PI, centerPhi + marginRad);
  const rowStart = Math.max(0, Math.floor((phiMin / Math.PI) * h) - 1);
  const rowEnd = Math.min(h - 1, Math.ceil((phiMax / Math.PI) * h) + 1);

  // Edge metric at any direction: 1.0 is the shape's true boundary, < 1 inside. Used both for the pixel itself and
  // for its neighbours, so the anti-aliasing width is the real per-pixel change of this metric at this spot
  // (the same idea as fwidth() in a shader) and automatically follows the projection and the output resolution.
  const edgeAt = (dx: number, dy: number, dz: number): number => {
    const c = dx * cx + dy * cy + dz * cz;
    if (c <= 0.02) return Infinity;
    const lx = (dx * rx + dy * ry + dz * rz) / c;
    const ly = (dx * ux + dy * uy + dz * uz) / c;
    if (isCircle) return Math.hypot(lx, ly) / tanRadius;
    if (isStrip) return Math.abs(ly) / tanHalfH;
    return Math.max(Math.abs(lx) / tanHalfW, Math.abs(ly) / tanHalfH);
  };

  for (let py = rowStart; py <= rowEnd; py++) {
    for (let px = 0; px < w; px++) {
      const [dx, dy, dz] = directionAt(px, py, w, h);
      const cosc = dx * cx + dy * cy + dz * cz;
      if (cosc <= 0.02) continue; // behind the patch's own hemisphere

      const edge = edgeAt(dx, dy, dz);
      if (edge > AA_REJECT) continue;

      // Width of one pixel in edge units. Hard edges (softness ~0) used to skip this and became a 1-bit mask,
      // which is the staircase seen in reflections; now they always get a ~1 pixel anti-aliased transition
      // centred on the true boundary, while a larger Softness still dominates and gives a real feather.
      let aa = 0;
      if (edge > AA_NEAR) {
        const [ax, ay, az] = directionAt(px + 1, py, w, h);
        const [bx, by, bz] = directionAt(px, py + 1, w, h);
        const ex = edgeAt(ax, ay, az);
        const ey = edgeAt(bx, by, bz);
        aa = Math.max(Number.isFinite(ex) ? Math.abs(ex - edge) : 0, Number.isFinite(ey) ? Math.abs(ey - edge) : 0);
      }
      const half = aa * EDGE_MIN_PX * 0.5;
      const coverage = 1 - smoothstep(1 - Math.max(feather, half), 1 + half, edge);

      const a = baseAlpha * coverage;
      if (a <= 0) continue;
      const idx = (py * w + px) * 4;
      const mode = shape.blendMode ?? 'normal';
      if (mode === 'normal') {
        data[idx] = r * a + data[idx] * (1 - a);
        data[idx + 1] = g * a + data[idx + 1] * (1 - a);
        data[idx + 2] = b * a + data[idx + 2] * (1 - a);
      } else {
        const blendedR = blendChannel(mode, r / 255, data[idx] / 255) * 255;
        const blendedG = blendChannel(mode, g / 255, data[idx + 1] / 255) * 255;
        const blendedB = blendChannel(mode, b / 255, data[idx + 2] / 255) * 255;
        data[idx] = blendedR * a + data[idx] * (1 - a);
        data[idx + 1] = blendedG * a + data[idx + 1] * (1 - a);
        data[idx + 2] = blendedB * a + data[idx + 2] * (1 - a);
      }
      data[idx + 3] = 255 * a + data[idx + 3] * (1 - a);
    }
  }
}

/**
 * Paint a shape, plus - if enabled - a Photoshop-style drop shadow just
 * beneath it: a darker copy of the same patch, offset by angle/distance and
 * with its own opacity/softness, painted first so the shape sits on top and
 * the shadow peeks out on the offset side. The offset is computed directly
 * in u/v space (not re-derived via the tangent-plane basis) since it's a
 * small, secondary displacement - the shadow patch itself still gets the
 * full gnomonic treatment via paintPatch, so it curves/spreads correctly
 * wherever it lands.
 *
 * Opacity vs Fill, same distinction Photoshop makes: Opacity scales the
 * WHOLE layer including its drop shadow effect; Fill scales only the
 * shape's own paint, leaving the shadow's own Intensity untouched by it.
 */
function paintShapeIntoBuffer(data: Uint8ClampedArray, shape: HDRIShape, w: number, h: number): void {
  const layerOpacity = Math.max(0, Math.min(100, shape.opacity));
  const shadow = shape.dropShadow;
  if (shadow?.enabled && shadow.intensity > 0) {
    const a = (shadow.angle * Math.PI) / 180;
    const dist = shadow.distance / 100;
    const du = Math.cos(a) * dist * shape.width;
    const dv = Math.sin(a) * dist * shape.height;
    let su = shape.u + du;
    su = ((su % 1) + 1) % 1;
    const sv = Math.max(0, Math.min(1, shape.v + dv));

    paintPatch(
      data,
      {
        type: shape.type,
        color: '#000000',
        opacity: shadow.intensity * (layerOpacity / 100),
        u: su,
        v: sv,
        width: shape.width,
        height: shape.height,
        rotation: shape.rotation,
        softness: shadow.softness,
      },
      w,
      h,
    );
  }

  const fill = Math.max(0, Math.min(100, shape.fill ?? 100));
  paintPatch(
    data,
    {
      type: shape.type,
      color: shape.color,
      blendMode: shape.blendMode,
      opacity: layerOpacity * (fill / 100),
      u: shape.u,
      v: shape.v,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      softness: shape.softness,
    },
    w,
    h,
  );
}

function smoothstep(lo: number, hi: number, x: number): number {
  if (hi <= lo) return x < lo ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Composite the gradient background (if enabled) and every visible HDRI
 * Shape into one flattened equirectangular canvas, in stacking order. This
 * single canvas becomes the ONE env layer used for lighting/reflections and
 * the visible backdrop, so shapes correctly occlude the gradient (and each
 * other) instead of just adding on top of it as a separate layer.
 */
export function compositeShapesCanvas(
  shapes: HDRIShape[],
  gradient: GradientBackgroundConfig | null,
  targetWidth?: number,
): HTMLCanvasElement {
  const LAYER_W = shapesLayerWidth(targetWidth);
  const LAYER_H = LAYER_W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = LAYER_W;
  canvas.height = LAYER_H;
  const ctx = canvas.getContext('2d')!;

  if (gradient) {
    paintGradientOntoContext(ctx, LAYER_W, LAYER_H, gradient);
  } else {
    // No gradient active - neutral dark base so shapes still read clearly
    // as standalone light sources rather than floating on pure black.
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, LAYER_W, LAYER_H);
  }

  const visible = shapes.filter((s) => s.visible);
  if (visible.length > 0) {
    const imageData = ctx.getImageData(0, 0, LAYER_W, LAYER_H);
    for (const shape of visible) {
      paintShapeIntoBuffer(imageData.data, shape, LAYER_W, LAYER_H);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas;
}

export function shapesCanvasToEnvLayer(canvas: HTMLCanvasElement, intensity = 1.0): EnvLayer {
  const ctx = canvas.getContext('2d')!;
  // Path D (raw ImageData) for fast per-pixel sampling - see gradientToEnvLayer.
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas) as unknown as THREE.DataTexture;
  (tex as unknown as { image: ImageData }).image = imageData;
  return { texture: tex, intensity, rotation: 0 };
}
