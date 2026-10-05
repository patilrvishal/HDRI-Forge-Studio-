import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { findObjectByKey } from './objectBinding';
import { useObjectHdriStore } from '../store/objectHdriStore';

interface CastMesh {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  inverse: THREE.Matrix4;
  color: THREE.Color;
  opacity: number;
}

export interface ObjectHit {
  /** World-space distance from the capture point. */
  dist: number;
  r: number;
  g: number;
  b: number;
  /** 0-1 */
  alpha: number;
}

const MAX_TRIS = 1_500_000;
const bvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH>();

function bvhFor(geometry: THREE.BufferGeometry): MeshBVH | null {
  const existing = (geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree ?? bvhCache.get(geometry);
  if (existing) return existing;
  const tris = geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
  if (!tris || tris > MAX_TRIS) return null;
  try {
    const bvh = new MeshBVH(geometry);
    bvhCache.set(geometry, bvh);
    return bvh;
  } catch {
    return null;
  }
}

/**
 * Ray-casts the objects the user has switched to "Include in HDRI" so the
 * exporter can paint their real silhouette (and occlude lights behind them).
 */
export class HdriObjectCaster {
  private meshes: CastMesh[] = [];
  private ray = new THREE.Ray();
  private local = new THREE.Ray();
  private tmp = new THREE.Vector3();

  static build(scene: THREE.Scene): HdriObjectCaster | null {
    const settings = useObjectHdriStore.getState().settings;
    const keys = Object.keys(settings).filter((k) => settings[k].include);
    if (!keys.length) return null;
    const caster = new HdriObjectCaster();
    scene.updateMatrixWorld(true);
    for (const key of keys) {
      const cfg = settings[key];
      const obj = findObjectByKey(scene, key);
      if (!obj || !obj.visible) continue;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || o.userData?.isHelper || o.userData?.isProxy || !m.geometry) return;
        const bvh = bvhFor(m.geometry);
        if (!bvh) return;
        let color = new THREE.Color(1, 1, 1);
        if (cfg.colorMode === 'custom') color = new THREE.Color(cfg.color);
        else {
          const mat = Array.isArray(m.material) ? m.material[0] : m.material;
          const c = (mat as THREE.MeshStandardMaterial | undefined)?.color;
          if (c) color = c.clone();
        }
        color.multiplyScalar(Math.max(0, cfg.intensity));
        caster.meshes.push({
          mesh: m,
          bvh,
          inverse: new THREE.Matrix4().copy(m.matrixWorld).invert(),
          color,
          opacity: Math.max(0, Math.min(1, cfg.opacity / 100)),
        });
      });
    }
    return caster.meshes.length ? caster : null;
  }

  get count(): number {
    return this.meshes.length;
  }

  cast(origin: THREE.Vector3, dir: THREE.Vector3): ObjectHit | null {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir);
    let best: ObjectHit | null = null;
    for (const c of this.meshes) {
      this.local.copy(this.ray).applyMatrix4(c.inverse);
      const hit = c.bvh.raycastFirst(this.local, THREE.DoubleSide);
      if (!hit) continue;
      this.tmp.copy(hit.point).applyMatrix4(c.mesh.matrixWorld);
      const dist = this.tmp.distanceTo(origin);
      if (!best || dist < best.dist) {
        best = { dist, r: c.color.r, g: c.color.g, b: c.color.b, alpha: c.opacity };
      }
    }
    return best;
  }
}
