import type { FilterSpec } from '../filters/filters';
import type { AppearanceBlend } from '../appearance/types';

/**
 * A Composite merges the lights of a group into one controllable unit: shared brightness,
 * opacity, position (rotate around the model / change distance) and a filter stack.
 */
export interface CompositeSettings {
  enabled: boolean;
  /** Percent multiplier on every member's brightness. */
  brightness: number;
  /** Percent multiplier on every member's opacity. */
  opacity: number;
  /** Rotate every member around the vertical axis, degrees. */
  yaw: number;
  /** Tilt every member up / down, degrees. */
  pitch: number;
  /** Multiplier on every member's distance from the model. */
  distance: number;
  visible: boolean;
  /** How the composite is blended over the map beneath it. */
  blend: AppearanceBlend;
  /** Diffusion / Motion blur applied to the whole group as one image in the HDRI. */
  filters: FilterSpec[];
}

export const defaultComposite = (): CompositeSettings => ({
  enabled: true, brightness: 100, opacity: 100, yaw: 0, pitch: 0, distance: 1, visible: true, blend: 'normal', filters: [],
});

export interface LightCollection {
  id: string;
  name: string;
  composite?: CompositeSettings;
}
