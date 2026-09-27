/**
 * Factories for Light Appearance content: default parameters per content
 * type, layer constructors and helpers for building / cloning appearances.
 */
import {
  ContentLayer,
  ContentParams,
  ContentType,
  LightAppearance,
  RampStop,
  defaultGlobals,
  defaultTransform,
  newLayerId,
  CONTENT_TYPE_LABELS,
} from './types';

export const stops = (...pairs: [number, number][]): RampStop[] => pairs.map(([pos, value]) => ({ pos, value }));
export const colorStops = (...pairs: [number, string][]): RampStop[] => pairs.map(([pos, color]) => ({ pos, value: 1, color }));

/** A smooth Gaussian-like falloff, brightest at 0. */
export const softFalloff = (): RampStop[] =>
  stops([0, 1], [0.2, 0.9], [0.4, 0.62], [0.6, 0.3], [0.8, 0.08], [1, 0]);

export function defaultContent(type: ContentType): ContentParams {
  switch (type) {
    case 'flat':
      return { type, p: { color: '#ffffff', intensity: 1, alpha: 1 } };
    case 'bulb':
      return { type, p: { color: '#ffffff', intensity: 1, width: 0.85, extent: 1, ramp: softFalloff() } };
    case 'gradient':
      return {
        type,
        p: {
          mode: 'linear',
          angle: 90,
          color: '#ffffff',
          intensity: 1,
          valueRamp: stops([0, 0], [1, 1]),
          alphaRamp: stops([0, 1], [1, 1]),
          colorRamp: colorStops([0, '#ff8a00'], [1, '#ffffff']),
          useColorRamp: false,
        },
      };
    case 'boxgrad':
      return {
        type,
        p: {
          color: '#ffffff',
          intensity: 1,
          hRamp: stops([0, 1], [1, 1]),
          vRamp: stops([0, 1], [1, 1]),
          combine: 'multiply',
          left: { pos: 0.05, soft: 0.1 },
          right: { pos: 0.05, soft: 0.1 },
          top: { pos: 0.05, soft: 0.1 },
          bottom: { pos: 0.05, soft: 0.1 },
        },
      };
    case 'polygon':
      return { type, p: { color: '#ffffff', intensity: 1, sides: 6, radius: 0.85, cornerRadius: 0, softness: 0.06 } };
    case 'image':
      return { type, p: { imageId: null, channel: 'rgba', fit: 'fit', wrap: 'clamp', exposure: 0, color: '#ffffff' } };
    case 'lumicurve':
      return {
        type,
        p: {
          color: '#ffffff',
          intensity: 1,
          points: [
            { x: -0.7, y: -0.3, w: 1 },
            { x: -0.2, y: 0.4, w: 1 },
            { x: 0.3, y: -0.4, w: 1 },
            { x: 0.7, y: 0.3, w: 1 },
          ],
          closed: false,
          smooth: true,
          thickness: 0.12,
          softness: 0.6,
          glow: 0,
          glowFalloff: 1,
          taper: 'none',
          ramp: stops([0, 1], [1, 1]),
        },
      };
    case 'scrim':
      return {
        type,
        p: {
          color: '#ffffff',
          intensity: 1,
          width: 0.9,
          height: 0.9,
          lightX: 0,
          lightY: 0,
          lightZ: 0.6,
          lightSize: 0.1,
          falloff: 1,
          diffusion: 0.25,
          edgeSoftness: 0.08,
          frame: 0.1,
        },
      };
    case 'sky':
      return {
        type,
        p: {
          sunAzimuth: 270,
          sunElevation: 35,
          sunSize: 1,
          sunIntensity: 40,
          turbidity: 3,
          zenithColor: '#4f86d6',
          horizonColor: '#cfe2f5',
          groundColor: '#4a4238',
          horizon: -0.2,
          horizonSoftness: 0.05,
          groundAlpha: 1,
          falloff: 0.8,
          intensity: 1,
          cloudsImageId: null,
          cloudsAmount: 0.5,
        },
      };
  }
}

export function newLayer(type: ContentType, over: Partial<ContentLayer> = {}): ContentLayer {
  return {
    id: newLayerId(),
    name: CONTENT_TYPE_LABELS[type],
    enabled: true,
    blend: 'normal',
    amount: 100,
    invert: false,
    transform: defaultTransform(),
    content: defaultContent(type),
    ...over,
  };
}

export function newAppearance(masterType: ContentType = 'flat', name = 'Untitled'): LightAppearance {
  return {
    version: 1,
    name,
    master: newLayer(masterType, { name: 'Master' }),
    valueBlend: [],
    alphaMultiply: [],
    global: defaultGlobals(),
  };
}

export const cloneAppearance = (a: LightAppearance): LightAppearance => JSON.parse(JSON.stringify(a));

/** Re-issues layer ids so a cloned appearance never collides with the source. */
export function cloneWithNewIds(a: LightAppearance): LightAppearance {
  const c = cloneAppearance(a);
  c.master.id = newLayerId();
  c.valueBlend.forEach((l) => (l.id = newLayerId()));
  c.alphaMultiply.forEach((l) => (l.id = newLayerId()));
  return c;
}

/** Image ids referenced by an appearance (so they can be embedded when saving). */
export function referencedImageIds(a: LightAppearance): string[] {
  const ids = new Set<string>();
  for (const l of [a.master, ...a.valueBlend, ...a.alphaMultiply]) {
    const c = l.content;
    if (c.type === 'image' && c.p.imageId) ids.add(c.p.imageId);
    if (c.type === 'sky' && c.p.cloudsImageId) ids.add(c.p.cloudsImageId);
  }
  return [...ids];
}

/** Stable string signature - used as a texture-cache key. */
export const appearanceSignature = (a: LightAppearance): string => JSON.stringify(a);
