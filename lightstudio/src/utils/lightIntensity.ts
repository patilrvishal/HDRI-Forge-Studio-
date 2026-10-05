/**
 * Light intensity as shown in the UI.
 *
 * A light stores `brightness` (0-1000) and the engine uses brightness / 100 as the real
 * light intensity (see LightManager / engine: `(brightness / 1000) * 10`). The UI now speaks
 * in that intensity unit - 1.0 is the old "100" - so useful values like 0.3 or 0.5 sit in the
 * comfortable part of a 0-2.5 slider instead of at the very start of a 0-1000 one.
 * The stored unit is unchanged, so saved projects, looks, presets and keyframes keep working.
 */
export const INTENSITY_SLIDER_MAX = 2.5;
/** Typed values may go higher than the slider (brightness 1000 = intensity 10). */
export const INTENSITY_INPUT_MAX = 10;
export const INTENSITY_STEP = 0.01;

export const brightnessToIntensity = (brightness: number): number => brightness / 100;
/** Rounded to 2 decimals of brightness so 0.3 -> 30, not 30.000000000000004. */
export const intensityToBrightness = (intensity: number): number => Math.round(intensity * 100 * 100) / 100;
