import {
  EditMesh,
  Selection,
  ek,
  ekLo,
  ekHi,
  flushSelection,
  selectAll,
  v3,
  type SelectMode,
} from './EditMesh';
import { edgeLoop, edgeRingKeys } from './opsLoop';

/** Select-menu style operators. All of them leave the selection flushed for `mode`. */

export function invertSelection(m: EditMesh, s: Selection, mode: SelectMode): void {
  const next = new Selection();
  if (mode === 'vert') {
    for (let v = 0; v < m.co.length; v++) if (!s.v.has(v) && !m.hidden.has(v)) next.v.add(v);
  } else if (mode === 'edge') {
    for (const e of m.edgeMap().values()) {
      if (!s.e.has(e.key) && !m.hidden.has(e.a) && !m.hidden.has(e.b)) next.e.add(e.key);
    }
  } else {
    for (let f = 0; f < m.faces.length; f++) {
      if (!s.f.has(f) && !m.faces[f].some((v) => m.hidden.has(v))) next.f.add(f);
    }
  }
  s.v = next.v;
  s.e = next.e;
  s.f = next.f;
  s.active = null;
  flushSelection(m, s, mode);
}

/** Select More (Ctrl + Numpad +): grow the selection by one step. */
export function growSelection(m: EditMesh, s: Selection, mode: SelectMode): void {
  const vf = m.vertFaces();
  if (mode === 'vert') {
    const add = new Set<number>();
    for (const e of m.edgeMap().values()) {
      if (s.v.has(e.a)) add.add(e.b);
      if (s.v.has(e.b)) add.add(e.a);
    }
    for (const v of add) if (!m.hidden.has(v)) s.v.add(v);
  } else if (mode === 'edge') {
    const verts = new Set<number>();
    for (const k of s.e) {
      verts.add(ekLo(k));
      verts.add(ekHi(k));
    }
    for (const e of m.edgeMap().values()) if (verts.has(e.a) || verts.has(e.b)) s.e.add(e.key);
  } else {
    const verts = new Set<number>();
    for (const fi of s.f) for (const v of m.faces[fi]) verts.add(v);
    for (const v of verts) for (const fi of vf[v]) s.f.add(fi);
  }
  flushSelection(m, s, mode);
}

/** Select Less (Ctrl + Numpad -): shrink by one step. */
export function shrinkSelection(m: EditMesh, s: Selection, mode: SelectMode): void {
  const vf = m.vertFaces();
  if (mode === 'vert') {
    const boundary = new Set<number>();
    for (const e of m.edgeMap().values()) {
      if (s.v.has(e.a) && !s.v.has(e.b)) boundary.add(e.a);
      if (s.v.has(e.b) && !s.v.has(e.a)) boundary.add(e.b);
    }
    for (const v of boundary) s.v.delete(v);
  } else if (mode === 'edge') {
    const keep = new Set<number>();
    const ve = m.vertEdges();
    for (const k of s.e) {
      const ok = [ekLo(k), ekHi(k)].every((v) => ve[v].every((e) => s.e.has(e)));
      if (ok) keep.add(k);
    }
    s.e = keep;
  } else {
    const keep = new Set<number>();
    for (const fi of s.f) {
      const ok = m.faces[fi].every((v) => vf[v].every((g) => s.f.has(g)));
      if (ok) keep.add(fi);
    }
    s.f = keep;
  }
  flushSelection(m, s, mode);
}

/** L / Ctrl+L: everything connected to the seeds. */
export function selectLinked(m: EditMesh, s: Selection, mode: SelectMode, seedVerts: number[], delimitSharp = false): void {
  const ve = m.vertEdges();
  const em = m.edgeMap();
  const seen = new Set<number>(seedVerts);
  const stack = seedVerts.slice();
  while (stack.length) {
    const v = stack.pop()!;
    for (const k of ve[v]) {
      if (delimitSharp && m.sharp.has(k)) continue;
      const o = ekLo(k) === v ? ekHi(k) : ekLo(k);
      if (!seen.has(o)) {
        seen.add(o);
        stack.push(o);
      }
    }
  }
  void em;
  for (const v of seen) if (!m.hidden.has(v)) s.v.add(v);
  if (mode === 'vert') flushSelection(m, s, 'vert');
  else if (mode === 'edge') {
    for (const e of m.edgeMap().values()) if (seen.has(e.a) && seen.has(e.b)) s.e.add(e.key);
    flushSelection(m, s, 'edge');
  } else {
    for (let f = 0; f < m.faces.length; f++) if (m.faces[f].every((v) => seen.has(v))) s.f.add(f);
    flushSelection(m, s, 'face');
  }
}

export function selectRandom(m: EditMesh, s: Selection, mode: SelectMode, ratio = 0.5, seed = 1): void {
  let x = seed * 9301 + 49297;
  const rnd = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  s.clear();
  if (mode === 'vert') {
    for (let v = 0; v < m.co.length; v++) if (rnd() < ratio) s.v.add(v);
  } else if (mode === 'edge') {
    for (const k of m.edgeMap().keys()) if (rnd() < ratio) s.e.add(k);
  } else {
    for (let f = 0; f < m.faces.length; f++) if (rnd() < ratio) s.f.add(f);
  }
  flushSelection(m, s, mode);
}

export function selectNth(m: EditMesh, s: Selection, mode: SelectMode): void {
  // Checker Deselect: keep every second element in index order.
  const list = mode === 'vert' ? Array.from(s.v) : mode === 'edge' ? Array.from(s.e) : Array.from(s.f);
  list.sort((a, b) => a - b);
  const drop = new Set<number>();
  list.forEach((x, i) => {
    if (i % 2 === 1) drop.add(x);
  });
  for (const x of drop) (mode === 'vert' ? s.v : mode === 'edge' ? s.e : s.f).delete(x);
  flushSelection(m, s, mode);
}

/** Alt+click: edge loop (vertex / edge mode) or face loop (face mode). */
export function selectLoopAt(m: EditMesh, s: Selection, mode: SelectMode, edgeKey: number, extend: boolean): void {
  if (!extend) s.clear();
  if (mode === 'face') {
    // Face loop: faces on both sides of the ring edges crossing the nearest edge.
    const keys = edgeRingKeys(m, edgeKey);
    const em = m.edgeMap();
    for (const k of keys) for (const f of em.get(k)?.faces ?? []) s.f.add(f);
    const info = em.get(edgeKey);
    for (const f of info?.faces ?? []) s.f.add(f);
    flushSelection(m, s, 'face');
    return;
  }
  const keys = edgeLoop(m, edgeKey);
  for (const k of keys) {
    s.e.add(k);
    s.v.add(ekLo(k));
    s.v.add(ekHi(k));
  }
  flushSelection(m, s, mode === 'vert' ? 'vert' : 'edge');
}

/** Alt+Ctrl+click: edge ring. */
export function selectRingAt(m: EditMesh, s: Selection, mode: SelectMode, edgeKey: number, extend: boolean): void {
  if (!extend) s.clear();
  const keys = edgeRingKeys(m, edgeKey);
  for (const k of keys) {
    s.e.add(k);
    s.v.add(ekLo(k));
    s.v.add(ekHi(k));
  }
  flushSelection(m, s, mode === 'vert' ? 'vert' : 'edge');
}

/** Ctrl+click: shortest path along edges between two vertices. */
export function shortestPath(m: EditMesh, from: number, to: number): number[] {
  if (from === to) return [from];
  const ve = m.vertEdges();
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new Set<number>([from]);
  while (open.size) {
    let cur = -1;
    let best = Infinity;
    for (const v of open) {
      const d = dist.get(v)!;
      if (d < best) {
        best = d;
        cur = v;
      }
    }
    open.delete(cur);
    if (cur === to) break;
    for (const k of ve[cur]) {
      const o = ekLo(k) === cur ? ekHi(k) : ekLo(k);
      if (m.hidden.has(o)) continue;
      const nd = best + v3.dist(m.co[cur], m.co[o]);
      if (nd < (dist.get(o) ?? Infinity)) {
        dist.set(o, nd);
        prev.set(o, cur);
        open.add(o);
      }
    }
  }
  if (!prev.has(to)) return [];
  const path = [to];
  let c = to;
  while (c !== from) {
    c = prev.get(c)!;
    path.push(c);
  }
  return path.reverse();
}

export function selectPath(m: EditMesh, s: Selection, mode: SelectMode, from: number, to: number): boolean {
  const path = shortestPath(m, from, to);
  if (!path.length) return false;
  for (const v of path) s.v.add(v);
  for (let i = 0; i + 1 < path.length; i++) s.e.add(ek(path[i], path[i + 1]));
  if (mode === 'face') {
    // Faces along the path: those containing two consecutive path vertices.
    for (let i = 0; i + 1 < path.length; i++) {
      for (const f of m.edgeFaces(ek(path[i], path[i + 1]))) s.f.add(f);
    }
    flushSelection(m, s, 'face');
  } else {
    flushSelection(m, s, mode === 'vert' ? 'vert' : 'edge');
  }
  return true;
}

export function hideSelected(m: EditMesh, s: Selection, unselected = false): void {
  if (unselected) {
    for (let v = 0; v < m.co.length; v++) if (!s.v.has(v)) m.hidden.add(v);
  } else for (const v of s.v) m.hidden.add(v);
  s.clear();
  m.touch();
}

export function revealHidden(m: EditMesh, s: Selection, mode: SelectMode): void {
  const was = Array.from(m.hidden);
  m.hidden.clear();
  s.clear();
  for (const v of was) s.v.add(v);
  flushSelection(m, s, 'vert');
  if (mode === 'edge') flushSelection(m, s, 'edge');
  if (mode === 'face') flushSelection(m, s, 'face');
  m.touch();
}

export { selectAll };
