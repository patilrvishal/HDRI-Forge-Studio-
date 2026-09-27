/**
 * Hosek-Wilkie analytic sky model (RGB variant): a physically-based upgrade
 * over the earlier Preetham-based sky (see preetham.ts, still exported from
 * there for backward compatibility - this file is what it now delegates to).
 *
 * Ported from the authors' own reference implementation - Lukas Hosek and
 * Alexander Wilkie, "An Analytic Model for Full Spectral Sky-Dome Radiance"
 * (SIGGRAPH 2012), https://cgg.mff.cuni.cz/projects/SkylightModelling/ -
 * published under a 3-clause BSD license. This is real public research code
 * (the same model used by Blender's Cycles, Unreal, and most physically-based
 * renderers for their analytic sky), not a Lightmap proprietary algorithm -
 * ported here per an explicit request to upgrade sky accuracy using publicly
 * available physical models rather than attempting to reverse-engineer any
 * closed-source implementation.
 *
 * Only the sky-DOME radiance function is ported (arhosek_rgb_skymodelstate_
 * alloc_init + arhosek_tristim_skymodel_radiance from the reference C code).
 * The sun disc itself keeps this app's own existing angular-size/falloff-ramp
 * rendering (SUN_RADIUS below, consumed by evaluate.ts/hdriedit/apply.ts) -
 * the reference model's solar disc function is spectral-only and needs a
 * large separate limb-darkening dataset that duplicates what this app
 * already does its own, tested way.
 */
import { DATASETS_RGB, DATASETS_RGB_RAD } from './hosekWilkieData';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 9 params (A..I) per channel, blended between the two bracketing integer turbidities and albedos. */
function cookConfiguration(dataset: number[], turbidity: number, albedo: number, solarElevationRad: number): number[] {
  const T = clamp(turbidity, 1, 10);
  const intT = Math.min(10, Math.max(1, Math.floor(T)));
  const remT = T - intT;
  // Same re-parameterisation the reference code applies before evaluating the
  // quintic Bezier curves - solar elevation compressed toward the horizon.
  const se = Math.pow(clamp(solarElevationRad, 0, Math.PI / 2) / (Math.PI / 2), 1 / 3);
  const config = new Array(9).fill(0);

  const accumulate = (offset: number, weight: number) => {
    if (weight === 0) return;
    const b0 = Math.pow(1 - se, 5), b1 = 5 * Math.pow(1 - se, 4) * se, b2 = 10 * Math.pow(1 - se, 3) * se * se;
    const b3 = 10 * Math.pow(1 - se, 2) * se * se * se, b4 = 5 * (1 - se) * Math.pow(se, 4), b5 = Math.pow(se, 5);
    for (let i = 0; i < 9; i++) {
      config[i] += weight * (
        b0 * dataset[offset + i] + b1 * dataset[offset + i + 9] + b2 * dataset[offset + i + 18] +
        b3 * dataset[offset + i + 27] + b4 * dataset[offset + i + 36] + b5 * dataset[offset + i + 45]
      );
    }
  };

  // alb 0 / alb 1, low turbidity bracket
  accumulate(9 * 6 * (intT - 1), (1 - albedo) * (1 - remT));
  accumulate(9 * 6 * 10 + 9 * 6 * (intT - 1), albedo * (1 - remT));
  // alb 0 / alb 1, high turbidity bracket (skipped once already at the top of the 1-10 range)
  if (intT < 10) {
    accumulate(9 * 6 * intT, (1 - albedo) * remT);
    accumulate(9 * 6 * 10 + 9 * 6 * intT, albedo * remT);
  }
  return config;
}

/** Same Bezier blend as cookConfiguration, but for the single-value overall radiance scale. */
function cookRadianceConfiguration(dataset: number[], turbidity: number, albedo: number, solarElevationRad: number): number {
  const T = clamp(turbidity, 1, 10);
  const intT = Math.min(10, Math.max(1, Math.floor(T)));
  const remT = T - intT;
  const se = Math.pow(clamp(solarElevationRad, 0, Math.PI / 2) / (Math.PI / 2), 1 / 3);
  let res = 0;

  const accumulate = (offset: number, weight: number) => {
    if (weight === 0) return;
    const b0 = Math.pow(1 - se, 5), b1 = 5 * Math.pow(1 - se, 4) * se, b2 = 10 * Math.pow(1 - se, 3) * se * se;
    const b3 = 10 * Math.pow(1 - se, 2) * se * se * se, b4 = 5 * (1 - se) * Math.pow(se, 4), b5 = Math.pow(se, 5);
    res += weight * (
      b0 * dataset[offset] + b1 * dataset[offset + 1] + b2 * dataset[offset + 2] +
      b3 * dataset[offset + 3] + b4 * dataset[offset + 4] + b5 * dataset[offset + 5]
    );
  };

  accumulate(6 * (intT - 1), (1 - albedo) * (1 - remT));
  accumulate(6 * 10 + 6 * (intT - 1), albedo * (1 - remT));
  if (intT < 10) {
    accumulate(6 * intT, (1 - albedo) * remT);
    accumulate(6 * 10 + 6 * intT, albedo * remT);
  }
  return res;
}

/** The model's own radiance shape function for a given view direction (theta = angle from zenith, gamma = angle from the sun). */
function getRadianceInternal(config: number[], theta: number, gamma: number): number {
  const cosTheta = Math.cos(Math.min(theta, Math.PI / 2 - 0.001));
  const cosGamma = Math.cos(gamma);
  const expM = Math.exp(config[4] * gamma);
  const rayM = cosGamma * cosGamma;
  const mieDenom = 1 + config[8] * config[8] - 2 * config[8] * cosGamma;
  const mieM = (1 + cosGamma * cosGamma) / Math.pow(Math.max(1e-6, mieDenom), 1.5);
  const zenith = Math.sqrt(Math.max(0, cosTheta));

  return (1 + config[0] * Math.exp(config[1] / (cosTheta + 0.01))) *
    (config[2] + config[3] * expM + config[5] * rayM + config[6] * mieM + config[7] * zenith);
}

export interface HosekWilkieState {
  configs: [number[], number[], number[]];
  radiances: [number, number, number];
}

/**
 * Precompute everything that only depends on turbidity, albedo and the sun's
 * elevation - shared across every pixel of one sky render, same role as the
 * old Preetham SkyState.
 */
export function hosekWilkieState(turbidity: number, sunAltitudeDeg: number, albedo = 0): HosekWilkieState {
  const elevation = clamp(sunAltitudeDeg, 0, 90) * (Math.PI / 180);
  const alb = clamp(albedo, 0, 1);
  const configs = DATASETS_RGB.map((d) => cookConfiguration(d, turbidity, alb, elevation)) as [number[], number[], number[]];
  const radiances = DATASETS_RGB_RAD.map((d) => cookRadianceConfiguration(d, turbidity, alb, elevation)) as [number, number, number];
  return { configs, radiances };
}

// Reference output is in physical radiometric units (W / m^2 / sr); this app's
// other content types work in the same "relative HDR units, zenith around a
// few units" range the old Preetham sky used, so everything downstream
// (exposure, tonemapping, the energy-conservation tests) keeps behaving the
// same way regardless of which model produced the linear radiance.
const SKY_SCALE = 0.0004;

/**
 * Sky radiance in linear sRGB for a view direction.
 * @param theta  angle from the zenith to the view direction (radians)
 * @param gamma  angle between the view direction and the sun (radians)
 */
export function hosekWilkieRadiance(st: HosekWilkieState, theta: number, gamma: number, out: [number, number, number]): void {
  for (let ch = 0; ch < 3; ch++) {
    const v = getRadianceInternal(st.configs[ch], theta, gamma) * st.radiances[ch];
    out[ch] = Math.max(0, v * SKY_SCALE);
  }
}
