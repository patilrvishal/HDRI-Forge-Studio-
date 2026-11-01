/**
 * What LightPaint can click on, and exactly where.
 *
 * Why this is its own class rather than `Raycaster.intersectObjects(allMeshes)`:
 *  - three's raycaster ignores `visible`, so a hidden variant or collision mesh in front of the paint stole the
 *    click and the light landed somewhere the user never pointed. Only meshes that are really drawn count here.
 *  - On a multi-million-triangle car the brute-force raycast takes tens to hundreds of milliseconds per call, which
 *    is what made dragging feel heavy. Each mesh gets a BVH (built once per geometry and cached), so a pick is
 *    well under a millisecond and a drag costs nothing.
 *  - The normal handed back is the smooth normal the shader reflects off, correct for scaled meshes, and always
 *    turned to face the viewer, so a back face can never put the light inside the model.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { smoothNormalAt } from './LightPaint';

export interface PaintHit {
  /** World-space surface point under the cursor. */
  point: THREE.Vector3;
  /** World-space smooth surface normal, facing the viewer. */
  normal: THREE.Vector3;
  /** Distance from the ray origin. */
  distance: number;
  object: THREE.Mesh;
}

interface PickEntry {
  mesh: THREE.Mesh;
  bvh: MeshBVH | null;
}

/** Above this many triangles a BVH build costs more than it is worth; the mesh falls back to three's raycast. */
const MAX_BVH_TRIS = 4_000_000;
/** Meshes this transparent are not something you can paint on (you would be aiming through them). */
const MIN_OPACITY = 0.05;

const bvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH | null>();

function triangleCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
}

function bvhFor(g: THREE.BufferGeometry): MeshBVH | null {
  const cached = bvhCache.get(g);
  if (cached !== undefined) return cached;
  const existing = (g as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree;
  if (existing) { bvhCache.set(g, existing); return existing; }
  let bvh: MeshBVH | null = null;
  if (triangleCount(g) > 0 && triangleCount(g) <= MAX_BVH_TRIS && g.attributes.position) {
    try { bvh = new MeshBVH(g); } catch { bvh = null; }
  }
  bvhCache.set(g, bvh);
  return bvh;
}

/** True when a mesh should be treated as part of the model the user is painting on. */
export function isPaintable(obj: THREE.Object3D): boolean {
  const m = obj as THREE.Mesh;
  if (!m.isMesh || !m.geometry || obj.name === '__floor__') return false;
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (!o.visible) return false;
    const u = o.userData;
    if (u && (u.isHelper || u.isProxy || u.isGrid || u.noPaint)) return false;
  }
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.some((mat) => mat && mat.visible !== false && (mat.opacity ?? 1) >= MIN_OPACITY);
}

export class PaintPicker {
  private entries: PickEntry[] = [];
  private readonly local = new THREE.Ray();
  private readonly inverse = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();

  /** Collect the paintable meshes. Cheap enough to call at the start of every drag. */
  refresh(scene: THREE.Object3D): void {
    scene.updateMatrixWorld(true);
    const next: PickEntry[] = [];
    scene.traverseVisible((obj) => {
      if (!isPaintable(obj)) return;
      const mesh = obj as THREE.Mesh;
      next.push({ mesh, bvh: bvhFor(mesh.geometry) });
    });
    this.entries = next;
  }

  /**
   * Build the BVHs of every paintable mesh now, a few at a time, so the first click on a big model is instant
   * instead of stalling while it builds. Resolves when done; safe to ignore the promise.
   */
  async prepare(scene: THREE.Object3D, budgetMs = 8): Promise<void> {
    this.refresh(scene);
    let start = performance.now();
    for (const e of this.entries) {
      bvhFor(e.mesh.geometry);
      if (performance.now() - start > budgetMs) {
        await new Promise((r) => setTimeout(r, 0));
        start = performance.now();
      }
    }
  }

  get count(): number {
    return this.entries.length;
  }

  pick(ray: THREE.Ray): PaintHit | null {
    let best: { dist: number; mesh: THREE.Mesh; point: THREE.Vector3; face: THREE.Face | null } | null = null;

    for (const e of this.entries) {
      const mesh = e.mesh;
      let point: THREE.Vector3 | null = null;
      let face: THREE.Face | null = null;

      if (e.bvh) {
        this.inverse.copy(mesh.matrixWorld).invert();
        this.local.copy(ray).applyMatrix4(this.inverse);
        const hit = e.bvh.raycastFirst(this.local, THREE.DoubleSide);
        if (!hit) continue;
        point = hit.point.clone().applyMatrix4(mesh.matrixWorld);
        face = (hit.face as THREE.Face | null | undefined) ?? null;
      } else {
        // Very heavy mesh: three's own (slower) raycast, so it can still be painted on.
        const rc = new THREE.Raycaster(ray.origin, ray.direction);
        const hit = rc.intersectObject(mesh, false)[0];
        if (!hit) continue;
        point = hit.point.clone();
        face = hit.face ?? null;
      }

      const dist = this.tmp.copy(point).sub(ray.origin).length();
      if (!best || dist < best.dist) best = { dist, mesh, point, face };
    }

    if (!best) return null;

    const normal = smoothNormalAt({ face: best.face, object: best.mesh, point: best.point } as unknown as THREE.Intersection);
    if (normal.dot(ray.direction) > 0) normal.negate();      // always face the viewer
    return { point: best.point, normal, distance: best.dist, object: best.mesh };
  }
}
