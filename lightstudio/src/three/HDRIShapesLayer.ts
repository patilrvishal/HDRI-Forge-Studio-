import * as THREE from 'three';
import type { HDRIShape } from '../types/HDRIShape';
import type { EnvLayer, GradientBackgroundConfig } from './HDRIExporter';
import { paintGradientOntoContext } from './HDRIExporter';

const LAYER_W = 1024;
const LAYER_H = 512;

/** #rrggbb -> [r,g,b] 0-255. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Paint one shape onto the context using standard alpha "source-over"
 * compositing - this is what makes stacking order actually mean something:
 * a shape painted later overwrites whatever pixels it covers, including a
 * pure-black shape fully occluding (blocking) anything beneath it, exactly
 * like a real HDRI blocker/flag.
 */
/**
 * How far a shape's footprint should stretch horizontally at a given row,
 * matching how a real HDRI light patch behaves on an equirectangular map:
 * longitude lines converge at the poles, so a patch of fixed angular size
 * covers proportionally more of the map's width the closer it sits to the
 * top or bottom edge - drag one toward the zenith/nadir and it visibly
 * smears around the band, exactly like moving a real light there would.
 * cy/h is the normalized v (0 = north pole, 1 = south pole); colatitude
 * theta runs 0..PI with sin(theta) = 1 at the equator and -> 0 at the poles.
 */
function poleSpreadFactor(cy: number, h: number): number {
  const theta = (cy / h) * Math.PI;
  const sinTheta = Math.max(Math.sin(theta), 0.12);
  return Math.min(1 / sinTheta, 6);
}

function paintShape(ctx: CanvasRenderingContext2D, shape: HDRIShape, w: number, h: number, cx: number): void {
  const cy = shape.v * h;
  const sw = Math.max(2, shape.width * w);
  const sh = Math.max(2, shape.height * h);
  const [r, g, b] = hexToRgb(shape.color);
  const alpha = Math.max(0, Math.min(1, shape.opacity / 100));
  const feather = Math.max(0, Math.min(1, shape.softness / 100));
  const poleSpread = poleSpreadFactor(cy, h);

  ctx.save();
  ctx.translate(cx, cy);
  // Stretch the whole footprint horizontally BEFORE rotating, so the pole
  // distortion always acts in true world (longitude) space and a rotated
  // rectangle doesn't get sheared by a non-uniform scale applied after.
  ctx.scale(poleSpread, 1);
  if (shape.type !== 'circle') {
    ctx.rotate((shape.rotation * Math.PI) / 180);
  }

  if (shape.type === 'circle') {
    const radius = (sw + sh) / 4;
    const innerStop = Math.max(0, 1 - feather);
    const grad = ctx.createRadialGradient(0, 0, radius * innerStop, 0, 0, radius);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape.type === 'gradient-strip') {
    // A soft horizontal band - full opacity through the center, feathering
    // out top and bottom. Width runs the strip's length, height its thickness.
    const grad = ctx.createLinearGradient(0, -sh / 2, 0, sh / 2);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    grad.addColorStop(Math.min(0.49, feather * 0.5 + 0.02), `rgba(${r}, ${g}, ${b}, ${alpha})`);
    grad.addColorStop(Math.max(0.51, 1 - (feather * 0.5 + 0.02)), `rgba(${r}, ${g}, ${b}, ${alpha})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  } else {
    // Rectangle - feathered edges via a box-shaped radial-ish falloff.
    // Two nested rects: an inner hard-edged core, then a fading border.
    const featherPx = Math.max(1, Math.min(sw, sh) * 0.5 * feather);
    if (featherPx < 1.5) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    } else {
      // Draw the solid core, then stroke a feathered blur-like border using
      // repeated shrinking rects with decreasing alpha - cheap and matches
      // the "soft edge" look without needing filter: blur() (unsupported in
      // headless/older canvas contexts and hard to control precisely).
      const core = { w: Math.max(0, sw - featherPx * 2), h: Math.max(0, sh - featherPx * 2) };
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect(-core.w / 2, -core.h / 2, core.w, core.h);

      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const stepAlpha = alpha * (1 - t) * 0.6;
        const grow = featherPx * (t + 1 / steps);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${stepAlpha})`;
        ctx.fillRect(-core.w / 2 - grow, -core.h / 2 - grow, core.w + grow * 2, core.h + grow * 2);
      }
    }
  }

  ctx.restore();
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

  for (const shape of shapes) {
    if (!shape.visible) continue;
    const cx = shape.u * LAYER_W;
    // Longitude wraps at the map seam, and pole-spread can stretch a shape
    // well past the edge - paint left/right ghost copies so it wraps around
    // instead of clipping at u=0/u=1, matching a real equirect light patch.
    paintShape(ctx, shape, LAYER_W, LAYER_H, cx - LAYER_W);
    paintShape(ctx, shape, LAYER_W, LAYER_H, cx);
    paintShape(ctx, shape, LAYER_W, LAYER_H, cx + LAYER_W);
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
