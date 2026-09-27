import type { FilterSpec } from '../filters/filters';

/**
 * Light Appearance - the content system that defines what a light looks like.
 *
 * Modelled on HDR Light Studio: every light has a MASTER content (the base
 * colour + alpha), optional VALUE BLEND layers (blended into the master's
 * colour with a blend mode) and ALPHA MULTIPLY layers (which multiply the
 * master's alpha - the usual way to shape a light). The result is an RGBA
 * float image in linear HDR values.
 */

export type ContentType =
  | 'flat'
  | 'bulb'
  | 'gradient'
  | 'boxgrad'
  | 'polygon'
  | 'image'
  | 'lumicurve'
  | 'scrim'
  | 'sky';

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  flat: 'Flat',
  bulb: 'Bulb',
  gradient: 'Gradient',
  boxgrad: 'Box Gradient',
  polygon: 'Polygon',
  image: 'Image',
  lumicurve: 'Lumi-Curve',
  scrim: 'Scrim',
  sky: 'Sky',
};

/** Which sections each content type may be used in (as in HDR Light Studio). */
export type SectionKind = 'master' | 'valueBlend' | 'alphaMultiply';
export const CONTENT_SECTIONS: Record<ContentType, SectionKind[]> = {
  flat: ['master', 'valueBlend'],
  bulb: ['master', 'valueBlend', 'alphaMultiply'],
  gradient: ['master', 'valueBlend', 'alphaMultiply'],
  boxgrad: ['master', 'valueBlend', 'alphaMultiply'],
  polygon: ['master', 'valueBlend', 'alphaMultiply'],
  image: ['master', 'valueBlend', 'alphaMultiply'],
  lumicurve: ['master', 'valueBlend', 'alphaMultiply'],
  scrim: ['master', 'valueBlend', 'alphaMultiply'],
  sky: ['master', 'valueBlend'],
};

export type AppearanceBlend =
  | 'normal'
  | 'multiply'
  | 'add'
  | 'subtract'
  | 'screen'
  | 'overlay'
  | 'min'
  | 'max'
  | 'difference'
  | 'divide';

export const BLEND_LABELS: Record<AppearanceBlend, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  add: 'Add',
  subtract: 'Subtract',
  screen: 'Screen',
  overlay: 'Overlay',
  min: 'Darken',
  max: 'Lighten',
  difference: 'Difference',
  divide: 'Divide',
};

/**
 * A control point on a ramp. `value` drives value/alpha ramps, `color` colour ramps.
 * `interp` is how the ramp travels from this stop to the next one.
 */
export interface RampStop {
  pos: number;
  value: number;
  color?: string;
  interp?: 'linear' | 'cosine' | 'step';
}

export interface ContentTransform {
  scaleX: number;
  scaleY: number;
  /** degrees */
  rotation: number;
  offsetX: number;
  offsetY: number;
  flipX: boolean;
  flipY: boolean;
}

export const defaultTransform = (): ContentTransform => ({
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  flipX: false,
  flipY: false,
});

// ── Per-type parameters (control names follow HDR Light Studio's content reference) ──

/** Flat: one colour for the whole light. */
export interface FlatParams {
  color: string;
  intensity: number;
  alpha: number;
}

/** Bulb: a bright filament that falls off toward the outside of a Round / Rect / Hex light. */
export interface BulbParams {
  shape: 'round' | 'rect' | 'hex';
  /** 0-100 % - size of the bulb filament. */
  width: number;
  /** -50..50 - vertical position of the filament. */
  position: number;
  /** Cut the light across the middle, removing the bottom half. */
  half: boolean;
  /** Extend the falloff into the corners (softbox look) instead of stopping at the inner bounding box. */
  outside: boolean;
  colorMode: 'flat' | 'ramp';
  color: string;
  intensity: number;
  /** Colour along centre (0) to outside (1) when colorMode is ramp. */
  colorRamp: RampStop[];
  /** Transparency from the centre (0) to the outside (1). */
  alphaRamp: RampStop[];
}

export interface GradientParams {
  mode: 'linear' | 'radial';
  /** degrees */
  rotation: number;
  /** -1..1 origin of the gradient in light space. */
  originX: number;
  originY: number;
  /** Size of the gradient (1 = spans the light). */
  extent: number;
  intensity: number;
  colorRamp: RampStop[];
  valueRamp: RampStop[];
  alphaRamp: RampStop[];
}

export interface BoxGradParams {
  color: string;
  intensity: number;
  hRamp: RampStop[];
  vRamp: RampStop[];
  /** How the two ramps combine. */
  combine: 'multiply' | 'add' | 'min' | 'max';
  /** Position (0-1 from the edge) and softness (0-1) of each edge. */
  left: { pos: number; soft: number };
  right: { pos: number; soft: number };
  top: { pos: number; soft: number };
  bottom: { pos: number; soft: number };
  /** Edge transition interpolation. */
  edgeInterp: 'cosine' | 'step';
}

export interface PolygonParams {
  color: string;
  intensity: number;
  /** 3-12 */
  sides: number;
  /** 0-1 softness of the outer edge (the polygon scales down to leave room for the soft edge). */
  softness: number;
  /** 0-1 corner radius; 1 = a perfect circle. */
  radius: number;
}

export interface ImageParams {
  imageId: string | null;
  /** Apply the colour-space reverse transform (LDR images: sRGB to linear). */
  colorTransform: boolean;
  half: boolean;
  flip: boolean;
  unpremultiply: boolean;
  invertAlpha: boolean;
  colorMode: 'source' | 'flat' | 'ramp';
  color: string;
  rampMode: 'linear' | 'radial';
  colorRamp: RampStop[];
  saturation: number;
  gamma: number;
  /** Extra exposure in stops. */
  exposure: number;
}

/** A Lumi-Curve control point with Bezier tangent handles (local offsets). */
export interface CurvePoint {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface LumiCurveParams {
  color: string;
  intensity: number;
  points: CurvePoint[];
  closed: boolean;
  /** Distance from the centre line to the falloff offset, each side (light-space units). */
  greenOffset: number;
  blueOffset: number;
  /** Brightness from the centre line (0) to the offset (1). */
  greenRamp: RampStop[];
  blueRamp: RampStop[];
  /** Use the green ramp for both sides. */
  symmetrical: boolean;
  /** Brightness multiplier along the length of the curve (0 = start, 1 = end). */
  lengthRamp: RampStop[];
  /** 0-0.49 roundness of each end. */
  roundnessStart: number;
  roundnessEnd: number;
  /** 1-6 sharpness of the transition at each end. */
  startBlend: number;
  endBlend: number;
  /** degrees */
  startAngle: number;
  endAngle: number;
  offsetType: 'normal' | 'vertical' | 'horizontal' | 'angle';
  /** degrees, for offsetType angle */
  offsetAngle: number;
}

/** Scrim light: a polygon or spot light above a diffusing scrim. */
export interface ScrimParams {
  kind: 'polygon' | 'spot';
  color: string;
  intensity: number;
  /** Distance from the light to the scrim. */
  height: number;
  /** degrees the light leans away from pointing straight at the scrim. */
  tilt: number;
  posX: number;
  posY: number;
  /** degrees, front-view rotation of the light. */
  rotation: number;
  /** Polygon light: 3-25 sides and size. */
  sides: number;
  width: number;
  depth: number;
  /** degrees of emission spread. */
  spread: number;
  /** Height above the scrim below which the light is faded out, softening edges. */
  surfaceFade: number;
  /** Scale of the light effect on the scrim. */
  zoom: number;
  /** Where the light aims (LightPaint handle); equal to the position = straight down. */
  handleX: number;
  handleY: number;
  /** Spot light: brightness from centre (0) to edge (1). */
  falloff: RampStop[];
}

/** Sky: a physically based sky (Preetham) laid out in texture space: x = azimuth, y = altitude 0-90. */
export interface SkyParams {
  /** 0-90 degrees. */
  altitude: number;
  /** -180..180 degrees, position of the sun in texture space. */
  azimuth: number;
  /** 0-10 */
  turbidity: number;
  /** 0-1 ground reflectance bounced back into the sky. */
  albedo: number;
  /** Multiplier on the sun's angular size; energy is preserved. */
  discSize: number;
  discVisible: boolean;
  /** Softness of the disc edge (ramp centre to edge). */
  discFalloff: RampStop[];
  /** Brightness multiplier for the sun only. */
  energyBoost: number;
  skyVisible: boolean;
  /** Vertical alpha ramp of the sky (bottom = horizon, top = zenith). */
  skyAlpha: RampStop[];
}

export type ContentParams =
  | { type: 'flat'; p: FlatParams }
  | { type: 'bulb'; p: BulbParams }
  | { type: 'gradient'; p: GradientParams }
  | { type: 'boxgrad'; p: BoxGradParams }
  | { type: 'polygon'; p: PolygonParams }
  | { type: 'image'; p: ImageParams }
  | { type: 'lumicurve'; p: LumiCurveParams }
  | { type: 'scrim'; p: ScrimParams }
  | { type: 'sky'; p: SkyParams };

export interface ContentLayer {
  id: string;
  name: string;
  enabled: boolean;
  blend: AppearanceBlend;
  /** 0-100 mix amount of this layer (value blend / alpha multiply layers). */
  amount: number;
  invert: boolean;
  transform: ContentTransform;
  content: ContentParams;
}

export interface AppearanceGlobals {
  /** Exposure in stops. */
  brightness: number;
  tint: string;
  hue: number;
  saturation: number;
  contrast: number;
  gamma: number;
  /** 0-100 overall alpha. */
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  /** Texture Scale: uniform scale of all content on the light (1 = as designed). */
  scale: number;
}

export interface LightAppearance {
  version: 1;
  name: string;
  master: ContentLayer;
  valueBlend: ContentLayer[];
  alphaMultiply: ContentLayer[];
  global: AppearanceGlobals;
  /** Planar filters (Diffusion / Motion blur) applied to the finished texture. */
  filters?: FilterSpec[];
}

export const defaultGlobals = (): AppearanceGlobals => ({
  brightness: 0,
  tint: '#ffffff',
  hue: 0,
  saturation: 0,
  contrast: 0,
  gamma: 1,
  opacity: 100,
  flipX: false,
  flipY: false,
  scale: 1,
});

let idCounter = 0;
export const newLayerId = (): string => `cl_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** A decoded image usable by Image / Sky (clouds) content. */
export interface AppearanceImage {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Linear RGBA float. */
  data: Float32Array;
  /** True for 8-bit images (PNG/JPG): the stored values were converted from sRGB. */
  ldr?: boolean;
}

export interface EvalContext {
  images: Map<string, AppearanceImage>;
}
