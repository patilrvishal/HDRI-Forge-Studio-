/**
 * Edit HDRI Environments - a non-destructive stack of edit layers applied to a
 * loaded HDRI (or a procedural sky). Layers are applied in order, each through an
 * optional region mask painted on the sphere.
 */
import type { FilterSpec } from '../filters/filters';

export type EditKind = 'adjust' | 'blur' | 'blocker' | 'fill' | 'sun' | 'mix';

export const EDIT_KIND_LABELS: Record<EditKind, string> = {
  adjust: 'Colour / Exposure',
  blur: 'Blur (Diffusion / Motion)',
  blocker: 'Blocker',
  fill: 'Remove / Clone',
  sun: 'Sun',
  mix: 'Mix HDRI',
};

/** Where on the map a layer acts. Coordinates are map UV (0-1, u across, v down). */
export interface EditRegion {
  shape: 'global' | 'circle' | 'rect';
  u: number;
  v: number;
  /** Circle radius / rectangle half-width, in degrees on the sphere. */
  size: number;
  /** Rectangle half-height in degrees. */
  sizeV: number;
  /** Rectangle roll in degrees. */
  rotation: number;
  /** 0-100 soft edge. */
  feather: number;
  invert: boolean;
}

export const defaultRegion = (u = 0.5, v = 0.35): EditRegion => ({
  shape: 'circle', u, v, size: 25, sizeV: 15, rotation: 0, feather: 40, invert: false,
});

export interface AdjustParams {
  exposure: number;
  hue: number;
  saturation: number;
  contrast: number;
  gamma: number;
  tint: string;
  /** 0-100 how strongly the tint colour is applied. */
  tintAmount: number;
}

export interface BlurParams {
  filters: FilterSpec[];
}

export interface BlockerParams {
  mode: 'multiply' | 'solid';
  /** 0-100 how dark / how opaque. */
  amount: number;
  color: string;
  /** Radiance multiplier for solid mode (a bright card > 1). */
  intensity: number;
}

export interface FillParams {
  mode: 'remove' | 'clone';
  /** Clone source centre (map UV). */
  sourceU: number;
  sourceV: number;
  /** Remove: 0-100 how far the surroundings are smeared in. */
  smear: number;
  /** Clone: brightness multiplier of the copied area (turn an HDRI light up / down). */
  gain: number;
  /** Clone: also remove the source area, turning the clone into a MOVE. */
  removeSource: boolean;
}

export interface SunParams {
  action: 'resize' | 'remove' | 'move';
  /** Angular size multiplier (resize/move); light energy is preserved. */
  scale: number;
  /** Extra energy multiplier. */
  intensity: number;
  /** Where the sun ends up (move). */
  targetU: number;
  targetV: number;
  /** 1-100: pixels brighter than this % of the peak count as the sun. */
  threshold: number;
}

export interface MixParams {
  assetId: string | null;
  /** Rotation of the source HDRI in degrees. */
  rotation: number;
  blend: 'normal' | 'add' | 'multiply' | 'screen';
  intensity: number;
}

export type EditParams =
  | { kind: 'adjust'; p: AdjustParams }
  | { kind: 'blur'; p: BlurParams }
  | { kind: 'blocker'; p: BlockerParams }
  | { kind: 'fill'; p: FillParams }
  | { kind: 'sun'; p: SunParams }
  | { kind: 'mix'; p: MixParams };

export interface EditLayer {
  id: string;
  name: string;
  enabled: boolean;
  /** 0-100 overall strength of the layer. */
  opacity: number;
  region: EditRegion;
  edit: EditParams;
}

let counter = 0;
export const newEditId = (): string => `edit_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function defaultEdit(kind: EditKind): EditParams {
  switch (kind) {
    case 'adjust':
      return { kind, p: { exposure: 0, hue: 0, saturation: 0, contrast: 0, gamma: 1, tint: '#ffffff', tintAmount: 0 } };
    case 'blur':
      return { kind, p: { filters: [] } };
    case 'blocker':
      return { kind, p: { mode: 'multiply', amount: 100, color: '#000000', intensity: 1 } };
    case 'fill':
      return { kind, p: { mode: 'remove', sourceU: 0.25, sourceV: 0.5, smear: 60, gain: 1, removeSource: false } };
    case 'sun':
      return { kind, p: { action: 'resize', scale: 2, intensity: 1, targetU: 0.5, targetV: 0.3, threshold: 25 } };
    case 'mix':
      return { kind, p: { assetId: null, rotation: 0, blend: 'normal', intensity: 1 } };
  }
}

export function newEditLayer(kind: EditKind, region?: Partial<EditRegion>): EditLayer {
  const globalByDefault = kind === 'adjust' || kind === 'blur' || kind === 'mix';
  return {
    id: newEditId(),
    name: EDIT_KIND_LABELS[kind],
    enabled: true,
    opacity: 100,
    region: { ...defaultRegion(), ...(globalByDefault ? { shape: 'global' as const } : {}), ...(region ?? {}) },
    edit: defaultEdit(kind),
  };
}

/** Procedural sky as an HDRI source (Preetham sky; control names follow HDR Light Studio's Sky content). */
export interface SkyEnvParams {
  /** 0-90 degrees: sun height above the horizon. */
  altitude: number;
  /** -180..180 degrees: position of the sun around the horizon. */
  azimuth: number;
  /** 0-10: particles in the air (dust, moisture). 0 = clear, 10 = hazy. */
  turbidity: number;
  /** 0-1: how much light the ground reflects back up into the sky. */
  albedo: number;
  /** Multiplier on the sun's angular size; the sun keeps its energy, so bigger = dimmer per pixel. */
  discSize: number;
  discVisible: boolean;
  /** Softness of the disc edge (ramp centre to edge). */
  discFalloff: { pos: number; value: number }[];
  /** Brightens the sun only. */
  energyBoost: number;
  skyVisible: boolean;
}

export const defaultSky = (): SkyEnvParams => ({
  altitude: 40,
  azimuth: 20,
  turbidity: 3,
  albedo: 0.3,
  discSize: 1,
  discVisible: true,
  discFalloff: [{ pos: 0, value: 1 }, { pos: 1, value: 0.6 }],
  energyBoost: 1,
  skyVisible: true,
});
