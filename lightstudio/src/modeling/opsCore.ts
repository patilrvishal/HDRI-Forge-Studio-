import {
  EditMesh,
  Selection,
  ek,
  ekLo,
  ekHi,
  flushSelection,
  selectionMedian,
  v3,
  type SelectMode,
  type V3,
} from './EditMesh';
import { triangulateLoop } from './triangulate';

/**
 * Core mesh operators. Each one mutates the mesh + selection in place and
 * returns false when it could not do anything (so the UI can say so).
 */

// ── Shared helpers ────────────────────────────────────────────────────────

export interface Chain {
  verts: number[];
  closed: boolean;
}

/** Order a set of edge keys into vertex chains / cycles. */
export function edgeChains(keys: Iterable<number>): Chain[] {
  const adj = new Map<number, number[]>();
  const unused = new Set<number>();
  for (const k of keys) {
    unused.add(k);
    const a = ekLo(k);
    const b = ekHi(k);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const chains: Chain[] = [];
  const walk = (start: number): Chain => {
    const verts = [start];
    let cur = start;
    for (;;) {
      const nb = (adj.get(cur) ?? []).find((n) => unused.has(ek(cur, n)));
      if (nb === undefined) break;
      unused.delete(ek(cur, nb));
      verts.push(nb);
      cur = nb;
      if (cur === start) return { verts: verts.slice(0, -1), closed: true };
    }
    return { verts, closed: false };
  };
  // Open chains first (start at degree-1 vertices), then cycles.
  for (const [v, nbs] of adj) {
    if (nbs.length === 1) {
      while ((adj.get(v) ?? []).some((n) => unused.has(ek(v, n)))) chains.push(walk(v));
    }
  }
  for (const [v] of adj) {
    while ((adj.get(v) ?? []).some((n) => unused.has(ek(v, n)))) chains.push(walk(v));
  }
  return chains;
}

/** Insert cut vertices along edges (positions ordered from the lower-index endpoint). */
export function insertEdgeVerts(m: EditMesh, cuts: Map<number, V3[]>): Map<number, number[]> {
  const ids = new Map<number, number[]>();
  for (const [k, pts] of cuts) ids.set(k, pts.map((p) => m.addVert(p)));
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    let touched = false;
    const out: number[] = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      out.push(a);
      const arr = ids.get(ek(a, b));
      if (arr) {
        touched = true;
        if (a < b) out.push(...arr);
        else for (let j = arr.length - 1; j >= 0; j--) out.push(arr[j]);
      }
    }
    if (touched) m.faces[fi] = out;
  }
  const replaceFlag = (set: Set<number>) => {
    for (const [k, arr] of ids) {
      if (!set.has(k)) continue;
      set.delete(k);
      const chain = [ekLo(k), ...arr, ekHi(k)];
      for (let i = 0; i + 1 < chain.length; i++) set.add(ek(chain[i], chain[i + 1]));
    }
  };
  replaceFlag(m.loose);
  replaceFlag(m.seam);
  replaceFlag(m.sharp);
  m.touch();
  return ids;
}

/** Split face `fi` along the chord a-b. Returns the two resulting face indices. */
export function splitFace(m: EditMesh, fi: number, a: number, b: number): [number, number] | null {
  const f = m.faces[fi];
  const n = f.length;
  const ia = f.indexOf(a);
  const ib = f.indexOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return null;
  if ((ia + 1) % n === ib || (ib + 1) % n === ia) return null;
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  const f1 = f.slice(lo, hi + 1);
  const f2 = [...f.slice(hi), ...f.slice(0, lo + 1)];
  m.faces[fi] = f1;
  m.faces.push(f2);
  m.touch();
  return [fi, m.faces.length - 1];
}

/** Merge two faces across the shared edge (they must reference it in opposite order). */
function mergeFacePair(m: EditMesh, fa: number, fb: number, a: number, b: number): number[] | null {
  const A = m.faces[fa];
  const B = m.faces[fb];
  const ia = A.indexOf(a);
  const nA = A.length;
  // A must contain a->b or b->a
  let s = -1;
  if (A[(ia + 1) % nA] === b) s = (ia + 1) % nA; // A: ... a, b ...; rotate to start at b
  else if (A[(ia + nA - 1) % nA] === b) return mergeFacePair(m, fa, fb, b, a);
  if (s < 0) return null;
  const Ar = [...A.slice(s), ...A.slice(0, s)]; // b ... a
  const ja = B.indexOf(a);
  const nB = B.length;
  if (B[(ja + nB - 1) % nB] !== b && B[(ja + 1) % nB] !== b) return null;
  // B must run b->a, i.e. a comes right after b.
  if (B[ja] !== a || B[(ja + nB - 1) % nB] !== b) return null;
  const Br = [...B.slice(ja), ...B.slice(0, ja)]; // a ... b
  const merged = [...Ar, ...Br.slice(1, Br.length - 1)];
  return merged;
}

export function faceCentroid(m: EditMesh, f: number[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const v of f) {
    c[0] += m.co[v][0];
    c[1] += m.co[v][1];
    c[2] += m.co[v][2];
  }
  return [c[0] / f.length, c[1] / f.length, c[2] / f.length];
}

// ── Delete ────────────────────────────────────────────────────────────────

export type DeleteType = 'verts' | 'edges' | 'faces' | 'onlyEdgesFaces' | 'onlyFaces';

export function deleteSelection(m: EditMesh, s: Selection, type: DeleteType): boolean {
  if (s.count === 0) return false;
  if (type === 'verts') {
    m.removeVerts(new Set(s.v));
  } else if (type === 'edges') {
    const dead = new Set<number>();
    const em = m.edgeMap();
    for (const k of s.e) for (const fi of em.get(k)?.faces ?? []) dead.add(fi);
    keepEdgesOfDroppedFaces(m, dead, s.e);
    for (const k of s.e) {
      m.loose.delete(k);
      m.seam.delete(k);
      m.sharp.delete(k);
    }
  } else if (type === 'faces') {
    const dead = new Set(s.f);
    // Edges/verts used only by the deleted faces disappear with them.
    const usedElsewhereV = new Uint8Array(m.co.length);
    for (let fi = 0; fi < m.faces.length; fi++) {
      if (dead.has(fi)) continue;
      for (const v of m.faces[fi]) usedElsewhereV[v] = 1;
    }
    for (const k of m.loose) {
      usedElsewhereV[ekLo(k)] = 1;
      usedElsewhereV[ekHi(k)] = 1;
    }
    const victims = new Set<number>();
    for (const fi of dead) for (const v of m.faces[fi]) if (!usedElsewhereV[v]) victims.add(v);
    m.dropFaces(dead);
    if (victims.size) m.removeVerts(victims);
  } else if (type === 'onlyFaces') {
    const dead = new Set(s.f);
    keepEdgesOfDroppedFaces(m, dead, new Set());
  } else {
    m.dropFaces(new Set(s.f));
    for (const k of s.e) {
      m.loose.delete(k);
    }
  }
  s.clear();
  m.touch();
  return true;
}

/** Drop faces, keeping their edges as wire edges when nothing else uses them. */
function keepEdgesOfDroppedFaces(m: EditMesh, dead: Set<number>, exclude: Set<number>): void {
  const keys = new Set<number>();
  for (const fi of dead) for (const k of m.faceEdgeKeys(fi)) keys.add(k);
  m.dropFaces(dead);
  const em = m.edgeMap();
  for (const k of keys) {
    if (exclude.has(k)) continue;
    if (!(em.get(k)?.faces.length)) m.loose.add(k);
  }
  m.touch();
}

// ── Dissolve ──────────────────────────────────────────────────────────────

/** Merge all faces around `v` into one, then remove `v` from that face. */
function dissolveVertexFaces(m: EditMesh, v: number): boolean {
  const vf = m.vertFaces()[v];
  if (vf.length === 0) return false;
  // Directed edges of all faces around v; shared internal edges cancel out.
  const dir = new Map<string, [number, number]>();
  for (const fi of vf) {
    const f = m.faces[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      const back = `${b}>${a}`;
      if (dir.has(back)) dir.delete(back);
      else dir.set(`${a}>${b}`, [a, b]);
    }
  }
  const next = new Map<number, number>();
  for (const [a, b] of dir.values()) {
    if (next.has(a)) return false; // pinched region
    next.set(a, b);
  }
  const start = dir.values().next().value as [number, number] | undefined;
  if (!start) return false;
  const loop: number[] = [];
  let cur = start[0];
  let guard = dir.size + 2;
  while (guard-- > 0) {
    loop.push(cur);
    const n = next.get(cur);
    if (n === undefined) return false;
    cur = n;
    if (cur === start[0]) break;
  }
  if (loop.length !== dir.size) return false; // several loops (region with hole)
  const cleaned = loop.filter((x) => x !== v);
  if (cleaned.length < 3) return false;
  const drop = new Set(vf);
  const keep = m.faces.filter((_, i) => !drop.has(i));
  keep.push(cleaned);
  m.faces = keep;
  m.touch();
  return true;
}

export function dissolveVerts(m: EditMesh, s: Selection, _mode: SelectMode): boolean {
  const dead = new Set<number>();
  for (const v of Array.from(s.v)) {
    if (v >= m.co.length) continue;
    const vf = m.vertFaces()[v];
    if (vf.length > 0) {
      if (vf.length === 1) {
        // Boundary corner of a single face: just drop it from the loop.
        const f = m.faces[vf[0]];
        if (f.length > 3) {
          m.faces[vf[0]] = f.filter((x) => x !== v);
          m.touch();
          dead.add(v);
        }
      } else if (dissolveVertexFaces(m, v)) {
        dead.add(v);
      }
      continue;
    }
    // Wire vertex.
    const ve = m.vertEdges()[v];
    if (ve.length === 2) {
      const a = ekLo(ve[0]) === v ? ekHi(ve[0]) : ekLo(ve[0]);
      const b = ekLo(ve[1]) === v ? ekHi(ve[1]) : ekLo(ve[1]);
      m.loose.delete(ve[0]);
      m.loose.delete(ve[1]);
      m.addLoose(a, b);
      dead.add(v);
    } else if (ve.length <= 1) {
      dead.add(v);
    }
  }
  if (!dead.size) return false;
  m.removeVerts(dead);
  s.clear();
  return true;
}

export function dissolveEdges(m: EditMesh, s: Selection, useVerts = true): boolean {
  let changed = false;
  const touchedVerts = new Set<number>();
  for (const k of Array.from(s.e)) {
    const a = ekLo(k);
    const b = ekHi(k);
    if (a >= m.co.length || b >= m.co.length) continue;
    const info = m.edgeMap().get(k);
    if (!info) continue;
    if (info.faces.length === 0) {
      m.loose.delete(k);
      m.touch();
      changed = true;
      touchedVerts.add(a);
      touchedVerts.add(b);
    } else if (info.faces.length === 2 && info.faces[0] !== info.faces[1]) {
      const merged = mergeFacePair(m, info.faces[0], info.faces[1], a, b);
      if (!merged) continue;
      const drop = new Set(info.faces);
      const keep = m.faces.filter((_, i) => !drop.has(i));
      keep.push(merged);
      m.faces = keep;
      m.seam.delete(k);
      m.sharp.delete(k);
      m.touch();
      changed = true;
      touchedVerts.add(a);
      touchedVerts.add(b);
    }
  }
  if (!changed) return false;
  if (useVerts) {
    const dead = new Set<number>();
    for (const v of touchedVerts) {
      const ve = m.vertEdges()[v];
      const vf = m.vertFaces()[v];
      if (ve.length === 2 && vf.length >= 1) {
        // Only fully interior valence-2 verts (or boundary ones on a single face) collapse.
        for (const fi of vf) {
          const f = m.faces[fi];
          if (f.length > 3) m.faces[fi] = f.filter((x) => x !== v);
        }
        dead.add(v);
      } else if (ve.length === 0) {
        dead.add(v);
      }
    }
    if (dead.size) {
      m.touch();
      m.removeVerts(dead);
    }
  }
  s.clear();
  return true;
}

export function dissolveFaces(m: EditMesh, s: Selection, useVerts = false): boolean {
  if (s.f.size < 2) return false;
  const faces = Array.from(s.f);
  // Union-find over selected faces sharing an edge.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const f of faces) parent.set(f, f);
  const em = m.edgeMap();
  for (const e of em.values()) {
    const sel = e.faces.filter((f) => s.f.has(f));
    for (let i = 1; i < sel.length; i++) parent.set(find(sel[i]), find(sel[0]));
  }
  const groups = new Map<number, number[]>();
  for (const f of faces) {
    const r = find(f);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(f);
  }
  const drop = new Set<number>();
  const adds: number[][] = [];
  const usedVerts: number[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const dir = new Map<string, [number, number]>();
    for (const fi of g) {
      const f = m.faces[fi];
      for (let i = 0; i < f.length; i++) {
        const a = f[i];
        const b = f[(i + 1) % f.length];
        const back = `${b}>${a}`;
        if (dir.has(back)) dir.delete(back);
        else dir.set(`${a}>${b}`, [a, b]);
      }
    }
    const next = new Map<number, number>();
    let ok = true;
    for (const [a, b] of dir.values()) {
      if (next.has(a)) ok = false;
      next.set(a, b);
    }
    if (!ok || !dir.size) continue;
    const first = dir.values().next().value as [number, number];
    const loop: number[] = [];
    let cur = first[0];
    let guard = dir.size + 2;
    while (guard-- > 0) {
      loop.push(cur);
      const n = next.get(cur);
      if (n === undefined) break;
      cur = n;
      if (cur === first[0]) break;
    }
    if (loop.length !== dir.size || loop.length < 3) continue;
    for (const fi of g) drop.add(fi);
    adds.push(loop);
    usedVerts.push(...loop);
  }
  if (!adds.length) return false;
  const keep = m.faces.filter((_, i) => !drop.has(i));
  keep.push(...adds);
  m.faces = keep;
  m.touch();
  // Interior vertices that lost all their faces disappear.
  const orphan = m.orphanVerts();
  const dead = new Set<number>();
  for (const v of orphan) if (v < m.co.length) dead.add(v);
  if (useVerts) {
    for (const v of usedVerts) {
      if (m.vertEdges()[v].length === 2) {
        for (const fi of m.vertFaces()[v]) {
          const f = m.faces[fi];
          if (f.length > 3) m.faces[fi] = f.filter((x) => x !== v);
        }
        dead.add(v);
      }
    }
  }
  if (dead.size) m.removeVerts(dead);
  s.clear();
  return true;
}

/** Blender's Limited Dissolve: merge coplanar faces and collinear edges. */
export function limitedDissolve(m: EditMesh, s: Selection, angleLimit: number): boolean {
  const cosL = Math.cos(angleLimit);
  const target = s.f.size ? s.f : new Set<number>(m.faces.map((_, i) => i));
  const pick = new Selection();
  const em = m.edgeMap();
  for (const e of em.values()) {
    if (e.faces.length !== 2) continue;
    const [fa, fb] = e.faces;
    if (!target.has(fa) || !target.has(fb)) continue;
    if (v3.dot(m.faceNormal(fa), m.faceNormal(fb)) >= cosL) {
      pick.f.add(fa);
      pick.f.add(fb);
    }
  }
  let changed = false;
  if (pick.f.size >= 2) changed = dissolveFaces(m, pick, false);
  // Collinear valence-2 vertices along boundaries.
  const dead = new Set<number>();
  const ve = m.vertEdges();
  const vf = m.vertFaces();
  for (let v = 0; v < m.co.length; v++) {
    if (ve[v].length !== 2 || vf[v].length === 0) continue;
    if (s.f.size && !vf[v].every((fi) => target.has(fi))) continue;
    const a = ekLo(ve[v][0]) === v ? ekHi(ve[v][0]) : ekLo(ve[v][0]);
    const b = ekLo(ve[v][1]) === v ? ekHi(ve[v][1]) : ekLo(ve[v][1]);
    const d1 = v3.norm(v3.sub(m.co[v], m.co[a]));
    const d2 = v3.norm(v3.sub(m.co[b], m.co[v]));
    if (v3.dot(d1, d2) >= cosL) {
      for (const fi of vf[v]) {
        const f = m.faces[fi];
        if (f.length > 3) m.faces[fi] = f.filter((x) => x !== v);
      }
      dead.add(v);
    }
  }
  if (dead.size) {
    m.touch();
    m.removeVerts(dead);
    changed = true;
  }
  s.clear();
  return changed;
}

// ── Merge ─────────────────────────────────────────────────────────────────

export type MergeType = 'center' | 'cursor' | 'first' | 'last' | 'collapse';

function applyMerge(m: EditMesh, target: Map<number, number>, positions: Map<number, V3>): void {
  for (const [v, p] of positions) m.co[v] = [p[0], p[1], p[2]];
  const remap = (v: number) => target.get(v) ?? v;
  m.faces = m.faces.map((f) => f.map(remap));
  const rmk = (set: Set<number>) => {
    const out = new Set<number>();
    for (const k of set) {
      const a = remap(ekLo(k));
      const b = remap(ekHi(k));
      if (a !== b) out.add(ek(a, b));
    }
    return out;
  };
  m.loose = rmk(m.loose);
  m.seam = rmk(m.seam);
  m.sharp = rmk(m.sharp);
  m.touch();
  m.cleanupFaces();
  m.pruneLoose();
  m.removeVerts(new Set(target.keys()));
}

export function mergeVerts(m: EditMesh, s: Selection, type: MergeType, cursor: V3 = [0, 0, 0], activeVert?: number): boolean {
  if (type === 'collapse') {
    if (!s.e.size) return false;
    const chains = edgeChains(s.e);
    // Connected components of selected edges (chains may split at branches).
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      if (!parent.has(x)) parent.set(x, x);
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    for (const k of s.e) parent.set(find(ekLo(k)), find(ekHi(k)));
    void chains;
    const groups = new Map<number, number[]>();
    for (const v of parent.keys()) {
      const r = find(v);
      (groups.get(r) ?? groups.set(r, []).get(r)!).push(v);
    }
    const target = new Map<number, number>();
    const positions = new Map<number, V3>();
    const survivors: number[] = [];
    for (const g of groups.values()) {
      const keep = Math.min(...g);
      const c: V3 = [0, 0, 0];
      for (const v of g) {
        c[0] += m.co[v][0];
        c[1] += m.co[v][1];
        c[2] += m.co[v][2];
      }
      positions.set(keep, [c[0] / g.length, c[1] / g.length, c[2] / g.length]);
      for (const v of g) if (v !== keep) target.set(v, keep);
      survivors.push(keep);
    }
    const survivorPos = survivors.map((v) => positions.get(v)!);
    applyMerge(m, target, positions);
    // Selection: the merged verts (indices shifted by removal, so find by position).
    s.clear();
    survivorPos.forEach((p) => {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < m.co.length; i++) {
        const d = v3.dist(m.co[i], p);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) s.v.add(best);
    });
    return true;
  }
  const verts = Array.from(s.v).sort((a, b) => a - b);
  if (verts.length < 2) return false;
  let pos: V3;
  let keep = verts[0];
  if (type === 'center') pos = selectionMedian(m, s);
  else if (type === 'cursor') pos = cursor;
  else if (type === 'first') pos = m.co[verts[0]];
  else {
    keep = activeVert !== undefined && s.v.has(activeVert) ? activeVert : verts[verts.length - 1];
    pos = m.co[keep];
  }
  pos = v3.copy(pos);
  const target = new Map<number, number>();
  for (const v of verts) if (v !== keep) target.set(v, keep);
  applyMerge(m, target, new Map([[keep, pos]]));
  s.clear();
  // Surviving vertex index after compaction:
  let idx = keep;
  for (const v of verts) if (v !== keep && v < keep) idx--;
  s.v.add(idx);
  return true;
}

export function mergeByDistance(m: EditMesh, s: Selection | null, threshold: number): number {
  const cand = s && s.v.size ? Array.from(s.v) : m.co.map((_, i) => i);
  const cell = Math.max(threshold, 1e-9);
  const grid = new Map<string, number[]>();
  const key = (p: V3) => `${Math.floor(p[0] / cell)}_${Math.floor(p[1] / cell)}_${Math.floor(p[2] / cell)}`;
  const target = new Map<number, number>();
  for (const v of cand) {
    const p = m.co[v];
    let found = -1;
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    const cz = Math.floor(p[2] / cell);
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx}_${cy + dy}_${cz + dz}`);
          if (!list) continue;
          for (const u of list) {
            if (v3.dist(m.co[u], p) <= threshold) {
              found = u;
              break outer;
            }
          }
        }
      }
    }
    if (found >= 0) target.set(v, found);
    else (grid.get(key(p)) ?? grid.set(key(p), []).get(key(p))!).push(v);
  }
  if (!target.size) return 0;
  const removed = target.size;
  applyMerge(m, target, new Map());
  if (s) s.clear();
  return removed;
}

// ── Faces: poke / triangulate / quads / flip ──────────────────────────────

export function pokeFaces(m: EditMesh, s: Selection, offset = 0, relative = false): boolean {
  if (!s.f.size) return false;
  const drop = new Set(s.f);
  const adds: number[][] = [];
  const newVerts: number[] = [];
  for (const fi of s.f) {
    const f = m.faces[fi];
    const c = faceCentroid(m, f);
    const n = m.faceNormal(fi);
    let off = offset;
    if (relative) {
      let r = 0;
      for (const v of f) r += v3.dist(m.co[v], c);
      off = offset * (r / f.length);
    }
    const cv = m.addVert(v3.add(c, v3.scale(n, off)));
    newVerts.push(cv);
    for (let i = 0; i < f.length; i++) adds.push([cv, f[i], f[(i + 1) % f.length]]);
  }
  m.faces = m.faces.filter((_, i) => !drop.has(i)).concat(adds);
  m.touch();
  s.clear();
  for (const v of newVerts) s.v.add(v);
  return true;
}

export function triangulateFaces(m: EditMesh, s: Selection): boolean {
  const target = s.f.size ? s.f : new Set<number>();
  if (!target.size) return false;
  const out: number[][] = [];
  let changed = false;
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    if (!target.has(fi) || f.length === 3) {
      out.push(f);
      continue;
    }
    changed = true;
    for (const t of triangulateLoop(m.co, f)) out.push(t);
  }
  if (!changed) return false;
  m.faces = out;
  m.touch();
  s.clear();
  return true;
}

export function trisToQuads(m: EditMesh, s: Selection, angleLimit = (40 * Math.PI) / 180): boolean {
  const target = s.f.size ? s.f : new Set<number>();
  const cosL = Math.cos(angleLimit);
  const em = m.edgeMap();
  type Cand = { fa: number; fb: number; a: number; b: number; score: number };
  const cands: Cand[] = [];
  for (const e of em.values()) {
    if (e.faces.length !== 2) continue;
    const [fa, fb] = e.faces;
    if (!target.has(fa) || !target.has(fb)) continue;
    if (m.faces[fa].length !== 3 || m.faces[fb].length !== 3) continue;
    const d = v3.dot(m.faceNormal(fa), m.faceNormal(fb));
    if (d < cosL) continue;
    // Prefer shapes closest to a rectangle: shorter shared edge relative to quad diagonal.
    cands.push({ fa, fb, a: e.a, b: e.b, score: -d });
  }
  cands.sort((x, y) => x.score - y.score);
  const used = new Set<number>();
  const drop = new Set<number>();
  const adds: number[][] = [];
  for (const c of cands) {
    if (used.has(c.fa) || used.has(c.fb)) continue;
    const merged = mergeFacePair(m, c.fa, c.fb, c.a, c.b);
    if (!merged || merged.length !== 4) continue;
    // Reject concave results.
    const n = m.faceNormal(c.fa);
    let convex = true;
    for (let i = 0; i < 4; i++) {
      const p = m.co[merged[i]];
      const q = m.co[merged[(i + 1) % 4]];
      const r = m.co[merged[(i + 2) % 4]];
      if (v3.dot(v3.cross(v3.sub(q, p), v3.sub(r, q)), n) < -1e-9) convex = false;
    }
    if (!convex) continue;
    used.add(c.fa);
    used.add(c.fb);
    drop.add(c.fa);
    drop.add(c.fb);
    adds.push(merged);
  }
  if (!adds.length) return false;
  m.faces = m.faces.filter((_, i) => !drop.has(i)).concat(adds);
  m.touch();
  s.clear();
  return true;
}

export function flipNormals(m: EditMesh, s: Selection): boolean {
  const target = s.f.size ? s.f : new Set<number>(m.faces.map((_, i) => i));
  for (const fi of target) m.faces[fi] = m.faces[fi].slice().reverse();
  m.touch();
  return true;
}

// ── Duplicate / separate / split ──────────────────────────────────────────

/** Duplicate the selection in place; the duplicate becomes the selection. */
export function duplicateSelection(m: EditMesh, s: Selection, mode: SelectMode): boolean {
  if (!s.v.size) return false;
  const map = new Map<number, number>();
  for (const v of s.v) map.set(v, m.addVert(m.co[v]));
  for (const fi of s.f) m.addFace(m.faces[fi].map((v) => map.get(v)!));
  for (const k of s.e) {
    const a = ekLo(k);
    const b = ekHi(k);
    if (!m.edgeMap().get(k)?.faces.length || !Array.from(s.f).some((fi) => m.faces[fi].includes(a) && m.faces[fi].includes(b))) {
      m.addLoose(map.get(a)!, map.get(b)!);
    }
  }
  m.touch();
  s.clear();
  for (const v of map.values()) s.v.add(v);
  flushSelection(m, s, 'vert');
  if (mode === 'face') flushSelection(m, s, 'face');
  return true;
}

/** Pull the selection out into a new mesh (Blender's Separate > Selection). */
export function separateSelection(m: EditMesh, s: Selection): EditMesh | null {
  if (!s.v.size) return null;
  const out = new EditMesh();
  out.smooth = m.smooth;
  const map = new Map<number, number>();
  for (const v of s.v) map.set(v, out.addVert(m.co[v]));
  for (const fi of s.f) out.addFace(m.faces[fi].map((v) => map.get(v)!));
  const em = m.edgeMap();
  for (const k of s.e) {
    const info = em.get(k);
    if (!info || info.faces.every((fi) => !s.f.has(fi))) {
      if (map.has(ekLo(k)) && map.has(ekHi(k))) out.addLoose(map.get(ekLo(k))!, map.get(ekHi(k))!);
    }
  }
  out.touch();
  // Remove from the source: faces first, then vertices no longer referenced.
  const dropF = new Set(s.f);
  const usedElsewhere = new Uint8Array(m.co.length);
  for (let fi = 0; fi < m.faces.length; fi++) {
    if (dropF.has(fi)) continue;
    for (const v of m.faces[fi]) usedElsewhere[v] = 1;
  }
  m.dropFaces(dropF);
  for (const k of Array.from(m.loose)) {
    if (s.e.has(k) && !usedElsewhere[ekLo(k)] && !usedElsewhere[ekHi(k)]) m.loose.delete(k);
  }
  const kill = new Set<number>();
  for (const v of s.v) if (!usedElsewhere[v]) kill.add(v);
  const stillUsed = new Uint8Array(m.co.length);
  for (const k of m.loose) {
    stillUsed[ekLo(k)] = 1;
    stillUsed[ekHi(k)] = 1;
  }
  for (const v of Array.from(kill)) if (stillUsed[v]) kill.delete(v);
  if (kill.size) m.removeVerts(kill);
  m.touch();
  s.clear();
  return out;
}

/** Split (Y): detach the selection from the surrounding geometry, keeping it in place. */
export function splitSelection(m: EditMesh, s: Selection, mode: SelectMode): boolean {
  if (!s.f.size) return false;
  const map = new Map<number, number>();
  const dupOf = (v: number): number => {
    let d = map.get(v);
    if (d === undefined) {
      d = m.addVert(m.co[v]);
      map.set(v, d);
    }
    return d;
  };
  for (const fi of s.f) m.faces[fi] = m.faces[fi].map(dupOf);
  m.touch();
  const orphans = m.orphanVerts();
  const dead = new Set<number>();
  for (const v of orphans) dead.add(v);
  // Map selection before compaction.
  const newSel = new Set<number>(map.values());
  const remap = dead.size ? m.removeVerts(dead) : null;
  s.clear();
  for (const v of newSel) {
    const nv = remap ? remap[v] : v;
    if (nv >= 0) s.v.add(nv);
  }
  flushSelection(m, s, 'vert');
  if (mode === 'face') flushSelection(m, s, 'face');
  return true;
}

// ── Fill ──────────────────────────────────────────────────────────────────

/** F: make an edge or face from the selection (Blender's edge_face_add). */
export function makeEdgeFace(m: EditMesh, s: Selection): boolean {
  const verts = Array.from(s.v);
  if (verts.length < 2) return false;
  if (verts.length === 2 && s.e.size === 0) {
    m.addLoose(verts[0], verts[1]);
    m.touch();
    s.e.add(ek(verts[0], verts[1]));
    return true;
  }
  // Prefer the loop formed by the selected edges.
  const loops = edgeChains(s.e).filter((c) => c.closed && c.verts.length >= 3);
  let made = false;
  for (const c of loops) {
    // Skip loops that are already a face.
    const set = new Set(c.verts);
    const exists = m.faces.some((f) => f.length === c.verts.length && f.every((v) => set.has(v)));
    if (exists) continue;
    m.addFace(orientLoopByNeighbors(m, c.verts));
    made = true;
  }
  if (!made) {
    // Open chain of edges or bare vertices: order around the centroid and close it.
    let ordered: number[];
    const chains = edgeChains(s.e).filter((c) => !c.closed);
    if (chains.length === 1 && chains[0].verts.length >= 3 && chains[0].verts.length === verts.length) {
      ordered = chains[0].verts;
    } else if (verts.length >= 3) {
      ordered = orderAroundCentroid(m, verts);
    } else return false;
    m.addFace(orientLoopByNeighbors(m, ordered));
    made = true;
  }
  m.pruneLoose();
  m.touch();
  return made;
}

/** Wind a fresh loop so it matches neighbouring faces (or faces +Y when free-standing). */
function orientLoopByNeighbors(m: EditMesh, loop: number[]): number[] {
  const em = m.edgeMap();
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const info = em.get(ek(a, b));
    if (info && info.faces.length) {
      const f = m.faces[info.faces[0]];
      const ia = f.indexOf(a);
      const forward = f[(ia + 1) % f.length] === b;
      // Neighbour uses a->b: our loop must use b->a. Reverse if we go a->b.
      return forward ? loop.slice().reverse() : loop.slice();
    }
  }
  const n = newellNormalOf(m, loop);
  return n[1] >= 0 ? loop.slice() : loop.slice().reverse();
}

function newellNormalOf(m: EditMesh, loop: number[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = m.co[loop[i]];
    const b = m.co[loop[(i + 1) % loop.length]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

function orderAroundCentroid(m: EditMesh, verts: number[]): number[] {
  const c: V3 = [0, 0, 0];
  for (const v of verts) {
    c[0] += m.co[v][0] / verts.length;
    c[1] += m.co[v][1] / verts.length;
    c[2] += m.co[v][2] / verts.length;
  }
  // Best-fit plane normal via Newell of the unsorted list is unreliable; use the covariance's smallest axis.
  let n = v3.norm(newellNormalOf(m, verts));
  if (v3.len(n) < 1e-6) {
    const a = v3.sub(m.co[verts[1]], m.co[verts[0]]);
    const b = v3.sub(m.co[verts[2]], m.co[verts[0]]);
    n = v3.norm(v3.cross(a, b));
  }
  const u = v3.norm(v3.sub(m.co[verts[0]], c));
  const w = v3.cross(n, u);
  return verts
    .map((v) => {
      const d = v3.sub(m.co[v], c);
      return { v, a: Math.atan2(v3.dot(d, w), v3.dot(d, u)) };
    })
    .sort((p, q) => p.a - q.a)
    .map((x) => x.v);
}

/** Alt+F "Fill": triangulate every closed loop of selected boundary edges. */
export function fillHoles(m: EditMesh, s: Selection): boolean {
  const em = m.edgeMap();
  const keys = Array.from(s.e).filter((k) => (em.get(k)?.faces.length ?? 0) < 2);
  const loops = edgeChains(keys).filter((c) => c.closed && c.verts.length >= 3);
  if (!loops.length) return false;
  for (const c of loops) {
    const loop = orientLoopByNeighbors(m, c.verts);
    for (const t of triangulateLoop(m.co, loop)) m.addFace(t);
  }
  m.pruneLoose();
  m.touch();
  return true;
}

/** Grid Fill: fill a closed loop with quads (loop length must be even). */
export function gridFill(m: EditMesh, s: Selection, span?: number, offset = 0): boolean {
  const em = m.edgeMap();
  const keys = Array.from(s.e).filter((k) => (em.get(k)?.faces.length ?? 0) < 2);
  const loops = edgeChains(keys).filter((c) => c.closed);
  if (!loops.length) return false;
  let did = false;
  for (const c of loops) {
    const n = c.verts.length;
    if (n < 4 || n % 2 !== 0) continue;
    const half = n / 2;
    const w = span && span > 0 && span < half ? span : Math.max(1, Math.floor(half / 2));
    const h = half - w;
    // Rotate so the first corner starts at `offset`.
    const start = ((offset % n) + n) % n;
    const L = c.verts.slice(start).concat(c.verts.slice(0, start));
    // Sides: bottom L[0..w], right L[w..w+h], top (reversed) L[w+h..2w+h], left L[2w+h..n].
    const bottom = L.slice(0, w + 1);
    const right = L.slice(w, w + h + 1);
    const top = L.slice(w + h, 2 * w + h + 1).reverse();
    const left = L.slice(2 * w + h).concat(L[0]).reverse();
    // Coons patch on a (w+1) x (h+1) grid.
    const grid: number[][] = Array.from({ length: h + 1 }, () => new Array(w + 1).fill(-1));
    for (let i = 0; i <= w; i++) {
      grid[0][i] = bottom[i];
      grid[h][i] = top[i];
    }
    for (let j = 0; j <= h; j++) {
      grid[j][0] = left[j];
      grid[j][w] = right[j];
    }
    const P = (v: number) => m.co[v];
    for (let j = 1; j < h; j++) {
      for (let i = 1; i < w; i++) {
        const u = i / w;
        const t = j / h;
        const p: V3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const bl = P(bottom[0])[k];
          const br = P(bottom[w])[k];
          const tl = P(top[0])[k];
          const tr = P(top[w])[k];
          p[k] =
            (1 - t) * P(bottom[i])[k] +
            t * P(top[i])[k] +
            (1 - u) * P(left[j])[k] +
            u * P(right[j])[k] -
            ((1 - u) * (1 - t) * bl + u * (1 - t) * br + (1 - u) * t * tl + u * t * tr);
        }
        grid[j][i] = m.addVert(p);
      }
    }
    const faces: number[][] = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        faces.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
      }
    }
    // Wind to match the surrounding mesh (or +Y).
    const ref = orientLoopByNeighbors(m, c.verts);
    const refN = newellNormalOf(m, ref);
    for (const f of faces) {
      const fn = newellNormalOf(m, f);
      m.addFace(v3.dot(fn, refN) >= 0 ? f : f.slice().reverse());
    }
    did = true;
  }
  if (did) {
    m.pruneLoose();
    m.touch();
  }
  return did;
}

// ── Subdivide ─────────────────────────────────────────────────────────────

export function subdivide(m: EditMesh, s: Selection, mode: SelectMode, cuts = 1, smoothness = 0): boolean {
  const edges = new Set(s.e);
  if (!edges.size) return false;
  const em = m.edgeMap();
  // Classify faces before topology changes.
  type FacePlan = { fi: number; f: number[]; sel: boolean[] };
  const plans: FacePlan[] = [];
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    const sel = f.map((v, i) => edges.has(ek(v, f[(i + 1) % f.length])));
    if (sel.some(Boolean)) plans.push({ fi, f: f.slice(), sel });
  }
  // New vertices on every selected edge.
  const cutPts = new Map<number, V3[]>();
  for (const k of edges) {
    if (!em.has(k)) continue;
    const a = m.co[ekLo(k)];
    const b = m.co[ekHi(k)];
    const pts: V3[] = [];
    for (let i = 1; i <= cuts; i++) pts.push(v3.lerp(a, b, i / (cuts + 1)));
    cutPts.set(k, pts);
  }
  // Remember which faces we will rebuild, then insert vertices on the edges.
  const rebuild = new Set(plans.map((p) => p.fi));
  const idsByEdge = insertEdgeVerts(m, cutPts);
  const edgeVerts = (a: number, b: number): number[] => {
    const ids = idsByEdge.get(ek(a, b));
    if (!ids) return [];
    return a < b ? ids : ids.slice().reverse();
  };
  const drop = new Set<number>();
  const adds: number[][] = [];
  for (const p of plans) {
    const { fi, f, sel } = p;
    const n = f.length;
    const selCount = sel.filter(Boolean).length;
    if (n === 4 && selCount === 4) {
      // Grid subdivide.
      const bottom = [f[0], ...edgeVerts(f[0], f[1]), f[1]];
      const right = [f[1], ...edgeVerts(f[1], f[2]), f[2]];
      const top = [f[3], ...edgeVerts(f[3], f[2]).slice(), f[2]]; // left->right along top
      const left = [f[0], ...edgeVerts(f[0], f[3]), f[3]];
      const w = cuts + 1;
      const grid: number[][] = Array.from({ length: w + 1 }, () => new Array(w + 1).fill(-1));
      for (let i = 0; i <= w; i++) {
        grid[0][i] = bottom[i];
        grid[w][i] = top[i];
        grid[i][0] = left[i];
        grid[i][w] = right[i];
      }
      for (let j = 1; j < w; j++) {
        for (let i = 1; i < w; i++) {
          const u = i / w;
          const t = j / w;
          const pp: V3 = [0, 0, 0];
          for (let kk = 0; kk < 3; kk++) {
            pp[kk] =
              (1 - t) * m.co[bottom[i]][kk] +
              t * m.co[top[i]][kk] +
              (1 - u) * m.co[left[j]][kk] +
              u * m.co[right[j]][kk] -
              ((1 - u) * (1 - t) * m.co[f[0]][kk] + u * (1 - t) * m.co[f[1]][kk] + (1 - u) * t * m.co[f[3]][kk] + u * t * m.co[f[2]][kk]);
          }
          grid[j][i] = m.addVert(pp);
        }
      }
      for (let j = 0; j < w; j++) {
        for (let i = 0; i < w; i++) {
          adds.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
        }
      }
      drop.add(fi);
      continue;
    }
    if (n === 4 && selCount === 2 && sel[0] === sel[2]) {
      // Opposite edges: strips of quads.
      const e0 = sel[0] ? 0 : 1;
      const A = [f[e0], ...edgeVerts(f[e0], f[(e0 + 1) % 4]), f[(e0 + 1) % 4]];
      const B = [f[(e0 + 3) % 4], ...edgeVerts(f[(e0 + 3) % 4], f[(e0 + 2) % 4]), f[(e0 + 2) % 4]];
      for (let i = 0; i <= cuts; i++) adds.push([A[i], A[i + 1], B[i + 1], B[i]]);
      drop.add(fi);
      continue;
    }
    if (n === 3 && selCount === 3) {
      const ab = edgeVerts(f[0], f[1]);
      const bc = edgeVerts(f[1], f[2]);
      const ca = edgeVerts(f[2], f[0]);
      if (cuts === 1) {
        adds.push([f[0], ab[0], ca[0]], [ab[0], f[1], bc[0]], [ca[0], bc[0], f[2]], [ab[0], bc[0], ca[0]]);
        drop.add(fi);
        continue;
      }
    }
    if (n === 4 && selCount === 2 && sel[0] !== sel[2] && cuts === 1) {
      // Adjacent pair -> corner cut.
      const i0 = sel.findIndex((x, i) => x && sel[(i + 1) % 4]);
      const va = edgeVerts(f[i0], f[(i0 + 1) % 4])[0];
      const vb = edgeVerts(f[(i0 + 1) % 4], f[(i0 + 2) % 4])[0];
      adds.push([va, f[(i0 + 1) % 4], vb]);
      adds.push([f[i0], va, vb, f[(i0 + 2) % 4], f[(i0 + 3) % 4]]);
      drop.add(fi);
      continue;
    }
    if (selCount === n && n > 4 && cuts === 1) {
      const c = m.addVert(faceCentroid(m, f));
      for (let i = 0; i < n; i++) {
        const prevMid = edgeVerts(f[(i + n - 1) % n], f[i])[0];
        const nextMid = edgeVerts(f[i], f[(i + 1) % n])[0];
        adds.push([f[i], nextMid, c, prevMid]);
      }
      drop.add(fi);
    }
  }
  void rebuild;
  if (drop.size) {
    m.faces = m.faces.filter((_, i) => !drop.has(i)).concat(adds);
  }
  if (smoothness > 0) {
    // Push new verts towards the average of their edge neighbours (approximation of Blender's smooth).
    const ve = m.vertEdges();
    for (const ids of idsByEdge.values()) {
      for (const v of ids) {
        const nb = ve[v].map((k) => (ekLo(k) === v ? ekHi(k) : ekLo(k)));
        if (!nb.length) continue;
        const avg: V3 = [0, 0, 0];
        for (const u of nb) {
          avg[0] += m.co[u][0] / nb.length;
          avg[1] += m.co[u][1] / nb.length;
          avg[2] += m.co[u][2] / nb.length;
        }
        m.co[v] = v3.lerp(m.co[v], avg, smoothness * 0.5);
      }
    }
  }
  m.touch();
  // New selection: all cut verts and (in face mode) the sub faces come along via flush.
  s.clear();
  const sv = new Set<number>();
  for (const k of edges) {
    if (!em.has(k)) continue;
    sv.add(ekLo(k));
    sv.add(ekHi(k));
  }
  for (const ids of idsByEdge.values()) for (const v of ids) sv.add(v);
  for (const v of sv) s.v.add(v);
  flushSelection(m, s, 'vert');
  if (mode === 'edge') {
    // Keep only edges whose endpoints are both in the set.
  }
  return true;
}

// ── Connect ───────────────────────────────────────────────────────────────

/** J: connect selected vertices that share a face (splitting the face). */
export function connectVerts(m: EditMesh, s: Selection): boolean {
  if (s.v.size < 2) return false;
  let did = false;
  // Process each face containing >= 2 selected verts.
  const queue: number[] = [];
  const vf = m.vertFaces();
  const seen = new Set<number>();
  for (const v of s.v) for (const fi of vf[v]) if (!seen.has(fi)) {
    seen.add(fi);
    queue.push(fi);
  }
  const done = new Set<number>();
  while (queue.length) {
    const fi = queue.shift()!;
    if (done.has(fi)) continue;
    const f = m.faces[fi];
    const inFace = f.filter((v) => s.v.has(v));
    if (inFace.length < 2) continue;
    done.add(fi);
    if (inFace.length === 2) {
      const r = splitFace(m, fi, inFace[0], inFace[1]);
      if (r) {
        did = true;
        done.add(r[1]);
      }
    } else {
      // Chain in loop order, skipping pairs that are already adjacent.
      let cur = fi;
      let curVerts = inFace.slice();
      for (let i = 0; i + 1 < curVerts.length; i++) {
        const a = curVerts[i];
        const b = curVerts[i + 1];
        const target = m.faces[cur].includes(a) && m.faces[cur].includes(b) ? cur : m.faces.length - 1;
        const r = splitFace(m, target, a, b);
        if (r) {
          did = true;
          cur = m.faces[r[0]].includes(curVerts[i + 1]) && m.faces[r[0]].includes(curVerts[i + 2] ?? -1) ? r[0] : r[1];
        }
      }
      curVerts = [];
    }
  }
  if (did) {
    for (const [i, v] of Array.from(s.v).entries()) void (i + v);
  }
  return did;
}

// ── Solidify / smooth / rotate / spin ─────────────────────────────────────

export function solidify(m: EditMesh, s: Selection, thickness: number, offset = 0): boolean {
  const target = s.f.size ? s.f : new Set<number>(m.faces.map((_, i) => i));
  if (!target.size) return false;
  const verts = new Set<number>();
  for (const fi of target) for (const v of m.faces[fi]) verts.add(v);
  // Per-vertex normal from the selected faces.
  const vn = new Map<number, V3>();
  for (const v of verts) vn.set(v, [0, 0, 0]);
  for (const fi of target) {
    const n = m.faceNormal(fi);
    for (const v of m.faces[fi]) {
      const a = vn.get(v)!;
      a[0] += n[0];
      a[1] += n[1];
      a[2] += n[2];
    }
  }
  const inner = new Map<number, number>();
  for (const v of verts) {
    const n = v3.norm(vn.get(v)!);
    // offset -1 = shell grows inward (Blender default), +1 outward, 0 centred.
    const shift = (offset - 1) / 2;
    m.co[v] = v3.add(m.co[v], v3.scale(n, thickness * (offset + 1) / 2 * 0 + 0));
    void shift;
    inner.set(v, m.addVert(v3.add(m.co[v], v3.scale(n, -thickness))));
  }
  const em = m.edgeMap();
  const adds: number[][] = [];
  for (const fi of target) adds.push(m.faces[fi].map((v) => inner.get(v)!).reverse());
  for (const e of em.values()) {
    const inSel = e.faces.filter((f) => target.has(f));
    if (inSel.length !== 1) continue;
    if (e.faces.length > 1 && e.faces.length !== inSel.length) continue;
    const f = m.faces[inSel[0]];
    const ia = f.indexOf(e.a);
    const forward = f[(ia + 1) % f.length] === e.b;
    const a = forward ? e.a : e.b;
    const b = forward ? e.b : e.a;
    // Side wall facing outward of the shell: b, a, a', b'
    adds.push([b, a, inner.get(a)!, inner.get(b)!]);
  }
  for (const f of adds) m.addFace(f);
  m.touch();
  return true;
}

export function smoothVertices(m: EditMesh, s: Selection, factor = 0.5, repeat = 1, clip: [boolean, boolean, boolean] = [false, false, false]): boolean {
  if (!s.v.size) return false;
  const ve = m.vertEdges();
  for (let r = 0; r < repeat; r++) {
    const next = new Map<number, V3>();
    for (const v of s.v) {
      const nb = ve[v].map((k) => (ekLo(k) === v ? ekHi(k) : ekLo(k)));
      if (!nb.length) continue;
      const avg: V3 = [0, 0, 0];
      for (const u of nb) {
        avg[0] += m.co[u][0] / nb.length;
        avg[1] += m.co[u][1] / nb.length;
        avg[2] += m.co[u][2] / nb.length;
      }
      const p = v3.lerp(m.co[v], avg, factor);
      for (let i = 0; i < 3; i++) if (clip[i]) p[i] = m.co[v][i];
      next.set(v, p);
    }
    for (const [v, p] of next) m.co[v] = p;
  }
  m.touch();
  return true;
}

/** Rotate the selected edge inside its two adjacent faces (edge flip generalisation). */
export function rotateEdge(m: EditMesh, s: Selection, clockwise = true): boolean {
  let did = false;
  for (const k of Array.from(s.e)) {
    const info = m.edgeMap().get(k);
    if (!info || info.faces.length !== 2) continue;
    const [fa, fb] = info.faces;
    const A = m.faces[fa];
    const B = m.faces[fb];
    const a = info.a;
    const b = info.b;
    const nextIn = (f: number[], v: number, back: boolean) => f[(f.indexOf(v) + (back ? f.length - 1 : 1)) % f.length];
    // Vertex after each endpoint (away from the edge) in each face.
    const fromA = A[(A.indexOf(a) + 1) % A.length] === b ? [a, b] : [b, a];
    void fromA;
    const dirA = A[(A.indexOf(a) + 1) % A.length] === b; // A runs a->b
    const p = dirA ? nextIn(A, b, false) : nextIn(A, a, false); // A vertex beyond the "head"
    const q = dirA ? nextIn(A, a, true) : nextIn(A, b, true); // A vertex before the "tail"
    const dirB = B[(B.indexOf(a) + 1) % B.length] === b;
    const r = dirB ? nextIn(B, b, false) : nextIn(B, a, false);
    const t = dirB ? nextIn(B, a, true) : nextIn(B, b, true);
    // Only the classic case of two triangles / quads: rotate each endpoint one step.
    const newEdgeA = clockwise ? q : p;
    const newEdgeB = clockwise ? r : t;
    if (newEdgeA === newEdgeB || m.edgeMap().has(ek(newEdgeA, newEdgeB))) continue;
    // Build new faces from the union polygon.
    const merged = mergeFacePair(m, fa, fb, a, b);
    if (!merged) continue;
    const ia = merged.indexOf(newEdgeA);
    const ib = merged.indexOf(newEdgeB);
    if (ia < 0 || ib < 0) continue;
    const keep = m.faces.filter((_, i) => i !== fa && i !== fb);
    m.faces = keep;
    m.addFace(merged);
    m.touch();
    const idx = m.faces.length - 1;
    const sp = splitFace(m, idx, newEdgeA, newEdgeB);
    if (!sp) {
      m.touch();
      continue;
    }
    s.e.delete(k);
    s.e.add(ek(newEdgeA, newEdgeB));
    did = true;
  }
  return did;
}

/** Spin the selection around an axis through `center` (Blender's Spin). */
export function spinSelection(
  m: EditMesh,
  s: Selection,
  center: V3,
  axis: V3,
  angle: number,
  steps: number,
  opts: { dupli?: boolean; merge?: boolean } = {},
): boolean {
  if (!s.v.size || steps < 1) return false;
  const ax = v3.norm(axis);
  const rot = (p: V3, a: number): V3 => {
    const d = v3.sub(p, center);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const cr = v3.cross(ax, d);
    const dt = v3.dot(ax, d);
    return v3.add(center, [d[0] * c + cr[0] * sn + ax[0] * dt * (1 - c), d[1] * c + cr[1] * sn + ax[1] * dt * (1 - c), d[2] * c + cr[2] * sn + ax[2] * dt * (1 - c)]);
  };
  const full = Math.abs(Math.abs(angle) - Math.PI * 2) < 1e-6;
  const stepAngle = angle / (full ? steps : Math.max(1, steps - 0 || 1));
  const angleStep = full ? angle / steps : angle / steps;
  void stepAngle;
  const verts = Array.from(s.v);
  const edgeSet = new Set<number>();
  for (const k of s.e) edgeSet.add(k);
  const faceList = Array.from(s.f);
  let prev = new Map<number, number>();
  for (const v of verts) prev.set(v, v);
  const first = new Map(prev);
  const count = full ? steps : steps;
  for (let i = 1; i <= count; i++) {
    const cur = new Map<number, number>();
    const isLastFull = full && i === count;
    for (const v of verts) {
      if (isLastFull) cur.set(v, first.get(v)!);
      else cur.set(v, m.addVert(rot(m.co[v], angleStep * i)));
    }
    // Connect prev -> cur: edges become quads, lone verts become edges.
    const inFace = new Set<number>();
    for (const fi of faceList) for (const v of m.faces[fi]) inFace.add(v);
    for (const k of edgeSet) {
      const a = ekLo(k);
      const b = ekHi(k);
      const pa = prev.get(a)!;
      const pb = prev.get(b)!;
      const ca = cur.get(a)!;
      const cb = cur.get(b)!;
      if (pa === ca || pb === cb) continue;
      m.addFace([pa, pb, cb, ca]);
    }
    for (const v of verts) {
      const touchedByEdge = Array.from(edgeSet).some((k) => ekLo(k) === v || ekHi(k) === v);
      if (!touchedByEdge && !inFace.has(v) && prev.get(v)! !== cur.get(v)!) m.addLoose(prev.get(v)!, cur.get(v)!);
    }
    prev = cur;
  }
  void opts;
  m.touch();
  m.cleanupFaces();
  return true;
}
