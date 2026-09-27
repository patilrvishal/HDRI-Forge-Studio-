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
import { smoothTangents } from './evaluate';

export const stops = (...pairs: [number, number][]): RampStop[] => pairs.map(([pos, value]) => ({ pos, value }));
/** Same, but with cosine interpolation between stops. */
export const cosStops = (...pairs: [number, number][]): RampStop[] => pairs.map(([pos, value]) => ({ pos, value, interp: 'cosine' as const }));
export const colorStops = (...pairs: [number, string][]): RampStop[] => pairs.map(([pos, color]) => ({ pos, value: 1, color }));

/** A smooth brightness falloff, brightest at 0. */
export const softFalloff = (): RampStop[] => cosStops([0, 1], [0.5, 0.55], [1, 0]);

const WHITE_RAMP = (): RampStop[] => colorStops([0, '#ffffff'], [1, '#ffffff']);

/** Curve through a few points with smooth Bezier tangents. */
export function curveFrom(pts: { x: number; y: number }[], closed = false) {
  return smoothTangents(pts, closed);
}

export function defaultContent(type: ContentType): ContentParams {
  switch (type) {
    case 'flat':
      return { type, p: { color: '#ffffff', intensity: 1, alpha: 1 } };
    case 'bulb':
      return {
        type,
        p: {
          shape: 'round', width: 100, position: 0, half: false, outside: false,
          colorMode: 'flat', color: '#ffffff', intensity: 1,
          colorRamp: WHITE_RAMP(),
          alphaRamp: cosStops([0, 1], [0.5, 0.55], [1, 0]),
        },
      };
    case 'gradient':
      return {
        type,
        p: {
          mode: 'linear', rotation: 90, originX: 0, originY: 0, extent: 1, intensity: 1,
          colorRamp: WHITE_RAMP(),
          valueRamp: stops([0, 0], [1, 1]),
          alphaRamp: stops([0, 1], [1, 1]),
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
          edgeInterp: 'cosine',
        },
      };
    case 'polygon':
      return { type, p: { color: '#ffffff', intensity: 1, sides: 6, softness: 0.06, radius: 0 } };
    case 'image':
      return {
        type,
        p: {
          imageId: null, colorTransform: true, half: false, flip: false, unpremultiply: false, invertAlpha: false,
          colorMode: 'source', color: '#ffffff', rampMode: 'linear', colorRamp: WHITE_RAMP(), saturation: 1, gamma: 1, exposure: 0,
        },
      };
    case 'lumicurve':
      return {
        type,
        p: {
          color: '#ffffff',
          intensity: 1,
          points: curveFrom([{ x: -0.7, y: -0.25 }, { x: -0.25, y: 0.35 }, { x: 0.25, y: -0.35 }, { x: 0.7, y: 0.25 }]),
          closed: false,
          greenOffset: 0.16,
          blueOffset: 0.16,
          greenRamp: cosStops([0, 1], [1, 0]),
          blueRamp: cosStops([0, 1], [1, 0]),
          symmetrical: true,
          lengthRamp: stops([0, 1], [1, 1]),
          roundnessStart: 0.3,
          roundnessEnd: 0.3,
          startBlend: 1,
          endBlend: 1,
          startAngle: 0,
          endAngle: 0,
          offsetType: 'normal',
          offsetAngle: 90,
        },
      };
    case 'scrim':
      return {
        type,
        p: {
          kind: 'polygon', color: '#ffffff', intensity: 1, height: 1, tilt: 0, posX: 0, posY: 0, rotation: 0,
          sides: 4, width: 0.6, depth: 0.6, spread: 120, surfaceFade: 0.05, zoom: 1, handleX: 0, handleY: 0,
          falloff: cosStops([0, 1], [1, 0.1]),
        },
      };
    case 'sky':
      return {
        type,
        p: {
          altitude: 35, azimuth: 0, turbidity: 3, albedo: 0.3, discSize: 1, discVisible: true,
          discFalloff: stops([0, 1], [1, 0.6]), energyBoost: 1, skyVisible: true, skyAlpha: stops([0, 1], [1, 1]),
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
  }
  for (const f of a.filters ?? []) {
    const id = (f.params as { speedImageId?: string | null }).speedImageId;
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Stable string signature - used as a texture-cache key. */
export const appearanceSignature = (a: LightAppearance): string => JSON.stringify(a);
