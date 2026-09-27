/**
 * Analytic daylight sky, exposed to the rest of the app under its original
 * name/signature. The actual math is now the Hosek-Wilkie model (see
 * hosekWilkie.ts) rather than Preetham et al. (1999) - this file is kept as
 * a thin compatibility shim so evaluate.ts and hdriedit/apply.ts, which both
 * import `skyState`/`skyRadiance`/`SUN_RADIUS` from here, needed no changes
 * when the model was upgraded.
 */
import { hosekWilkieState, hosekWilkieRadiance, type HosekWilkieState } from './hosekWilkie';

export type SkyState = HosekWilkieState;

/** Precompute everything that only depends on turbidity, the sun's altitude, and ground albedo. */
export function skyState(turbidity: number, sunAltitudeDeg: number, albedo = 0): SkyState {
  return hosekWilkieState(turbidity, sunAltitudeDeg, albedo);
}

/**
 * Sky radiance in linear sRGB for a view direction.
 * @param thetaV  angle from the zenith to the view direction (radians)
 * @param gamma   angle between the view direction and the sun (radians)
 */
export function skyRadiance(st: SkyState, thetaV: number, gamma: number, out: [number, number, number]): void {
  hosekWilkieRadiance(st, thetaV, gamma, out);
}

/** Angular radius of the real sun (radians). */
export const SUN_RADIUS = 0.2657 * (Math.PI / 180);
