import * as THREE from 'three';
import { useLightsStore } from '../store/lightsStore';

/**
 * Which light is under a ray? Area lights are picked on their rectangle, other lights by how close the ray passes.
 * With a surface behind the rectangle (`firstSurfaceDist` is not null) only its border or centre counts, so a big softbox
 * in front of the model never blocks clicks on the model; over empty space its whole face is the target. A light is only
 * returned when it is nearer than the first surface.
 */
export function pickLight(scene: THREE.Scene, ray: THREE.Ray, firstSurfaceDist: number | null): string | null {
  const lightObjs = new Map<string, THREE.Object3D>();
  scene.traverse((o) => { const id = o.userData?.lightId as string | undefined; if (id && (o as THREE.Light).isLight) lightObjs.set(id, o); });
  const tri = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();
  let bestId: string | null = null, bestDist = Infinity;
  for (const l of useLightsStore.getState().lights) {
    const o = lightObjs.get(l.id);
    if (!o || !l.visible) continue;
    o.updateWorldMatrix(true, false);
    let dist = Infinity;
    if (l.type === 'area' || l.type === 'overhead') {
      const hw = Math.max(0.05, (l.areaWidth ?? 2)) / 2, hh = Math.max(0.05, (l.areaHeight ?? 2)) / 2;
      a.set(-hw, -hh, 0).applyMatrix4(o.matrixWorld); b.set(hw, -hh, 0).applyMatrix4(o.matrixWorld);
      c.set(hw, hh, 0).applyMatrix4(o.matrixWorld); d.set(-hw, hh, 0).applyMatrix4(o.matrixWorld);
      const h1 = ray.intersectTriangle(a, b, c, false, tri), h2 = h1 ? null : ray.intersectTriangle(a, c, d, false, tri);
      const hp = h1 ?? h2;
      if (hp) {
        const loc = o.worldToLocal(hp.clone());
        const edge = Math.min(hw - Math.abs(loc.x), hh - Math.abs(loc.y));
        const nearEdge = edge < Math.max(0.1, 0.07 * Math.min(hw, hh) * 2);
        const nearCentre = Math.hypot(loc.x, loc.y) < Math.max(0.15, 0.12 * Math.min(hw, hh) * 2);
        if (firstSurfaceDist === null || nearEdge || nearCentre) dist = hp.distanceTo(ray.origin);
      }
    }
    if (!isFinite(dist)) {
      o.getWorldPosition(p);
      const along = p.clone().sub(ray.origin).dot(ray.direction);
      if (along > 0 && ray.distanceToPoint(p) < Math.max(0.2, along * 0.03)) dist = along;
    }
    if (dist < bestDist) { bestDist = dist; bestId = l.id; }
  }
  if (bestId && (firstSurfaceDist === null || bestDist < firstSurfaceDist + 0.01)) return bestId;
  return null;
}

/** First scene surface under a raycaster, ignoring editor dressing (gizmo handles, helpers, hidden meshes, the floor). */
export function pickSurface(scene: THREE.Scene, raycaster: THREE.Raycaster): THREE.Intersection | null {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj.name === '__floor__') return;
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      if (!o.visible || o.userData?.isHelper || o.userData?.isProxy) return;
    }
    meshes.push(obj);
  });
  return raycaster.intersectObjects(meshes, false)[0] ?? null;
}
