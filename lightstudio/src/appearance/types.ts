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

/** A control point on a ramp. `value` drives value/alpha ramps, `color` colour ramps. */
export interface RampStop {
  pos: number;
  value: number;
  color?: string;
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

// ── Per-type parameters ─────────────────────────────────────────────────────

export interface FlatParams {
  color: string;
  intensity: number;
  alpha: number;
}

export interface BulbParams {
  color: string;
  intensity: number;
  /** 0-1 radius of the bulb relative to the half size of the light. */
  width: number;
  /** 0-1 radius beyond which the bulb is cut off (extent). */
  extent: number;
  /** Brightness from centre (pos 0) to edge (pos 1). */
  ramp: RampStop[];
}

export interface GradientParams {
  mode: 'linear' | 'radial';
  /** degrees, linear mode */
  angle: number;
  color: string;
  intensity: number;
  valueRamp: RampStop[];
  alphaRamp: RampStop[];
  colorRamp: RampStop[];
  useColorRamp: boolean;
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
}

export interface PolygonParams {
  color: string;
  intensity: number;
  sides: number;
  /** 0-1 of the half size */
  radius: number;
  /** 0-1 corner rounding */
  cornerRadius: number;
  softness: number;
}

export interface ImageParams {
  imageId: string | null;
  channel: 'rgba' | 'rgb' | 'luminance' | 'alpha';
  fit: 'stretch' | 'fit' | 'fill';
  wrap: 'clamp' | 'repeat' | 'mirror';
  /** Exposure in stops applied to the image. */
  exposure: number;
  color: string;
}

export interface CurvePoint {
  x: number;
  y: number;
  /** Width multiplier at this point (0-2). */
  w: number;
}

export interface LumiCurveParams {
  color: string;
  intensity: number;
  points: CurvePoint[];
  closed: boolean;
  smooth: boolean;
  /** 0-1 of the half size. */
  thickness: number;
  softness: number;
  glow: number;
  glowFalloff: number;
  taper: 'none' | 'ends' | 'start' | 'end';
  /** Brightness along the curve start (pos 0) to end (pos 1). */
  ramp: RampStop[];
}

export interface ScrimParams {
  color: string;
  intensity: number;
  /** Scrim size relative to the light (0-1). */
  width: number;
  height: number;
  /** Light position behind the scrim: x,y in -1..1, z = distance behind. */
  lightX: number;
  lightY: number;
  lightZ: number;
  lightSize: number;
  falloff: number;
  /** 0 = pure hotspot, 1 = perfectly diffused/even. */
  diffusion: number;
  edgeSoftness: number;
  /** Width of the darker frame around the scrim (0-1). */
  frame: number;
}

export interface SkyParams {
  /** Sun position as direction on the sphere: azimuth 0-360, elevation -90..90. */
  sunAzimuth: number;
  sunElevation: number;
  /** Angular size multiplier (1 = realistic). Bigger suns keep their energy. */
  sunSize: number;
  sunIntensity: number;
  turbidity: number;
  zenithColor: string;
  horizonColor: string;
  groundColor: string;
  /** Horizon position (-1..1) and softness (0-1) of the sky/ground alpha ramp. */
  horizon: number;
  horizonSoftness: number;
  groundAlpha: number;
  falloff: number;
  intensity: number;
  cloudsImageId: string | null;
  cloudsAmount: number;
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
}

export interface EvalContext {
  images: Map<string, AppearanceImage>;
}
