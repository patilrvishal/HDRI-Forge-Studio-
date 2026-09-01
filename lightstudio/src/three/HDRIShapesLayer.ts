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

const LAYER_W = 1024;
const LAYER_H = 512;

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

  const featherLo = isCircle || isStrip ? 1 - feather : 1 - feather;

  for (let py = rowStart; py <= rowEnd; py++) {
    for (let px = 0; px < w; px++) {
      const [dx, dy, dz] = directionAt(px, py, w, h);
      const cosc = dx * cx + dy * cy + dz * cz;
      if (cosc <= 0.02) continue; // behind the patch's own hemisphere

      const lx = (dx * rx + dy * ry + dz * rz) / cosc;
      const ly = (dx * ux + dy * uy + dz * uz) / cosc;

      let coverage: number;
      if (isCircle) {
        const nr = Math.hypot(lx, ly) / tanRadius;
        if (nr > 1) continue;
        coverage = feather < 0.01 ? 1 : 1 - smoothstep(featherLo, 1, nr);
      } else {
        const nx = Math.abs(lx) / tanHalfW;
        const ny = Math.abs(ly) / tanHalfH;
        if (isStrip) {
          // A strip runs the full band horizontally - only the polar (y)
          // extent is bounded/feathered, matching its original "horizontal
          // band" purpose but now correctly curved by the projection.
          if (ny > 1) continue;
          coverage = feather < 0.01 ? 1 : 1 - smoothstep(featherLo, 1, ny);
        } else {
          if (nx > 1 || ny > 1) continue;
          const edge = Math.max(nx, ny); // Chebyshev distance = box falloff
          coverage = feather < 0.01 ? 1 : 1 - smoothstep(featherLo, 1, edge);
        }
      }

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
): HTMLCanvasElement {
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
