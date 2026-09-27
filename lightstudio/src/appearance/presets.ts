/**
 * Built-in procedural Light Appearance presets. Original designs (nothing is
 * copied from third-party libraries); users can add their own presets and
 * import image-based content for anything photographic.
 */
import type { AppearanceBlend, ContentLayer, ContentType, LightAppearance } from './types';
import { colorStops, newAppearance, newLayer, softFalloff, stops } from './content';
import type { ContentParams } from './types';

export type PresetCategory =
  | 'Softboxes'
  | 'Strips'
  | 'Bulbs & Spots'
  | 'Shapes'
  | 'Rings'
  | 'Gradients'
  | 'Curves'
  | 'Scrims'
  | 'Blinds & Flags'
  | 'Sky';

export const PRESET_CATEGORIES: PresetCategory[] = [
  'Softboxes', 'Strips', 'Bulbs & Spots', 'Shapes', 'Rings', 'Gradients', 'Curves', 'Scrims', 'Blinds & Flags', 'Sky',
];

export interface AppearancePreset {
  id: string;
  name: string;
  category: PresetCategory;
  /** width / height the thumbnail (and the light's default rectangle) uses. */
  aspect: number;
  tags: string[];
  build: () => LightAppearance;
  /** True for presets the user saved. */
  user?: boolean;
}

// ── builder helpers ─────────────────────────────────────────────────────────

type P = Partial<ContentParams['p']> & Record<string, unknown>;

function layer(type: ContentType, patch: P = {}, over: Partial<ContentLayer> = {}): ContentLayer {
  const l = newLayer(type, over);
  Object.assign(l.content.p as object, patch);
  return l;
}

function build(name: string, master: ContentLayer, opts: { vb?: ContentLayer[]; am?: ContentLayer[]; global?: Partial<LightAppearance['global']> } = {}): LightAppearance {
  const a = newAppearance('flat', name);
  a.master = master;
  a.master.name = 'Master';
  a.valueBlend = opts.vb ?? [];
  a.alphaMultiply = opts.am ?? [];
  Object.assign(a.global, opts.global ?? {});
  return a;
}

const edge = (pos: number, soft: number) => ({ pos, soft });
const boxMask = (l: number, r: number, t: number, b: number, soft: number, over: Partial<ContentLayer> = {}) =>
  layer('boxgrad', { left: edge(l, soft), right: edge(r, soft), top: edge(t, soft), bottom: edge(b, soft) }, { name: 'Edge Mask', ...over });

const wh = (c: string) => ({ color: c });

const P_LIST: Omit<AppearancePreset, 'id'>[] = [];
function add(category: PresetCategory, name: string, aspect: number, tags: string[], fn: () => LightAppearance) {
  P_LIST.push({ category, name, aspect, tags, build: fn });
}

// ── Softboxes ───────────────────────────────────────────────────────────────
add('Softboxes', 'Softbox Square', 1, ['soft', 'studio'], () =>
  build('Softbox Square', layer('flat'), { am: [boxMask(0.06, 0.06, 0.06, 0.06, 0.12)] }));
add('Softboxes', 'Softbox Top-Heavy', 1, ['gradient', 'studio'], () =>
  build('Softbox Top-Heavy', layer('boxgrad', {
    vRamp: stops([0, 0.25], [0.6, 0.8], [1, 1]),
    left: edge(0.05, 0.1), right: edge(0.05, 0.1), top: edge(0.04, 0.08), bottom: edge(0.04, 0.08),
  })));
add('Softboxes', 'Softbox Hot Centre', 1, ['soft', 'centre'], () =>
  build('Softbox Hot Centre', layer('bulb', { width: 1, extent: 1.2, ramp: stops([0, 1], [0.5, 0.55], [1, 0.25]) }),
    { am: [boxMask(0.05, 0.05, 0.05, 0.05, 0.1)] }));
add('Softboxes', 'Octabox', 1, ['octa', 'studio'], () =>
  build('Octabox', layer('polygon', { sides: 8, radius: 0.92, softness: 0.05 }), {
    vb: [layer('bulb', { width: 1, extent: 1.3, ramp: stops([0, 1], [1, 0.55]) }, { name: 'Centre Lift', blend: 'multiply', amount: 100 })],
  }));
add('Softboxes', 'Rounded Softbox', 1, ['soft', 'rounded'], () =>
  build('Rounded Softbox', layer('polygon', { sides: 4, radius: 1.05, cornerRadius: 0.55, softness: 0.06 }), {}));
add('Softboxes', 'Umbrella', 1, ['round', 'soft'], () =>
  build('Umbrella', layer('polygon', { sides: 8, radius: 0.95, softness: 0.08, intensity: 0.9 }), {
    vb: [layer('bulb', { width: 1.2, extent: 1.4, ramp: stops([0, 0.7], [1, 1]) }, { name: 'Rim Lift', blend: 'multiply' })],
  }));

// ── Strips ──────────────────────────────────────────────────────────────────
add('Strips', 'Strip Light', 4, ['strip', 'rim'], () =>
  build('Strip Light', layer('flat'), { am: [boxMask(0.04, 0.04, 0.12, 0.12, 0.1)] }));
add('Strips', 'Strip Fade Left', 4, ['strip', 'gradient'], () =>
  build('Strip Fade Left', layer('boxgrad', {
    hRamp: stops([0, 0.05], [1, 1]),
    left: edge(0.03, 0.06), right: edge(0.03, 0.06), top: edge(0.1, 0.1), bottom: edge(0.1, 0.1),
  })));
add('Strips', 'Strip Centre Fade', 4, ['strip'], () =>
  build('Strip Centre Fade', layer('boxgrad', {
    hRamp: stops([0, 0.15], [0.5, 1], [1, 0.15]),
    left: edge(0.03, 0.06), right: edge(0.03, 0.06), top: edge(0.1, 0.1), bottom: edge(0.1, 0.1),
  })));
add('Strips', 'Tall Strip', 0.25, ['strip', 'vertical'], () =>
  build('Tall Strip', layer('flat'), { am: [boxMask(0.12, 0.12, 0.03, 0.03, 0.1)] }));
add('Strips', 'Tube Light', 6, ['tube', 'fluorescent'], () =>
  build('Tube Light', layer('lumicurve', {
    points: [{ x: -0.85, y: 0, w: 1 }, { x: 0.85, y: 0, w: 1 }],
    smooth: false, thickness: 0.6, softness: 0.5, glow: 0.35, glowFalloff: 1.4,
  })));

// ── Bulbs & Spots ───────────────────────────────────────────────────────────
add('Bulbs & Spots', 'Bulb Soft', 1, ['bulb', 'point'], () => build('Bulb Soft', layer('bulb')));
add('Bulbs & Spots', 'Bulb Hard', 1, ['bulb', 'sharp'], () =>
  build('Bulb Hard', layer('bulb', { width: 0.6, extent: 0.6, ramp: stops([0, 1], [0.85, 1], [1, 0.9]) })));
add('Bulbs & Spots', 'Bulb Warm', 1, ['bulb', 'warm', 'tungsten'], () =>
  build('Bulb Warm', layer('bulb', { color: '#ffb066' })));
add('Bulbs & Spots', 'Bulb Cool', 1, ['bulb', 'cool', 'daylight'], () =>
  build('Bulb Cool', layer('bulb', { color: '#a9c8ff' })));
add('Bulbs & Spots', 'Spot Tight', 1, ['spot'], () =>
  build('Spot Tight', layer('bulb', { width: 0.35, extent: 0.4, ramp: stops([0, 1], [0.6, 0.85], [1, 0.5]) })));
add('Bulbs & Spots', 'Sun Disc', 1, ['sun', 'hard'], () =>
  build('Sun Disc', layer('bulb', { width: 0.22, extent: 0.24, intensity: 8, color: '#fff2dd', ramp: stops([0, 1], [1, 1]) })));

// ── Shapes ──────────────────────────────────────────────────────────────────
add('Shapes', 'Disc', 1, ['circle'], () => build('Disc', layer('polygon', { sides: 64, radius: 0.9, softness: 0.05 })));
add('Shapes', 'Hexagon', 1, ['polygon'], () => build('Hexagon', layer('polygon', { sides: 6, radius: 0.9 })));
add('Shapes', 'Triangle', 1, ['polygon'], () => build('Triangle', layer('polygon', { sides: 3, radius: 0.95 })));
add('Shapes', 'Pentagon', 1, ['polygon'], () => build('Pentagon', layer('polygon', { sides: 5, radius: 0.9 })));
add('Shapes', 'Diamond', 1, ['polygon'], () => build('Diamond', layer('polygon', { sides: 4, radius: 0.95 })));

// ── Rings ───────────────────────────────────────────────────────────────────
const ringMask = (inner: number) =>
  layer('bulb', { width: 1, extent: inner, ramp: stops([0, 1], [1, 1]) }, { name: 'Hole', invert: true });
add('Rings', 'Ring Light', 1, ['ring', 'beauty'], () =>
  build('Ring Light', layer('bulb', { width: 1, extent: 0.95, ramp: stops([0, 1], [1, 1]) }), { am: [ringMask(0.7)] }));
add('Rings', 'Thin Ring', 1, ['ring'], () =>
  build('Thin Ring', layer('bulb', { width: 1, extent: 0.95, ramp: stops([0, 1], [1, 1]) }), { am: [ringMask(0.85)] }));
add('Rings', 'Soft Ring', 1, ['ring', 'soft'], () =>
  build('Soft Ring', layer('bulb', { width: 1, extent: 1, ramp: stops([0, 1], [1, 1]) }), {
    am: [layer('bulb', { width: 1, extent: 0.6, ramp: stops([0, 1], [1, 1]) }, { name: 'Hole', invert: true })],
    vb: [layer('bulb', { width: 1, extent: 1.1, ramp: stops([0, 0.2], [0.75, 1], [1, 0.3]) }, { blend: 'multiply', name: 'Ring Falloff' })],
  }));

// ── Gradients ───────────────────────────────────────────────────────────────
add('Gradients', 'Horizon Gradient', 2, ['gradient', 'sky'], () =>
  build('Horizon Gradient', layer('gradient', { mode: 'linear', angle: 90, valueRamp: stops([0, 0], [0.5, 0.3], [1, 1]) })));
add('Gradients', 'Radial Fade', 1, ['gradient', 'radial'], () =>
  build('Radial Fade', layer('gradient', { mode: 'radial', valueRamp: stops([0, 1], [1, 0]) })));
add('Gradients', 'Diagonal Ramp', 1, ['gradient'], () =>
  build('Diagonal Ramp', layer('gradient', { mode: 'linear', angle: 45, valueRamp: stops([0, 0], [1, 1]) })));
add('Gradients', 'Warm Cool Split', 2, ['gradient', 'colour'], () =>
  build('Warm Cool Split', layer('gradient', {
    mode: 'linear', angle: 0, valueRamp: stops([0, 1], [1, 1]), useColorRamp: true,
    colorRamp: colorStops([0, '#ff9a4a'], [0.5, '#ffffff'], [1, '#6aa8ff']),
  })));
add('Gradients', 'Sunset Band', 2, ['gradient', 'colour'], () =>
  build('Sunset Band', layer('gradient', {
    mode: 'linear', angle: 90, valueRamp: stops([0, 0.6], [1, 1]), useColorRamp: true,
    colorRamp: colorStops([0, '#ff4d2e'], [0.5, '#ff9a4a'], [1, '#ffe2a8']),
  })));

// ── Curves ──────────────────────────────────────────────────────────────────
add('Curves', 'Neon Wave', 3, ['curve', 'neon'], () =>
  build('Neon Wave', layer('lumicurve', {
    points: [{ x: -0.85, y: 0, w: 1 }, { x: -0.4, y: 0.5, w: 1 }, { x: 0.1, y: -0.5, w: 1 }, { x: 0.85, y: 0.1, w: 1 }],
    thickness: 0.09, glow: 0.5, glowFalloff: 1.2, softness: 0.5,
  })));
add('Curves', 'Loop', 1, ['curve', 'ring'], () =>
  build('Loop', layer('lumicurve', {
    points: [{ x: 0, y: 0.7, w: 1 }, { x: 0.7, y: 0, w: 1 }, { x: 0, y: -0.7, w: 1 }, { x: -0.7, y: 0, w: 1 }],
    closed: true, thickness: 0.08, softness: 0.5, glow: 0.3,
  })));
add('Curves', 'Rim Arc', 2, ['curve', 'rim'], () =>
  build('Rim Arc', layer('lumicurve', {
    points: [{ x: -0.8, y: -0.35, w: 0.4 }, { x: 0, y: 0.25, w: 1.2 }, { x: 0.8, y: -0.35, w: 0.4 }],
    thickness: 0.14, taper: 'ends', softness: 0.7,
  })));
add('Curves', 'Taper Streak', 4, ['curve', 'streak'], () =>
  build('Taper Streak', layer('lumicurve', {
    points: [{ x: -0.9, y: 0, w: 1 }, { x: 0.9, y: 0, w: 1 }],
    smooth: false, thickness: 0.4, taper: 'end', softness: 0.8, glow: 0.2,
  })));

// ── Scrims ──────────────────────────────────────────────────────────────────
add('Scrims', 'Diffused Scrim', 1, ['scrim', 'soft'], () => build('Diffused Scrim', layer('scrim')));
add('Scrims', 'Hot Spot Scrim', 1, ['scrim', 'spot'], () =>
  build('Hot Spot Scrim', layer('scrim', { diffusion: 0, lightZ: 0.35, falloff: 2 })));
add('Scrims', 'Off-Axis Scrim', 1, ['scrim'], () =>
  build('Off-Axis Scrim', layer('scrim', { lightX: -0.45, lightY: 0.3, diffusion: 0.1, lightZ: 0.45, falloff: 1.5 })));
add('Scrims', 'Framed Scrim', 1, ['scrim', 'frame'], () =>
  build('Framed Scrim', layer('scrim', { frame: 0.22, diffusion: 0.5 })));

// ── Blinds & Flags ──────────────────────────────────────────────────────────
const blinds = (n: number, duty: number, angle: number) => {
  const s: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + duty) / n, c = (i + 1) / n;
    s.push([a + 0.0001, 1], [b, 1], [b + 0.0001, 0], [c - 0.0001 > b ? c - 0.0001 : c, 0]);
  }
  return layer('gradient', { mode: 'linear', angle, valueRamp: stops([0, 1], [1, 1]), alphaRamp: stops(...s) }, { name: 'Blinds' });
};
add('Blinds & Flags', 'Venetian Blinds', 1, ['blinds', 'gobo'], () => build('Venetian Blinds', layer('flat'), { am: [blinds(7, 0.55, 90)] }));
add('Blinds & Flags', 'Vertical Slats', 1, ['blinds', 'gobo'], () => build('Vertical Slats', layer('flat'), { am: [blinds(6, 0.5, 0)] }));
add('Blinds & Flags', 'Barn Doors', 1, ['flag', 'cutter'], () =>
  build('Barn Doors', layer('flat'), { am: [boxMask(0.3, 0.3, 0.02, 0.02, 0.02)] }));
add('Blinds & Flags', 'Half Flag', 1, ['flag', 'cutter'], () =>
  build('Half Flag', layer('flat'), {
    am: [layer('gradient', { mode: 'linear', angle: 0, alphaRamp: stops([0, 0], [0.5, 0], [0.52, 1], [1, 1]), valueRamp: stops([0, 1], [1, 1]) }, { name: 'Cutter' })],
  }));

// ── Sky ─────────────────────────────────────────────────────────────────────
add('Sky', 'Clear Day', 2, ['sky', 'sun'], () => build('Clear Day', layer('sky', {})));
add('Sky', 'Golden Hour', 2, ['sky', 'sunset'], () =>
  build('Golden Hour', layer('sky', {
    sunAzimuth: 250, sunElevation: 6, sunIntensity: 60, turbidity: 6,
    zenithColor: '#5b78b8', horizonColor: '#ffb070', groundColor: '#3a2f28', horizon: -0.25, falloff: 1.2,
  })));
add('Sky', 'Overcast', 2, ['sky', 'soft'], () =>
  build('Overcast', layer('sky', {
    sunIntensity: 0, turbidity: 9, zenithColor: '#9aa6b5', horizonColor: '#d6dbe2', groundColor: '#5a5750', falloff: 0.6, intensity: 0.7,
  })));
add('Sky', 'Twilight', 2, ['sky', 'night'], () =>
  build('Twilight', layer('sky', {
    sunAzimuth: 300, sunElevation: -4, sunIntensity: 8, turbidity: 4,
    zenithColor: '#1b2a55', horizonColor: '#ff8a5a', groundColor: '#15121a', horizon: -0.3, falloff: 1.4, intensity: 0.6,
  })));

export const APPEARANCE_PRESETS: AppearancePreset[] = P_LIST.map((p, i) => ({
  ...p,
  id: 'builtin_' + p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + i,
}));

export function findPreset(id: string): AppearancePreset | undefined {
  return APPEARANCE_PRESETS.find((p) => p.id === id);
}

export const BLEND_MODE_LIST: AppearanceBlend[] = ['normal', 'multiply', 'add', 'subtract', 'screen', 'overlay', 'min', 'max', 'difference', 'divide'];
export { softFalloff };
