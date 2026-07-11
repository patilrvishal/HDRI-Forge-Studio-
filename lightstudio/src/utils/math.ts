export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function sphericalToCartesian(
  lat: number,
  lng: number,
  radius: number,
  height: number
): { x: number; y: number; z: number } {
  const x = radius * Math.cos(lat * DEG2RAD) * Math.cos(lng * DEG2RAD);
  const y = height;
  const z = radius * Math.cos(lat * DEG2RAD) * Math.sin(lng * DEG2RAD);
  return { x, y, z };
}

export function cartesianToSpherical(
  x: number,
  y: number,
  z: number
): { lat: number; lng: number; radius: number; height: number } {
  const height = y;
  const horizontalDist = Math.sqrt(x * x + z * z);
  const radius = horizontalDist;
  // Elevation angle from horizontal plane: atan2(y, horizontalDist)
  // Guard against NaN when both y and horizontalDist are 0
  const lat = (horizontalDist === 0 && y === 0)
    ? 0
    : Math.atan2(y, horizontalDist) * RAD2DEG;
  const lng = (x === 0 && z === 0)
    ? 0
    : Math.atan2(z, x) * RAD2DEG;
  return {
    lat,
    lng: lng < 0 ? lng + 360 : lng,
    radius,
    height,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}