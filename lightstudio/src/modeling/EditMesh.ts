/**
 * EditMesh - a small polygon mesh (BMesh-like) used by the modelling tools.
 *
 * Vertices are positions, faces are CCW loops of vertex indices (n-gons
 * allowed) and edges are derived from the faces plus an explicit set of loose
 * (wire) edges. Everything is plain arrays so it can be unit-tested outside
 * the browser and cloned cheaply for undo.
 */

export type V3 = [number, number, number];

export const EK_M = 1048576;
/** Order-independent numeric key for the edge a-b (vertex ids < 1,048,576). */
export const ek = (a: number, b: number): number => (a < b ? a * EK_M + b : b * EK_M + a);
export const ekLo = (k: number): number => Math.floor(k / EK_M);
export const ekHi = (k: number): number => k % EK_M;

export interface EdgeInfo {
  key: number;
  a: number;
  b: number;
  /** Indices of faces using this edge. */
  faces: number[];
}

export type SelectMode = 'vert' | 'edge' | 'face';

export class Selection {
  v = new Set<number>();
  e = new Set<number>();
  f = new Set<number>();
  /** Most recently picked element (drawn white, used as the "active" one). */
  active: { type: SelectMode; id: number } | null = null;

  clone(): Selection {
    const s = new Selection();
    s.v = new Set(this.v);
    s.e = new Set(this.e);
    s.f = new Set(this.f);
    s.active = this.active ? { ...this.active } : null;
    return s;
  }
  clear(): void {
    this.v.clear();
    this.e.clear();
    this.f.clear();
    this.active = null;
  }
  get count(): number {
    return this.v.size + this.e.size + this.f.size;
  }
}

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  lerp: (a: V3, b: V3, t: number): V3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  dist: (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  mid: (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  copy: (a: V3): V3 => [a[0], a[1], a[2]],
};

export class EditMesh {
  co: V3[] = [];
  faces: number[][] = [];
  /** Loose (wire) edges: edges that are not part of any face. */
  loose = new Set<number>();
  /** Edge flags (kept in sync when indices are remapped). */
  seam = new Set<number>();
  sharp = new Set<number>();
  /** Hidden vertices (faces/edges touching them are hidden too). */
  hidden = new Set<number>();
  /** Per-mesh shading flag (Blender: Shade Smooth / Shade Flat). */
  smooth = false;
  /** Bumped on every topology/position change (used as a cache key). */
  version = 0;

  private _edges: Map<number, EdgeInfo> | null = null;
  private _vf: number[][] | null = null;

  clone(): EditMesh {
    const m = new EditMesh();
    m.co = this.co.map((p) => [p[0], p[1], p[2]] as V3);
    m.faces = this.faces.map((f) => f.slice());
    m.loose = new Set(this.loose);
    m.seam = new Set(this.seam);
    m.sharp = new Set(this.sharp);
    m.hidden = new Set(this.hidden);
    m.smooth = this.smooth;
    m.version = this.version;
    return m;
  }

  /** Invalidate derived data. Call after any mutation. */
  touch(): void {
    this.version++;
    this._edges = null;
    this._vf = null;
  }

  // ── Construction ───────────────────────────────────────────────────────
  addVert(p: V3): number {
    this.co.push([p[0], p[1], p[2]]);
    return this.co.length - 1;
  }
  addFace(loop: number[]): number {
    this.faces.push(loop.slice());
    return this.faces.length - 1;
  }
  addLoose(a: number, b: number): void {
    if (a !== b) this.loose.add(ek(a, b));
  }

  // ── Derived topology ───────────────────────────────────────────────────
  edgeMap(): Map<number, EdgeInfo> {
    if (this._edges) return this._edges;
    const map = new Map<number, EdgeInfo>();
    for (let fi = 0; fi < this.faces.length; fi++) {
      const f = this.faces[fi];
      for (let i = 0; i < f.length; i++) {
        const a = f[i];
        const b = f[(i + 1) % f.length];
        const k = ek(a, b);
        let e = map.get(k);
        if (!e) {
          e = { key: k, a: Math.min(a, b), b: Math.max(a, b), faces: [] };
          map.set(k, e);
        }
        e.faces.push(fi);
      }
    }
    for (const k of this.loose) {
      if (!map.has(k)) map.set(k, { key: k, a: ekLo(k), b: ekHi(k), faces: [] });
    }
    this._edges = map;
    return map;
  }

  edgeFaces(k: number): number[] {
    return this.edgeMap().get(k)?.faces ?? [];
  }

  vertFaces(): number[][] {
    if (this._vf) return this._vf;
    const vf: number[][] = Array.from({ length: this.co.length }, () => []);
    for (let fi = 0; fi < this.faces.length; fi++) {
      for (const v of this.faces[fi]) vf[v].push(fi);
    }
    this._vf = vf;
    return vf;
  }

  /** Edge keys incident to each vertex. */
  vertEdges(): number[][] {
    const ve: number[][] = Array.from({ length: this.co.length }, () => []);
    for (const e of this.edgeMap().values()) {
      ve[e.a].push(e.key);
      ve[e.b].push(e.key);
    }
    return ve;
  }

  faceEdgeKeys(fi: number): number[] {
    const f = this.faces[fi];
    const out: number[] = [];
    for (let i = 0; i < f.length; i++) out.push(ek(f[i], f[(i + 1) % f.length]));
    return out;
  }

  faceNormal(fi: number): V3 {
    return newellNormal(this.co, this.faces[fi]);
  }
  faceCenter(fi: number): V3 {
    const f = this.faces[fi];
    const c: V3 = [0, 0, 0];
    for (const v of f) {
      c[0] += this.co[v][0];
      c[1] += this.co[v][1];
      c[2] += this.co[v][2];
    }
    return [c[0] / f.length, c[1] / f.length, c[2] / f.length];
  }

  vertNormal(v: number): V3 {
    const n: V3 = [0, 0, 0];
    for (const fi of this.vertFaces()[v]) {
      const fn = newellNormal(this.co, this.faces[fi]);
      n[0] += fn[0];
      n[1] += fn[1];
      n[2] += fn[2];
    }
    return v3.norm(n);
  }

  // ── Structural mutation helpers ────────────────────────────────────────

  /**
   * Remove vertices in `dead` (plus every face / loose edge that uses them),
   * compacting indices. Returns old->new index map (-1 for removed).
   */
  removeVerts(dead: Set<number>): Int32Array {
    const map = new Int32Array(this.co.length).fill(-1);
    const co: V3[] = [];
    for (let i = 0; i < this.co.length; i++) {
      if (dead.has(i)) continue;
      map[i] = co.length;
      co.push(this.co[i]);
    }
    const faces: number[][] = [];
    for (const f of this.faces) {
      if (f.some((v) => dead.has(v))) continue;
      faces.push(f.map((v) => map[v]));
    }
    this.co = co;
    this.faces = faces;
    this.loose = remapKeySet(this.loose, map);
    this.seam = remapKeySet(this.seam, map);
    this.sharp = remapKeySet(this.sharp, map);
    const hid = new Set<number>();
    for (const h of this.hidden) if (map[h] >= 0) hid.add(map[h]);
    this.hidden = hid;
    this.touch();
    return map;
  }

  /** Vertices that belong to no face and no edge. */
  orphanVerts(): Set<number> {
    const used = new Uint8Array(this.co.length);
    for (const f of this.faces) for (const v of f) used[v] = 1;
    for (const k of this.loose) {
      used[ekLo(k)] = 1;
      used[ekHi(k)] = 1;
    }
    const s = new Set<number>();
    for (let i = 0; i < used.length; i++) if (!used[i]) s.add(i);
    return s;
  }

  /** Drop faces (by index) without touching vertices. Returns the old->new face map. */
  dropFaces(dead: Set<number>): Int32Array {
    const map = new Int32Array(this.faces.length).fill(-1);
    const faces: number[][] = [];
    for (let i = 0; i < this.faces.length; i++) {
      if (dead.has(i)) continue;
      map[i] = faces.length;
      faces.push(this.faces[i]);
    }
    this.faces = faces;
    this.touch();
    return map;
  }

  /** Remove degenerate faces (fewer than 3 distinct verts / repeated consecutive verts). */
  cleanupFaces(): void {
    const out: number[][] = [];
    for (const f of this.faces) {
      const g: number[] = [];
      for (let i = 0; i < f.length; i++) {
        const v = f[i];
        if (g.length && g[g.length - 1] === v) continue;
        g.push(v);
      }
      while (g.length > 1 && g[0] === g[g.length - 1]) g.pop();
      if (g.length >= 3 && new Set(g).size === g.length) out.push(g);
    }
    this.faces = out;
    this.touch();
  }

  /** Make sure every edge of every face that is also flagged loose is not loose. */
  pruneLoose(): void {
    const em = this.edgeMap();
    for (const k of Array.from(this.loose)) {
      if ((em.get(k)?.faces.length ?? 0) > 0) this.loose.delete(k);
    }
  }
}

export function remapKeySet(set: Set<number>, map: Int32Array): Set<number> {
  const out = new Set<number>();
  for (const k of set) {
    const a = map[ekLo(k)];
    const b = map[ekHi(k)];
    if (a >= 0 && b >= 0 && a !== b) out.add(ek(a, b));
  }
  return out;
}

export function newellNormal(co: V3[], loop: number[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = co[loop[i]];
    const b = co[loop[(i + 1) % loop.length]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return v3.norm([x, y, z]);
}

/** Stats in Blender's order: vertices, edges, faces. */
export function meshCounts(m: EditMesh): [number, number, number] {
  return [m.co.length, m.edgeMap().size, m.faces.length];
}

// ── Selection helpers ────────────────────────────────────────────────────

/** Recompute the two "derived" selection sets from the authoritative one. */
export function flushSelection(m: EditMesh, s: Selection, mode: SelectMode): void {
  if (mode === 'vert') {
    s.e.clear();
    s.f.clear();
    for (const e of m.edgeMap().values()) {
      if (s.v.has(e.a) && s.v.has(e.b)) s.e.add(e.key);
    }
    for (let fi = 0; fi < m.faces.length; fi++) {
      if (m.faces[fi].every((v) => s.v.has(v))) s.f.add(fi);
    }
  } else if (mode === 'edge') {
    // Drop selected edges that no longer exist, derive verts and faces.
    const em = m.edgeMap();
    for (const k of Array.from(s.e)) if (!em.has(k)) s.e.delete(k);
    s.v.clear();
    s.f.clear();
    for (const k of s.e) {
      s.v.add(ekLo(k));
      s.v.add(ekHi(k));
    }
    for (let fi = 0; fi < m.faces.length; fi++) {
      const f = m.faces[fi];
      let all = true;
      for (let i = 0; i < f.length; i++) {
        if (!s.e.has(ek(f[i], f[(i + 1) % f.length]))) {
          all = false;
          break;
        }
      }
      if (all) s.f.add(fi);
    }
  } else {
    for (const fi of Array.from(s.f)) if (fi >= m.faces.length) s.f.delete(fi);
    s.v.clear();
    s.e.clear();
    for (const fi of s.f) {
      const f = m.faces[fi];
      for (let i = 0; i < f.length; i++) {
        s.v.add(f[i]);
        s.e.add(ek(f[i], f[(i + 1) % f.length]));
      }
    }
  }
}

/** Switch selection mode the way Blender does (keeps only fully selected higher elements). */
export function convertSelectMode(m: EditMesh, s: Selection, from: SelectMode, to: SelectMode): void {
  if (from === to) return;
  if (to === 'vert') {
    // Vertices stay as they are (derived from edges/faces when coming down).
    if (from === 'edge' || from === 'face') {
      /* s.v is already the union of endpoints */
    }
    flushSelection(m, s, 'vert');
  } else if (to === 'edge') {
    if (from === 'vert') flushSelection(m, s, 'vert'); // edges with both verts selected
    // Keep only selected edges; recompute verts from them.
    flushSelection(m, s, 'edge');
  } else {
    if (from === 'vert') flushSelection(m, s, 'vert');
    else if (from === 'edge') flushSelection(m, s, 'edge');
    flushSelection(m, s, 'face');
  }
  if (s.active && s.active.type !== to) s.active = null;
}

export function selectAll(m: EditMesh, s: Selection): void {
  s.v.clear();
  s.e.clear();
  s.f.clear();
  for (let i = 0; i < m.co.length; i++) if (!m.hidden.has(i)) s.v.add(i);
  for (const e of m.edgeMap().values()) if (!m.hidden.has(e.a) && !m.hidden.has(e.b)) s.e.add(e.key);
  for (let i = 0; i < m.faces.length; i++) if (!m.faces[i].some((v) => m.hidden.has(v))) s.f.add(i);
}

export function selectedVertexList(m: EditMesh, s: Selection): number[] {
  const out: number[] = [];
  for (const v of s.v) if (v < m.co.length) out.push(v);
  return out;
}

/** Median of the selected vertices (Blender's default pivot). */
export function selectionMedian(m: EditMesh, s: Selection): V3 {
  const c: V3 = [0, 0, 0];
  let n = 0;
  for (const v of s.v) {
    const p = m.co[v];
    if (!p) continue;
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
    n++;
  }
  return n ? [c[0] / n, c[1] / n, c[2] / n] : c;
}

export function selectionBoundsCenter(m: EditMesh, s: Selection): V3 {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (const v of s.v) {
    const p = m.co[v];
    if (!p) continue;
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
    n++;
  }
  return n ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
}

/** Average normal of the selection (used to orient "Normal" transform / extrude). */
export function selectionNormal(m: EditMesh, s: Selection): V3 {
  const n: V3 = [0, 0, 0];
  if (s.f.size) {
    for (const fi of s.f) {
      const fn = m.faceNormal(fi);
      n[0] += fn[0];
      n[1] += fn[1];
      n[2] += fn[2];
    }
  } else {
    for (const v of s.v) {
      const vn = m.vertNormal(v);
      n[0] += vn[0];
      n[1] += vn[1];
      n[2] += vn[2];
    }
  }
  return v3.norm(n);
}
