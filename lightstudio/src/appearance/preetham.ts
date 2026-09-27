/**
 * Preetham et al. (1999) analytic daylight sky. Returns linear sRGB radiance (relative units)
 * for a view direction given as zenith angle and the angle to the sun.
 */

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export interface PerezCoeffs {
  Y: number[];
  x: number[];
  y: number[];
}

/** Distribution coefficients for a turbidity T (Preetham table). */
function coeffs(T: number): PerezCoeffs {
  return {
    Y: [0.1787 * T - 1.463, -0.3554 * T + 0.4275, -0.0227 * T + 5.3251, 0.1206 * T - 2.5771, -0.067 * T + 0.3703],
    x: [-0.0193 * T - 0.2592, -0.0665 * T + 0.0008, -0.0004 * T + 0.2125, -0.0641 * T - 0.8989, -0.0033 * T + 0.0452],
    y: [-0.0167 * T - 0.2608, -0.095 * T + 0.0092, -0.0079 * T + 0.2102, -0.0441 * T - 1.6537, -0.0109 * T + 0.0529],
  };
}

const perez = (c: number[], cosTheta: number, gamma: number, cosGamma: number) =>
  (1 + c[0] * Math.exp(c[1] / Math.max(cosTheta, 0.01))) * (1 + c[2] * Math.exp(c[3] * gamma) + c[4] * cosGamma * cosGamma);

export interface SkyState {
  T: number;
  thetaS: number;
  c: PerezCoeffs;
  Yz: number;
  xz: number;
  yz: number;
  fY0: number;
  fx0: number;
  fy0: number;
}

/** Precompute everything that only depends on turbidity and the sun's zenith angle. */
export function skyState(turbidity: number, sunAltitudeDeg: number): SkyState {
  const T = clamp(turbidity, 1.7, 10);
  const thetaS = clamp((90 - sunAltitudeDeg) * (Math.PI / 180), 0, Math.PI / 2 - 0.02);
  const c = coeffs(T);
  const chi = (4 / 9 - T / 120) * (Math.PI - 2 * thetaS);
  const Yz = Math.max(0.05, (4.0453 * T - 4.971) * Math.tan(chi) - 0.2155 * T + 2.4192);
  const t2 = thetaS * thetaS, t3 = t2 * thetaS;
  const xz = T * T * (0.00166 * t3 - 0.00375 * t2 + 0.00209 * thetaS) + T * (-0.02903 * t3 + 0.06377 * t2 - 0.03202 * thetaS + 0.00394) + (0.11693 * t3 - 0.21196 * t2 + 0.06052 * thetaS + 0.25886);
  const yz = T * T * (0.00275 * t3 - 0.0061 * t2 + 0.00317 * thetaS) + T * (-0.04214 * t3 + 0.0897 * t2 - 0.04153 * thetaS + 0.00516) + (0.15346 * t3 - 0.26756 * t2 + 0.06669 * thetaS + 0.26688);
  return {
    T, thetaS, c, Yz, xz, yz,
    fY0: perez(c.Y, 1, thetaS, Math.cos(thetaS)),
    fx0: perez(c.x, 1, thetaS, Math.cos(thetaS)),
    fy0: perez(c.y, 1, thetaS, Math.cos(thetaS)),
  };
}

/** Overall scale so a clear sky's zenith lands near 3 (relative HDR units). */
const SKY_SCALE = 0.12;

/**
 * Sky radiance in linear sRGB for a view direction.
 * @param thetaV  angle from the zenith to the view direction (radians)
 * @param gamma   angle between the view direction and the sun (radians)
 */
export function skyRadiance(st: SkyState, thetaV: number, gamma: number, out: [number, number, number]): void {
  const cosT = Math.cos(Math.min(thetaV, Math.PI / 2 - 0.005));
  const cg = Math.cos(gamma);
  const Y = st.Yz * (perez(st.c.Y, cosT, gamma, cg) / st.fY0);
  const x = st.xz * (perez(st.c.x, cosT, gamma, cg) / st.fx0);
  const y = st.yz * (perez(st.c.y, cosT, gamma, cg) / st.fy0);
  const yy = Math.max(0.001, y);
  const X = (x / yy) * Y;
  const Z = ((1 - x - yy) / yy) * Y;
  // XYZ -> linear sRGB
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  out[0] = Math.max(0, r * SKY_SCALE);
  out[1] = Math.max(0, g * SKY_SCALE);
  out[2] = Math.max(0, b * SKY_SCALE);
}

/** Angular radius of the real sun (radians). */
export const SUN_RADIUS = 0.2657 * (Math.PI / 180);
