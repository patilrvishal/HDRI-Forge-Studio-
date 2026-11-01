import * as THREE from 'three';

/** Equirect convention shared with HDRIExporter.pixelToDirection. */
export function uvToDir(u: number, v: number): THREE.Vector3 {
  const th = (u - 0.5) * 2 * Math.PI, ph = v * Math.PI;
  return new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
}

export function dirToUv(d: THREE.Vector3): [number, number] {
  const n = d.clone().normalize();
  let u = Math.atan2(n.z, n.x) / (2 * Math.PI) + 0.5;
  u = ((u % 1) + 1) % 1;
  return [u, Math.acos(Math.max(-1, Math.min(1, n.y))) / Math.PI];
}

export interface LightFrame {
  id: string;
  isRect: boolean;
  pos: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  width: number;
  height: number;
}

/** Runtime frames of every light in the scene, keyed by store id. */
export function collectLightFrames(scene: THREE.Scene): Map<string, LightFrame> {
  const out = new Map<string, LightFrame>();
  const q = new THREE.Quaternion();
  scene.traverse((o) => {
    const id = o.userData?.lightId as string | undefined;
    if (!id || !(o as THREE.Light).isLight) return;
    const pos = o.getWorldPosition(new THREE.Vector3());
    if ((o as THREE.RectAreaLight).isRectAreaLight) {
      const ra = o as THREE.RectAreaLight;
      ra.getWorldQuaternion(q);
      out.set(id, {
        id, isRect: true, pos,
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        width: ra.width, height: ra.height,
      });
    } else {
      out.set(id, { id, isRect: false, pos, right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), width: 0, height: 0 });
    }
  });
  return out;
}

/** Map-space (u,v) of a point on the light's rectangle, given local offsets in world units. */
export function rectPointUv(f: LightFrame, ax: number, ay: number): [number, number] {
  const p = f.pos.clone().addScaledVector(f.right, ax).addScaledVector(f.up, ay);
  return dirToUv(p);
}

/** Half-extents (world units) of the rectangle the direction `d` reaches, in the light's plane. */
export function planeOffsets(f: LightFrame, d: THREE.Vector3): { lx: number; ly: number } | null {
  const c = f.pos.clone().normalize();
  const cosc = d.dot(c);
  if (cosc <= 0.02) return null;
  const dist = f.pos.length();
  return { lx: (d.dot(f.right) / cosc) * dist, ly: (d.dot(f.up) / cosc) * dist };
}

/** Does direction `d` fall inside the light's rectangle? */
export function insideRect(f: LightFrame, d: THREE.Vector3): boolean {
  if (!f.isRect) return false;
  const o = planeOffsets(f, d);
  return !!o && Math.abs(o.lx) <= f.width / 2 && Math.abs(o.ly) <= f.height / 2;
}
