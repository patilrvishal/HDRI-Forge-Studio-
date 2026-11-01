import type { Light } from '../types/Light';
import type { CompositeSettings } from '../types/Composite';
import { cartesianToSpherical } from '../utils/math';

export interface CompositeAdjusted {
  brightness: number;
  opacity: number;
  visible: boolean;
  spherical: Light['transform']['spherical'];
  position: { x: number; y: number; z: number };
}

const D2R = Math.PI / 180;

/** Position of a light as the engine derives it from the spherical fields. */
export function lightPosition(l: Light): { x: number; y: number; z: number } {
  const s = l.transform.spherical;
  const lng = s.lng * D2R;
  return { x: s.radius * Math.cos(lng), y: s.height, z: s.radius * Math.sin(lng) };
}

/** Effective values of a member light once its composite's group controls are applied. */
export function applyComposite(l: Light, c: CompositeSettings | undefined): CompositeAdjusted {
  const base = lightPosition(l);
  if (!c || !c.enabled) {
    return { brightness: l.brightness, opacity: l.opacity, visible: l.visible, spherical: l.transform.spherical, position: base };
  }
  let { x, y, z } = base;
  // yaw about the vertical axis
  if (c.yaw) {
    const a = c.yaw * D2R, ca = Math.cos(a), sa = Math.sin(a);
    const nx = x * ca - z * sa, nz = x * sa + z * ca;
    x = nx; z = nz;
  }
  // pitch: tilt the light up / down along its own azimuth
  if (c.pitch) {
    const h = Math.hypot(x, z);
    const el = Math.atan2(y, h) + c.pitch * D2R;
    const r = Math.hypot(h, y);
    const az = Math.atan2(z, x);
    const ne = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, el));
    x = r * Math.cos(ne) * Math.cos(az); z = r * Math.cos(ne) * Math.sin(az); y = r * Math.sin(ne);
  }
  const k = Math.max(0.05, c.distance);
  x *= k; y *= k; z *= k;
  const sph = cartesianToSpherical(x, y, z);
  return {
    brightness: Math.min(1000, (l.brightness * c.brightness) / 100),
    opacity: Math.min(200, (l.opacity * c.opacity) / 100),
    visible: l.visible && c.visible,
    spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height },
    position: { x, y, z },
  };
}
