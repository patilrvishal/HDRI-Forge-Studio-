import {
  EditMesh,
  Selection,
  ek,
  ekLo,
  ekHi,
  v3,
  flushSelection,
  type V3,
} from './EditMesh';
import { edgeChains, insertEdgeVerts, splitFace } from './opsCore';
import { buildFan } from './opsShape';

/** A ring of parallel edges running through quad faces (Ctrl+R / Alt+Ctrl+click). */
export interface EdgeRing {
  /** Directed edges (u -> v): cut positions are measured from u to v. */
  edges: [number, number][];
  /** Quad faces between consecutive ring edges. */
  faces: number[];
  closed: boolean;
}

function oppositeInQuad(f: number[], a: number, b: number): [number, number] | null {
  if (f.length !== 4) return null;
  const ia = f.indexOf(a);
  if (ia < 0) return null;
  const fwd = f[(ia + 1) % 4] === b;
  const bwd = f[(ia + 3) % 4] === b;
  if (!fwd && !bwd) return null;
  // Quad [q0 q1 q2 q3] with edge (q0,q1): opposite is (q3,q2) so the direction is preserved.
  if (fwd) {
    const c = f[(ia + 2) % 4];
    const d = f[(ia + 3) % 4];
    return [d, c];
  }
  const c = f[(ia + 2) % 4];
  const d = f[(ia + 1) % 4];
  // b precedes a: quad [b a d c]; the edge opposite (a,b) is (d,c) with a->b matching d->c.
  return [d, c];
}

export function edgeRing(m: EditMesh, startKey: number): EdgeRing | null {
  const em = m.edgeMap();
  const info = em.get(startKey);
  if (!info || info.faces.length === 0) return null;
  const a0 = info.a;
  const b0 = info.b;
  const walk = (a: number, b: number, faceIdx: number): { edges: [number, number][]; faces: number[]; closed: boolean } => {
    const edges: [number, number][] = [];
    const faces: number[] = [];
    let ea = a;
    let eb = b;
    let fi = faceIdx;
    for (;;) {
      const opp = oppositeInQuad(m.faces[fi], ea, eb);
      if (!opp) return { edges, faces, closed: false };
      faces.push(fi);
      edges.push(opp);
      const next = em.get(ek(opp[0], opp[1]));
      if (!next) return { edges, faces, closed: false };
      if (next.key === startKey) return { edges, faces, closed: true };
      const other = next.faces.find((x) => x !== fi);
      if (other === undefined) return { edges, faces, closed: false };
      ea = opp[0];
      eb = opp[1];
      fi = other;
      if (faces.length > m.faces.length) return { edges, faces, closed: false };
    }
  };
  const [f1, f2] = info.faces;
  const forward = walk(a0, b0, f1);
  if (forward.closed) {
    return { edges: [[a0, b0], ...forward.edges.slice(0, -1)], faces: forward.faces, closed: true };
  }
  const result: EdgeRing = { edges: [[a0, b0]], faces: [], closed: false };
  result.edges.push(...forward.edges);
  result.faces.push(...forward.faces);
  if (f2 !== undefined) {
    const back = walk(a0, b0, f2);
    // The backwards direction runs the ring the other way; directions stay consistent (a->b).
    const be = back.edges.slice().reverse();
    const bf = back.faces.slice().reverse();
    result.edges = [...be, ...result.edges];
    result.faces = [...bf, ...result.faces];
  }
  return result;
}

/** Cut a ring `cuts` times. `factor` in [-1,1] slides the cuts along the ring edges. */
export function loopCut(m: EditMesh, ring: EdgeRing, cuts: number, factor = 0): number[] {
  const n = Math.max(1, Math.floor(cuts));
  const cutMap = new Map<number, V3[]>();
  const ringDir = new Map<number, [number, number]>();
  for (const [u, v] of ring.edges) {
    const key = ek(u, v);
    ringDir.set(key, [u, v]);
    const pts: V3[] = [];
    // ordered from the lower-index endpoint (insertEdgeVerts convention)
    for (let i = 1; i <= n; i++) {
      const t = Math.min(0.98, Math.max(0.02, i / (n + 1) + factor / (n + 1)));
      const from = m.co[u];
      const to = m.co[v];
      const p = v3.lerp(from, to, t);
      pts.push(p);
    }
    if (u > v) pts.reverse(); // direction u->v corresponds to lo->hi only when u<v
    cutMap.set(key, pts);
  }
  const quadInfo = ring.faces.map((fi) => ({ fi, loop: m.faces[fi].slice() }));
  const idsByEdge = insertEdgeVerts(m, cutMap);
  const dirVerts = (key: number): number[] => {
    const [u, v] = ringDir.get(key)!;
    const ids = idsByEdge.get(key)!;
    return u < v ? ids : ids.slice().reverse();
  };
  const drop = new Set<number>();
  const adds: number[][] = [];
  for (const { fi, loop } of quadInfo) {
    // Find the pair of ring edges in this quad.
    let e0: [number, number] | null = null;
    let e1: [number, number] | null = null;
    for (let i = 0; i < 4; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % 4];
      const key = ek(a, b);
      if (!ringDir.has(key)) continue;
      if (!e0) e0 = [a, b];
      else e1 = [a, b];
    }
    if (!e0 || !e1) continue;
    // Order so e0 -> e1 are opposite sides: loop [q0 q1 q2 q3] with e0=(q0,q1), e1=(q2,q3)
    const i0 = loop.indexOf(e0[0]);
    const q = [loop[i0], loop[(i0 + 1) % 4], loop[(i0 + 2) % 4], loop[(i0 + 3) % 4]];
    const A = [q[0], ...(q[0] === ringDir.get(ek(q[0], q[1]))![0] ? dirVerts(ek(q[0], q[1])) : dirVerts(ek(q[0], q[1])).slice().reverse()), q[1]];
    // Parallel side runs q3 -> q2.
    const Bfw = ringDir.get(ek(q[2], q[3]))![0] === q[3] ? dirVerts(ek(q[2], q[3])) : dirVerts(ek(q[2], q[3])).slice().reverse();
    const Bv = [q[3], ...Bfw, q[2]];
    for (let t = 0; t <= n; t++) adds.push([A[t], A[t + 1], Bv[t + 1], Bv[t]]);
    drop.add(fi);
  }
  m.faces = m.faces.filter((_, i) => !drop.has(i)).concat(adds);
  m.touch();
  const newVerts: number[] = [];
  for (const ids of idsByEdge.values()) newVerts.push(...ids);
  return newVerts;
}

// ── Edge loop (Alt+click) ─────────────────────────────────────────────────

/** Edge loop through `startKey` (continues through valence-4 vertices; boundary loops for boundary edges). */
export function edgeLoop(m: EditMesh, startKey: number): number[] {
  const em = m.edgeMap();
  const start = em.get(startKey);
  if (!start) return [];
  const ve = m.vertEdges();
  const out: number[] = [startKey];
  const seen = new Set<number>([startKey]);
  const step = (fromV: number, viaKey: number): number | null => {
    const edges = ve[fromV];
    const viaInfo = em.get(viaKey)!;
    if (viaInfo.faces.length === 1) {
      // boundary loop: next boundary edge (must be exactly two boundary edges at the vertex)
      const bnd = edges.filter((k) => k !== viaKey && (em.get(k)?.faces.length ?? 0) === 1);
      return bnd.length === 1 ? bnd[0] : null;
    }
    const viaFaces = new Set(viaInfo.faces);
    if (edges.length === 3) {
      // Valence-3 corner (e.g. a cube): follow the boundary of the face the loop started on.
      const pref = start.faces[0];
      const cands = edges.filter((k) => k !== viaKey && em.get(k)!.faces.includes(pref));
      return cands.length === 1 ? cands[0] : null;
    }
    if (edges.length !== 4) return null;
    // opposite edge = the one sharing no face with viaKey
    const cands = edges.filter((k) => k !== viaKey && !em.get(k)!.faces.some((f) => viaFaces.has(f)));
    return cands.length === 1 ? cands[0] : null;
  };
  for (const startV of [start.a, start.b]) {
    let key = startKey;
    let v = startV;
    for (;;) {
      const next = step(v, key);
      if (next === null || seen.has(next)) break;
      seen.add(next);
      if (startV === start.a) out.unshift(next);
      else out.push(next);
      const ni = em.get(next)!;
      v = ni.a === v ? ni.b : ni.a;
      key = next;
    }
  }
  return out;
}

/** Ring edges as a plain key list (Alt+Ctrl+click). */
export function edgeRingKeys(m: EditMesh, startKey: number): number[] {
  const r = edgeRing(m, startKey);
  return r ? r.edges.map(([a, b]) => ek(a, b)) : [];
}

// ── Bridge ────────────────────────────────────────────────────────────────

export function bridgeEdgeLoops(m: EditMesh, s: Selection, twist = 0): { ok: boolean; message?: string } {
  const chains = edgeChains(s.e);
  if (chains.length !== 2) return { ok: false, message: 'Select exactly two edge loops to bridge' };
  let [L1, L2] = chains;
  if (L1.closed !== L2.closed) return { ok: false, message: 'Both loops must be open or both closed' };
  if (L1.verts.length !== L2.verts.length) return { ok: false, message: 'Loops need the same number of vertices' };
  const n = L1.verts.length;
  const closed = L1.closed;
  const A = L1.verts.slice();
  let best = { cost: Infinity, shift: 0, rev: false };
  for (const rev of [false, true]) {
    const base = rev ? L2.verts.slice().reverse() : L2.verts.slice();
    const shifts = closed ? n : 1;
    for (let sh = 0; sh < shifts; sh++) {
      let c = 0;
      for (let i = 0; i < n; i++) c += v3.dist(m.co[A[i]], m.co[base[(i + sh) % n]]);
      if (c < best.cost) best = { cost: c, shift: sh, rev };
    }
  }
  const baseB = best.rev ? L2.verts.slice().reverse() : L2.verts.slice();
  const B: number[] = [];
  const shift = closed ? (best.shift + twist + n * 100) % n : 0;
  for (let i = 0; i < n; i++) B.push(baseB[(i + shift) % n]);
  const spans = closed ? n : n - 1;
  const quads: number[][] = [];
  for (let i = 0; i < spans; i++) {
    const j = (i + 1) % n;
    quads.push([A[i], A[j], B[j], B[i]]);
  }
  // Wind consistently: match neighbouring faces on loop A if any, else keep.
  const em = m.edgeMap();
  let flip = false;
  for (let i = 0; i < spans; i++) {
    const info = em.get(ek(A[i], A[(i + 1) % n]));
    if (info && info.faces.length) {
      const f = m.faces[info.faces[0]];
      const ia = f.indexOf(A[i]);
      const usesForward = f[(ia + 1) % f.length] === A[(i + 1) % n];
      // neighbour uses A[i]->A[i+1]: our quad also uses it => must flip
      flip = usesForward;
      break;
    }
  }
  for (const q of quads) m.addFace(flip ? q.slice().reverse() : q);
  m.touch();
  s.f.clear();
  return { ok: true };
}

// ── Rip ───────────────────────────────────────────────────────────────────

/** Rip selected vertices apart along the edge picked by `pickEdge` (returns an edge key or -1). */
export function ripVertices(m: EditMesh, s: Selection, pickEdge: (v: number, edges: number[]) => number): boolean {
  const newSel: number[] = [];
  let did = false;
  for (const v of Array.from(s.v)) {
    const vf = m.vertFaces()[v];
    const fan = buildFan(m, v, vf);
    if (!fan || fan.faces.length < 2) continue;
    const k = fan.faces.length;
    // Slot edges (prev edge of each face; for open fans also the final next edge).
    const slotOther: number[] = fan.prev.slice();
    if (!fan.closed) slotOther.push(fan.next[k - 1]);
    const slotKeys = slotOther.map((o) => ek(v, o));
    const choice = pickEdge(v, slotKeys);
    let j = slotKeys.indexOf(choice);
    if (j < 0) j = 0;
    let groupB: number[];
    if (fan.closed) {
      const half = Math.max(1, Math.floor(k / 2));
      groupB = [];
      for (let i = 0; i < half; i++) groupB.push(fan.faces[(j + i) % k]);
    } else {
      if (j === 0 || j === k) continue; // ripping at the open boundary does nothing
      groupB = fan.faces.slice(j);
    }
    const nv = m.addVert(m.co[v]);
    for (const fi of groupB) m.faces[fi] = m.faces[fi].map((x) => (x === v ? nv : x));
    newSel.push(nv);
    did = true;
    m.touch();
  }
  if (!did) return false;
  s.clear();
  for (const v of newSel) s.v.add(v);
  flushSelection(m, s, 'vert');
  return true;
}

// ── Knife ─────────────────────────────────────────────────────────────────

export type KnifeStep =
  | { kind: 'vert'; v: number }
  | { kind: 'edge'; a: number; b: number; t: number; pos: V3 }
  | { kind: 'face'; face: number; pos: V3 };

export interface KnifeCut {
  steps: KnifeStep[];
  /** via[i] = face containing the segment steps[i] -> steps[i+1]. */
  via: number[];
}

/** Split a face along a chain of vertices (endpoints on the boundary, interior vertices free). */
export function splitFaceByPolyline(m: EditMesh, fi: number, chain: number[]): boolean {
  if (chain.length < 2) return false;
  const f = m.faces[fi];
  const n = f.length;
  const i0 = f.indexOf(chain[0]);
  const i1 = f.indexOf(chain[chain.length - 1]);
  if (i0 < 0 || i1 < 0 || i0 === i1) return false;
  if (chain.length === 2 && ((i0 + 1) % n === i1 || (i1 + 1) % n === i0)) return false;
  // Walk the boundary from i0 forward to i1 and from i1 forward to i0.
  const path = (from: number, to: number): number[] => {
    const out: number[] = [f[from]];
    let i = from;
    while (i !== to) {
      i = (i + 1) % n;
      out.push(f[i]);
    }
    return out;
  };
  const A = path(i0, i1); // boundary side 1: chain[0] .. chain[last]
  const Bp = path(i1, i0); // boundary side 2: chain[last] .. chain[0]
  const interior = chain.slice(1, -1);
  // Loop 1: boundary A then chain reversed (interior reversed) back to start.
  const loop1 = [...A, ...interior.slice().reverse()];
  // Loop 2: boundary B then chain forward.
  const loop2 = [...Bp, ...interior];
  m.faces[fi] = loop1;
  m.faces.push(loop2);
  m.touch();
  return true;
}

export function applyKnife(m: EditMesh, cut: KnifeCut): { ok: boolean; verts: number[] } {
  // Group edge cuts so one edge with several cuts is split in a single pass.
  const perEdge = new Map<number, { t: number; pos: V3; stepIdx: number }[]>();
  cut.steps.forEach((st, idx) => {
    if (st.kind !== 'edge') return;
    const key = ek(st.a, st.b);
    const lo = ekLo(key);
    const t = st.a === lo ? st.t : 1 - st.t; // parameter measured from lo
    (perEdge.get(key) ?? perEdge.set(key, []).get(key)!).push({ t, pos: st.pos, stepIdx: idx });
  });
  const cutPts = new Map<number, V3[]>();
  const orderIdx = new Map<number, number[]>();
  for (const [key, list] of perEdge) {
    list.sort((x, y) => x.t - y.t);
    cutPts.set(key, list.map((x) => x.pos));
    orderIdx.set(key, list.map((x) => x.stepIdx));
  }
  const ids = insertEdgeVerts(m, cutPts);
  const stepVert: number[] = new Array(cut.steps.length).fill(-1);
  for (const [key, arr] of ids) {
    const order = orderIdx.get(key)!;
    arr.forEach((vid, i) => (stepVert[order[i]] = vid));
  }
  cut.steps.forEach((st, idx) => {
    if (st.kind === 'vert') stepVert[idx] = st.v;
    else if (st.kind === 'face') stepVert[idx] = m.addVert(st.pos);
  });
  // Split faces along consecutive segments that share a via-face.
  let did = false;
  let i = 0;
  while (i < cut.steps.length - 1) {
    const face = cut.via[i];
    const chain: number[] = [stepVert[i]];
    let j = i;
    while (j < cut.steps.length - 1 && cut.via[j] === face) {
      chain.push(stepVert[j + 1]);
      j++;
    }
    // Locate the face by its endpoints (indices are stable for untouched faces).
    let target = face;
    const loopHas = (fx: number) => m.faces[fx] && m.faces[fx].includes(chain[0]) && m.faces[fx].includes(chain[chain.length - 1]);
    if (!loopHas(target)) {
      target = m.faces.findIndex((_, fx) => loopHas(fx));
    }
    if (target >= 0 && splitFaceByPolyline(m, target, chain)) did = true;
    i = j;
  }
  m.touch();
  return { ok: did, verts: stepVert.filter((v) => v >= 0) };
}

/** Helper used by the spin/slide code paths in the controller. */
export { splitFace };
