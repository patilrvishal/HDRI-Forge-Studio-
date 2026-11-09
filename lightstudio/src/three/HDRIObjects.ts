import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { findObjectByKey } from './objectBinding';
import { useObjectHdriStore } from '../store/objectHdriStore';

interface CastMesh {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  inverse: THREE.Matrix4;
  /** World-space bounds: most rays miss most objects, and this test is far cheaper than walking a BVH. */
  box: THREE.Box3;
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
/** World distance under which the capture point counts as lying on a surface. */
const ON_SURFACE = 1e-3;
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
  private normal = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

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
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld).expandByScalar(1e-3);
        caster.meshes.push({
          mesh: m,
          bvh,
          box,
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

  // Which objects can a ray in a given direction possibly hit? A coarse equirectangular grid answers that with one lookup,
  // so each pixel only tests the handful of objects in its cell instead of every object in the scene.
  private static readonly GW = 128;
  private static readonly GH = 64;
  private grid: number[][] | null = null;
  private gridOrigin = new THREE.Vector3(NaN, NaN, NaN);
  private sphere = new THREE.Sphere();
  private cellDir = new THREE.Vector3();
  private toC = new THREE.Vector3();

  private buildGrid(origin: THREE.Vector3): void {
    const GW = HdriObjectCaster.GW, GH = HdriObjectCaster.GH;
    const cells: number[][] = Array.from({ length: GW * GH }, () => []);
    const cellRad = Math.hypot(Math.PI / GH, (2 * Math.PI) / GW) * 0.75 + 0.01;       // generous half-diagonal of a cell
    this.meshes.forEach((c, mi) => {
      c.box.getBoundingSphere(this.sphere);
      this.toC.copy(this.sphere.center).sub(origin);
      const d = this.toC.length();
      if (d <= this.sphere.radius * 1.001) { for (const cell of cells) cell.push(mi); return; }     // the viewer is inside it: every direction
      this.toC.divideScalar(d);
      const ang = Math.asin(Math.min(1, this.sphere.radius / d)) + cellRad;
      const cosAng = Math.cos(Math.min(Math.PI, ang));
      for (let gy = 0; gy < GH; gy++) {
        const phi = ((gy + 0.5) / GH) * Math.PI;
        for (let gx = 0; gx < GW; gx++) {
          const theta = ((gx + 0.5) / GW - 0.5) * 2 * Math.PI;
          this.cellDir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
          if (this.cellDir.dot(this.toC) >= cosAng) cells[gy * GW + gx].push(mi);
        }
      }
    });
    this.grid = cells;
    this.gridOrigin.copy(origin);
  }

  cast(origin: THREE.Vector3, dir: THREE.Vector3): ObjectHit | null {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir);
    if (!this.grid || !this.gridOrigin.equals(origin)) this.buildGrid(origin);
    const GW = HdriObjectCaster.GW, GH = HdriObjectCaster.GH;
    const gx = Math.min(GW - 1, Math.max(0, Math.floor((Math.atan2(dir.z, dir.x) / (2 * Math.PI) + 0.5) * GW)));
    const gy = Math.min(GH - 1, Math.max(0, Math.floor((Math.acos(Math.max(-1, Math.min(1, dir.y))) / Math.PI) * GH)));
    const candidates = this.grid![gy * GW + gx];
    let best: ObjectHit | null = null;
    for (let ci = 0; ci < candidates.length; ci++) {
      const c = this.meshes[candidates[ci]];
      if (!this.ray.intersectsBox(c.box) && !c.box.containsPoint(origin)) continue;      // large flat objects (floor, walls) pass the grid for every direction: their tight box still rejects most rays
      this.local.copy(this.ray).applyMatrix4(c.inverse);
      const hit = c.bvh.raycastFirst(this.local, THREE.DoubleSide);
      if (!hit) continue;
      this.tmp.copy(hit.point).applyMatrix4(c.mesh.matrixWorld);
      const dist = this.tmp.distanceTo(origin);
      // The capture point sits ON this surface (a plane added at the origin, a floor at the capture height).
      // Every ray starts on it, so every direction "hits" at distance 0 and the whole map used to turn into the
      // object. Treat the viewer as standing just on one side of it instead: it is seen only in the directions
      // that point into it. A ground-like plane is viewed from above (you see it below the horizon, whichever way
      // it faces); any other surface is viewed from its front face.
      if (dist < ON_SURFACE && hit.face) {
        const n = this.normal.copy(hit.face.normal).transformDirection(c.mesh.matrixWorld);
        const side = Math.abs(n.y) > 0.7 ? this.up : n;
        if (dir.dot(side) >= 0) continue;
      }
      if (!best || dist < best.dist) {
        best = { dist, r: c.color.r, g: c.color.g, b: c.color.b, alpha: c.opacity };
      }
    }
    return best;
  }
}
