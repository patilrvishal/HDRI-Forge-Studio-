import type { Light } from '../types/Light';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Energy-Conserving Light Scaling: resizing an area light while keeping the total light
 * output constant. The light's brightness is scaled by old area / new area, so a bigger
 * (softer-shadow) light gets dimmer per unit area and a smaller one brighter.
 */
export function scaledLightPatch(l: Light, width: number, height: number, keepEnergy: boolean): Partial<Light> {
  const w = clamp(width, 0.1, 20);
  const h = clamp(height, 0.1, 20);
  const patch: Partial<Light> = { areaWidth: w, areaHeight: h };
  if (keepEnergy) {
    const a0 = Math.max(1e-6, (l.areaWidth ?? 2) * (l.areaHeight ?? 2));
    const a1 = Math.max(1e-6, w * h);
    patch.brightness = clamp(l.brightness * (a0 / a1), 0, 1000);
  }
  return patch;
}
