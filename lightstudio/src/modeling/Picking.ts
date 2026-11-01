import * as THREE from 'three';
import { ekLo, ekHi, v3, type V3 } from './EditMesh';
import type { EditableObject } from './EditableObject';

export interface PickCtx {
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  obj: EditableObject;
  xray: boolean;
}

export interface Screen {
  x: number;
  y: number;
  /** false when the point is behind the camera */
  ok: boolean;
}

const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export function toWorld(obj: EditableObject, p: V3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p[0], p[1], p[2]).applyMatrix4(obj.object.matrixWorld);
}

export function projectWorld(camera: THREE.Camera, w: number, h: number, world: THREE.Vector3): Screen {
  _v.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const ok = _v.z < 0;
  _v.copy(world).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, ok };
}

export function projectAll(ctx: PickCtx): Screen[] {
  ctx.obj.object.updateMatrixWorld(true);
  ctx.camera.updateMatrixWorld(true);
  const out: Screen[] = [];
  const w = new THREE.Vector3();
  for (const p of ctx.obj.mesh.co) out.push(projectWorld(ctx.camera, ctx.width, ctx.height, toWorld(ctx.obj, p, w)));
  return out;
}

/** True if nothing else on the object sits between the camera and `world`. */
export function isVisible(ctx: PickCtx, world: THREE.Vector3): boolean {
  if (ctx.xray) return true;
  const origin = ctx.camera.position;
  const dir = world.clone().sub(origin);
  const dist = dir.length();
  if (dist < 1e-6) return true;
  dir.normalize();
  _ray.set(origin, dir);
  _ray.near = 0;
  _ray.far = dist;
  const hits = _ray.intersectObject(ctx.obj.object, false);
  if (!hits.length) return true;
  return hits[0].distance >= dist - Math.max(1e-4, dist * 1e-3);
}

export function mouseRay(ctx: PickCtx, mx: number, my: number): THREE.Raycaster {
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2((mx / ctx.width) * 2 - 1, -(my / ctx.height) * 2 + 1), ctx.camera);
  return r;
}

export function pickVertex(ctx: PickCtx, mx: number, my: number, radius: number, screen?: Screen[]): number {
  const S = screen ?? projectAll(ctx);
  const m = ctx.obj.mesh;
  const cands: { i: number; d: number }[] = [];
  for (let i = 0; i < S.length; i++) {
    if (!S[i].ok || m.hidden.has(i)) continue;
    const d = Math.hypot(S[i].x - mx, S[i].y - my);
    if (d <= radius) cands.push({ i, d });
  }
  cands.sort((a, b) => a.d - b.d);
  const w = new THREE.Vector3();
  for (const c of cands) {
    if (isVisible(ctx, toWorld(ctx.obj, m.co[c.i], w))) return c.i;
  }
  return -1;
}

export interface EdgePick {
  key: number;
  /** parameter along the edge from lower to higher vertex index */
  t: number;
  dist: number;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

export function pickEdge(ctx: PickCtx, mx: number, my: number, radius: number, screen?: Screen[]): EdgePick | null {
  const S = screen ?? projectAll(ctx);
  const m = ctx.obj.mesh;
  const cands: EdgePick[] = [];
  for (const e of m.edgeMap().values()) {
    const a = S[e.a];
    const b = S[e.b];
    if (!a.ok || !b.ok || m.hidden.has(e.a) || m.hidden.has(e.b)) continue;
    const { d, t } = distToSegment(mx, my, a.x, a.y, b.x, b.y);
    if (d <= radius) cands.push({ key: e.key, t, dist: d });
  }
  cands.sort((x, y) => x.dist - y.dist);
  const w = new THREE.Vector3();
  for (const c of cands) {
    const pa = m.co[ekLo(c.key)];
    const pb = m.co[ekHi(c.key)];
    if (isVisible(ctx, toWorld(ctx.obj, v3.lerp(pa, pb, c.t), w))) return c;
  }
  return null;
}

/** Face under the cursor (raycast) - or the nearest face centre in X-ray mode. */
export function pickFace(ctx: PickCtx, mx: number, my: number, screen?: Screen[]): { face: number; point: THREE.Vector3 } | null {
  const m = ctx.obj.mesh;
  const ray = mouseRay(ctx, mx, my);
  if (!ctx.xray) {
    const hits = ray.intersectObject(ctx.obj.object, false);
    if (!hits.length) return null;
    const h = hits[0];
    const tri = h.faceIndex ?? -1;
    if (tri < 0) return null;
    return { face: ctx.obj.triToFace[tri], point: h.point.clone() };
  }
  const S = screen ?? projectAll(ctx);
  let best = -1;
  let bd = 40;
  const w = new THREE.Vector3();
  for (let fi = 0; fi < m.faces.length; fi++) {
    if (m.faces[fi].some((v) => m.hidden.has(v))) continue;
    const c = m.faceCenter(fi);
    const sp = projectWorld(ctx.camera, ctx.width, ctx.height, toWorld(ctx.obj, c, w));
    if (!sp.ok) continue;
    const d = Math.hypot(sp.x - mx, sp.y - my);
    if (d < bd) {
      bd = d;
      best = fi;
    }
  }
  if (best < 0) {
    // Fall back to polygon containment.
    const hits = ray.intersectObject(ctx.obj.object, false);
    if (!hits.length) return null;
    return { face: ctx.obj.triToFace[hits[0].faceIndex ?? 0], point: hits[0].point.clone() };
  }
  return { face: best, point: toWorld(ctx.obj, m.faceCenter(best)) };
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Segment-segment intersection in 2D. Returns (t along a, u along b) or null. */
export function segIntersect(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number]): { t: number; u: number } | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

export function pickCtxFor(camera: THREE.PerspectiveCamera, width: number, height: number, obj: EditableObject, xray: boolean): PickCtx {
  return { camera, width, height, obj, xray };
}
