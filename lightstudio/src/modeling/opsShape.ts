import {
  EditMesh,
  Selection,
  ek,
  ekLo,
  ekHi,
  v3,
  flushSelection,
  selectionNormal,
  type SelectMode,
  type V3,
} from './EditMesh';

/**
 * Extrude / inset / bevel. Behaviour (which originals are kept or deleted,
 * what ends up selected) follows Blender's Extrude Region, Inset Faces and
 * Bevel operators; counts are verified against Blender in test/run.ts.
 */

// ── Extrude ───────────────────────────────────────────────────────────────

export interface ExtrudeResult {
  ok: boolean;
  /** Direction to translate along after extruding (average normal), if any. */
  normal: V3 | null;
}

export function extrudeRegion(m: EditMesh, s: Selection, _mode: SelectMode): ExtrudeResult {
  const F = new Set(s.f);
  const em = m.edgeMap();
  const faceEdgeSet = new Set<number>();
  for (const fi of F) for (const k of m.faceEdgeKeys(fi)) faceEdgeSet.add(k);
  const E = new Set<number>();
  for (const k of s.e) if (!faceEdgeSet.has(k) && em.has(k)) E.add(k);
  const used = new Set<number>();
  for (const fi of F) for (const v of m.faces[fi]) used.add(v);
  for (const k of E) {
    used.add(ekLo(k));
    used.add(ekHi(k));
  }
  const V = new Set<number>();
  for (const v of s.v) if (!used.has(v)) V.add(v);
  const dupSet = new Set<number>([...used, ...V]);
  if (!dupSet.size) return { ok: false, normal: null };

  // Region boundary of the selected faces (edge used by exactly one selected face).
  const selCount = new Map<number, number>();
  for (const fi of F) for (const k of m.faceEdgeKeys(fi)) selCount.set(k, (selCount.get(k) ?? 0) + 1);
  const boundary: [number, number][] = [];
  let outerNeighbour = false;
  for (const fi of F) {
    const f = m.faces[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      const k = ek(a, b);
      if ((selCount.get(k) ?? 0) === 1) {
        boundary.push([a, b]);
        if ((em.get(k)?.faces.length ?? 0) > 1) outerNeighbour = true;
      }
    }
  }
  const deleteOrig = F.size > 0 && outerNeighbour;

  const dup = new Map<number, number>();
  for (const v of dupSet) dup.set(v, m.addVert(m.co[v]));

  const nOld = m.faces.length;
  const topFaces: number[] = [];
  for (const fi of F) topFaces.push(m.addFace(m.faces[fi].map((v) => dup.get(v)!)));
  for (const [a, b] of boundary) m.addFace([a, b, dup.get(b)!, dup.get(a)!]);
  for (const k of E) {
    const a = ekLo(k);
    const b = ekHi(k);
    const adj = em.get(k)!.faces[0];
    let p = a;
    let q = b;
    if (adj !== undefined) {
      const f = m.faces[adj];
      const ia = f.indexOf(a);
      if (f[(ia + 1) % f.length] !== b) {
        p = b;
        q = a;
      }
    }
    m.addFace([p, q, dup.get(q)!, dup.get(p)!]);
  }
  for (const v of V) m.addLoose(v, dup.get(v)!);

  const sel = new Selection();
  for (const d of dup.values()) sel.v.add(d);
  for (const fi of topFaces) {
    sel.f.add(fi);
    for (const k of m.faceEdgeKeys(fi)) sel.e.add(k);
  }
  for (const k of E) sel.e.add(ek(dup.get(ekLo(k))!, dup.get(ekHi(k))!));
  // Edge fins have no top face; make sure their dup edge exists as a real edge (it does via the quad).

  let normal: V3 | null = null;
  if (F.size) {
    const n: V3 = [0, 0, 0];
    for (const fi of F) {
      const fn = m.faceNormal(fi);
      n[0] += fn[0];
      n[1] += fn[1];
      n[2] += fn[2];
    }
    normal = v3.len(n) > 1e-9 ? v3.norm(n) : null;
  } else {
    const n: V3 = [0, 0, 0];
    for (const v of dupSet) {
      const vn = m.vertNormal(v);
      n[0] += vn[0];
      n[1] += vn[1];
      n[2] += vn[2];
    }
    normal = v3.len(n) > 1e-9 ? v3.norm(n) : null;
  }

  let remap: Int32Array | null = null;
  if (deleteOrig) {
    const drop = new Set<number>();
    for (const fi of F) drop.add(fi);
    // Move faces: dropping shifts indices; compute new indices for the selection.
    const fmap = m.dropFaces(drop);
    const newF = new Set<number>();
    for (const fi of sel.f) newF.add(fmap[fi]);
    sel.f = newF;
    const orphan = m.orphanVerts();
    if (orphan.size) remap = m.removeVerts(orphan);
  }
  void nOld;
  const finalSel = new Selection();
  const mapV = (v: number) => (remap ? remap[v] : v);
  for (const v of sel.v) if (mapV(v) >= 0) finalSel.v.add(mapV(v));
  for (const k of sel.e) {
    const a = mapV(ekLo(k));
    const b = mapV(ekHi(k));
    if (a >= 0 && b >= 0) finalSel.e.add(ek(a, b));
  }
  finalSel.f = sel.f;
  s.v = finalSel.v;
  s.e = finalSel.e;
  s.f = finalSel.f;
  s.active = null;
  m.touch();
  return { ok: true, normal };
}

/** Extrude each selected face on its own (Blender: Extrude Individual Faces). */
export function extrudeIndividualFaces(m: EditMesh, s: Selection): ExtrudeResult {
  if (!s.f.size) return { ok: false, normal: null };
  const drop = new Set(s.f);
  const newFaces: number[][] = [];
  const sel = new Selection();
  const topIdx: number[] = [];
  const list = Array.from(s.f);
  const startCount = m.faces.length;
  let add = 0;
  for (const fi of list) {
    const f = m.faces[fi];
    const d = f.map((v) => m.addVert(m.co[v]));
    newFaces.push(d);
    topIdx.push(startCount - list.length + list.length + add);
    add++;
  }
  void startCount;
  const sides: number[][] = [];
  list.forEach((fi, i) => {
    const f = m.faces[fi];
    const d = newFaces[i];
    for (let j = 0; j < f.length; j++) {
      const n = (j + 1) % f.length;
      sides.push([f[j], f[n], d[n], d[j]]);
    }
  });
  const kept = m.faces.filter((_, i) => !drop.has(i));
  const firstNew = kept.length;
  m.faces = kept.concat(newFaces, sides);
  m.touch();
  for (let i = 0; i < newFaces.length; i++) {
    sel.f.add(firstNew + i);
    for (const v of newFaces[i]) sel.v.add(v);
  }
  flushSelection(m, sel, 'face');
  s.v = sel.v;
  s.e = sel.e;
  s.f = sel.f;
  const n: V3 = [0, 0, 0];
  for (const fi of s.f) {
    const fn = m.faceNormal(fi);
    n[0] += fn[0];
    n[1] += fn[1];
    n[2] += fn[2];
  }
  return { ok: true, normal: v3.len(n) > 1e-9 ? v3.norm(n) : null };
}

/** Move newly extruded geometry by `dist` along the average normal of the selection. */
export function offsetAlongNormal(m: EditMesh, s: Selection, dist: number, perVertex = false): void {
  if (!perVertex) {
    const n = selectionNormal(m, s);
    for (const v of s.v) m.co[v] = v3.add(m.co[v], v3.scale(n, dist));
  } else {
    const shifts = new Map<number, V3>();
    for (const v of s.v) shifts.set(v, v3.scale(m.vertNormal(v), dist));
    for (const [v, d] of shifts) m.co[v] = v3.add(m.co[v], d);
  }
  m.touch();
}

// ── Inset ─────────────────────────────────────────────────────────────────

export interface InsetOptions {
  thickness: number;
  depth?: number;
  individual?: boolean;
  useBoundary?: boolean;
  outset?: boolean;
}

export function insetFaces(m: EditMesh, s: Selection, opts: InsetOptions): boolean {
  if (!s.f.size) return false;
  const t = (opts.outset ? -1 : 1) * opts.thickness;
  const depth = opts.depth ?? 0;
  const useBoundary = opts.useBoundary ?? true;
  const em = m.edgeMap();

  const groups: number[][] = [];
  if (opts.individual) for (const fi of s.f) groups.push([fi]);
  else groups.push(Array.from(s.f));

  const dropFaces = new Set<number>();
  const adds: number[][] = [];
  const innerLoops: number[][] = [];
  const innerVerts = new Set<number>();
  let didAny = false;

  for (const g of groups) {
    const gset = new Set(g);
    const cnt = new Map<number, number>();
    for (const fi of g) for (const k of m.faceEdgeKeys(fi)) cnt.set(k, (cnt.get(k) ?? 0) + 1);
    // boundary directed edges: (a, b, face)
    const bnd: { a: number; b: number; f: number }[] = [];
    for (const fi of g) {
      const f = m.faces[fi];
      for (let i = 0; i < f.length; i++) {
        const a = f[i];
        const b = f[(i + 1) % f.length];
        const k = ek(a, b);
        if ((cnt.get(k) ?? 0) !== 1) continue;
        if (!useBoundary && (em.get(k)?.faces.length ?? 0) === 1) continue;
        bnd.push({ a, b, f: fi });
      }
    }
    if (!bnd.length) continue;
    // Displacement per boundary vertex.
    const outEdge = new Map<number, { b: number; f: number }[]>();
    const inEdge = new Map<number, { a: number; f: number }[]>();
    for (const e of bnd) {
      (outEdge.get(e.a) ?? outEdge.set(e.a, []).get(e.a)!).push({ b: e.b, f: e.f });
      (inEdge.get(e.b) ?? inEdge.set(e.b, []).get(e.b)!).push({ a: e.a, f: e.f });
    }
    const bverts = new Set<number>([...outEdge.keys(), ...inEdge.keys()]);
    const newPos = new Map<number, V3>();
    for (const v of bverts) {
      const dirs: V3[] = [];
      const norms: V3[] = [];
      for (const o of outEdge.get(v) ?? []) {
        const e = v3.norm(v3.sub(m.co[o.b], m.co[v]));
        const n = m.faceNormal(o.f);
        dirs.push(v3.norm(v3.cross(n, e)));
        norms.push(n);
      }
      for (const i of inEdge.get(v) ?? []) {
        const e = v3.norm(v3.sub(m.co[v], m.co[i.a]));
        const n = m.faceNormal(i.f);
        dirs.push(v3.norm(v3.cross(n, e)));
        norms.push(n);
      }
      let disp: V3 = [0, 0, 0];
      if (dirs.length >= 2) {
        const d1 = dirs[0];
        const d2 = dirs[1];
        const denom = 1 + v3.dot(d1, d2);
        disp = v3.scale(v3.add(d1, d2), t / Math.max(denom, 0.15));
      } else if (dirs.length === 1) disp = v3.scale(dirs[0], t);
      const avgN: V3 = [0, 0, 0];
      for (const n of norms) {
        avgN[0] += n[0];
        avgN[1] += n[1];
        avgN[2] += n[2];
      }
      const nn = v3.norm(avgN);
      newPos.set(v, v3.add(v3.add(m.co[v], disp), v3.scale(nn, depth)));
    }
    const inner = new Map<number, number>();
    for (const [v, p] of newPos) inner.set(v, m.addVert(p));
    for (const fi of g) {
      const loop = m.faces[fi].map((v) => inner.get(v) ?? v);
      adds.push(loop);
      innerLoops.push(loop);
      for (const v of loop) innerVerts.add(v);
      dropFaces.add(fi);
    }
    for (const e of bnd) adds.push([e.a, e.b, inner.get(e.b)!, inner.get(e.a)!]);
    didAny = true;
    void gset;
  }
  if (!didAny) return false;
  const kept = m.faces.filter((_, i) => !dropFaces.has(i));
  const firstNew = kept.length;
  m.faces = kept.concat(adds);
  m.touch();
  s.clear();
  for (let i = 0; i < innerLoops.length; i++) s.f.add(firstNew + i);
  flushSelection(m, s, 'face');
  return true;
}

// ── Bevel ─────────────────────────────────────────────────────────────────

export interface BevelOptions {
  width: number;
  segments: number;
  /** 0..1, 0.5 = circular profile (Blender default). */
  profile?: number;
}

export interface FanInfo {
  faces: number[]; // F_0..F_{k-1}
  prev: number[]; // p_i : vertex before v in face i
  next: number[]; // n_i : vertex after v in face i
  closed: boolean;
}

export function buildFan(m: EditMesh, v: number, vf: number[]): FanInfo | null {
  const info = vf.map((fi) => {
    const f = m.faces[fi];
    const i = f.indexOf(v);
    return { fi, p: f[(i + f.length - 1) % f.length], n: f[(i + 1) % f.length] };
  });
  const byPrev = new Map<number, (typeof info)[number]>();
  for (const x of info) {
    if (byPrev.has(x.p)) return null; // non-manifold
    byPrev.set(x.p, x);
  }
  const hasPred = new Set<number>();
  for (const x of info) {
    const g = byPrev.get(x.n);
    if (g) hasPred.add(g.fi);
  }
  let start = info.find((x) => !hasPred.has(x.fi));
  const closed = !start;
  if (!start) start = info[0];
  const order: typeof info = [];
  let cur: (typeof info)[number] | undefined = start;
  const seen = new Set<number>();
  while (cur && !seen.has(cur.fi)) {
    order.push(cur);
    seen.add(cur.fi);
    cur = byPrev.get(cur.n);
  }
  if (order.length !== info.length) return null;
  return { faces: order.map((x) => x.fi), prev: order.map((x) => x.p), next: order.map((x) => x.n), closed };
}

/** Sample a profile from A to B bulging around V (rational quadratic; circle at profile 0.5). */
function profilePoints(A: V3, B: V3, V: V3, segs: number, profile: number): V3[] {
  const out: V3[] = [A];
  const a = v3.sub(A, V);
  const b = v3.sub(B, V);
  const la = v3.len(a);
  const lb = v3.len(b);
  if (segs <= 1 || la < 1e-9 || lb < 1e-9) {
    out.push(B);
    return out;
  }
  const cosPhi = Math.max(-1, Math.min(1, v3.dot(a, b) / (la * lb)));
  const phi = Math.acos(cosPhi);
  const wgt = Math.max(0.02, Math.sin(phi / 2) * Math.tan((Math.PI * Math.min(0.98, Math.max(0.02, profile))) / 2));
  if (Math.abs(la - lb) < 1e-4 * Math.max(la, lb) && Math.abs(profile - 0.5) < 1e-6 && phi > 1e-4 && phi < Math.PI - 1e-4) {
    // True circular arc: centre on the bisector, uniform angle steps.
    const ua = v3.scale(a, 1 / la);
    const ub = v3.scale(b, 1 / lb);
    const bis = v3.norm(v3.add(ua, ub));
    const centre = v3.add(V, v3.scale(bis, la / Math.cos(phi / 2)));
    const ca = v3.sub(A, centre);
    const cb = v3.sub(B, centre);
    const arc = Math.acos(Math.max(-1, Math.min(1, v3.dot(v3.norm(ca), v3.norm(cb)))));
    const axis = v3.norm(v3.cross(ca, cb));
    for (let i = 1; i < segs; i++) {
      const ang = (arc * i) / segs;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const cr = v3.cross(axis, ca);
      const dt = v3.dot(axis, ca);
      out.push(v3.add(centre, [ca[0] * c + cr[0] * s + axis[0] * dt * (1 - c), ca[1] * c + cr[1] * s + axis[1] * dt * (1 - c), ca[2] * c + cr[2] * s + axis[2] * dt * (1 - c)]));
    }
  } else {
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * wgt * t * (1 - t);
      const w2 = t * t;
      const d = w0 + w1 + w2;
      out.push([
        (w0 * A[0] + w1 * V[0] + w2 * B[0]) / d,
        (w0 * A[1] + w1 * V[1] + w2 * B[1]) / d,
        (w0 * A[2] + w1 * V[2] + w2 * B[2]) / d,
      ]);
    }
  }
  out.push(B);
  return out;
}

interface VertexBevel {
  ptFace: (number | null)[]; // vertex id of point M_i (or null)
  ptSlot: (number | null)[]; // vertex id of slide point on non-beveled slot
  fan: FanInfo;
  slotEdge: number[]; // edge key at slot j
  slotBevel: boolean[];
  runs: Map<number, number[]>; // face -> replacement run for v
  ptPos: Map<number, V3>;
}


/** Centre of the circular profile arc between A and B around corner V (same construction as profilePoints). */
function arcCentre(A: V3, B: V3, V: V3): V3 | null {
  const a = v3.sub(A, V);
  const b = v3.sub(B, V);
  const la = v3.len(a);
  const lb = v3.len(b);
  if (la < 1e-9 || lb < 1e-9) return null;
  const cosPhi = Math.max(-1, Math.min(1, v3.dot(a, b) / (la * lb)));
  const phi = Math.acos(cosPhi);
  if (phi < 1e-4 || phi > Math.PI - 1e-4) return null;
  const bis = v3.norm(v3.add(v3.scale(a, 1 / la), v3.scale(b, 1 / lb)));
  return v3.add(V, v3.scale(bis, la / Math.cos(phi / 2)));
}

/**
 * Blender-style vertex mesh for a corner where three bevelled edges meet.
 * Even segment counts get a centre vertex with three h x h quad grids; three
 * segments get a centre triangle. Interior points are projected onto the sphere
 * through the boundary so the corner is round. Returns null when unsupported.
 */
function cornerPatch3(
  B: number[],
  ns: number,
  V: V3,
  centres: V3[],
  alloc: (p: V3) => number,
  posOf: (id: number) => V3,
): number[][] | null {
  if (B.length !== 3 * ns || (ns % 2 === 1 && ns !== 3)) return null;
  const P = B.map(posOf);
  // Sphere through the boundary: centre from the three arc centres.
  let S: V3 | null = null;
  if (centres.length === 3) S = v3.scale(v3.add(v3.add(centres[0], centres[1]), centres[2]), 1 / 3);
  let R = 0;
  if (S) {
    for (const p of P) R += v3.dist(p, S);
    R /= P.length;
  }
  const proj = (p: V3): V3 => {
    if (!S || R < 1e-9) return p;
    const d = v3.sub(p, S);
    const l = v3.len(d);
    return l < 1e-9 ? p : v3.add(S, v3.scale(d, R / l));
  };
  const cen: V3 = [0, 0, 0];
  for (const p of P) {
    cen[0] += p[0] / P.length;
    cen[1] += p[1] / P.length;
    cen[2] += p[2] / P.length;
  }
  const faces: number[][] = [];
  const fix = (f: number[]) => {
    // outward = away from the sphere centre (or from V's inside if no sphere)
    const n = newellOf(f.map(posOf));
    const c: V3 = [0, 0, 0];
    for (const id of f) {
      const p = posOf(id);
      c[0] += p[0] / f.length;
      c[1] += p[1] / f.length;
      c[2] += p[2] / f.length;
    }
    const out = S ? v3.sub(c, S) : v3.sub(c, V);
    faces.push(v3.dot(n, out) >= 0 ? f : f.slice().reverse());
  };
  const M = [B[0], B[ns], B[2 * ns]];
  if (ns === 3) {
    // centre triangle T_s inward of each M_s, two quads per sector.
    const T: number[] = [];
    for (let s = 0; s < 3; s++) {
      const m = P[s * ns];
      if (S) {
        const uM = v3.norm(v3.sub(m, S));
        const uC = v3.norm(v3.sub(cen, S));
        T.push(alloc(proj(v3.add(S, v3.scale(v3.norm(v3.add(v3.scale(uM, 0.24), v3.scale(uC, 0.76))), R)))));
      } else T.push(alloc(v3.lerp(m, cen, 0.6)));
    }
    for (let s = 0; s < 3; s++) {
      const b = (j: number) => B[(s * ns + j) % (3 * ns)];
      fix([T[s], b(0), b(1), b(2)]);
      fix([b(2), b(3), T[(s + 1) % 3], T[s]]);
    }
    fix([T[0], T[1], T[2]]);
    void M;
    return faces;
  }
  const h = ns / 2;
  const C = alloc(proj([cen[0], cen[1], cen[2]]));
  // Radial chains C -> M_s.
  const rad: number[][] = [];
  for (let s = 0; s < 3; s++) {
    const chain: number[] = [C];
    for (let t = 1; t < h; t++) chain.push(alloc(proj(v3.lerp(posOf(C), P[s * ns], t / h))));
    chain.push(B[s * ns]);
    rad.push(chain);
  }
  for (let s = 0; s < 3; s++) {
    const G: number[][] = Array.from({ length: h + 1 }, () => new Array(h + 1).fill(-1));
    for (let j = 0; j <= h; j++) G[h][j] = B[(s * ns + j) % (3 * ns)];
    for (let i = 0; i <= h; i++) G[i][h] = B[(s * ns + ns - i) % (3 * ns)];
    for (let i = 0; i <= h; i++) G[i][0] = rad[s][i];
    for (let j = 0; j <= h; j++) G[0][j] = rad[(s + 1) % 3][j];
    for (let i = 1; i < h; i++) {
      for (let j = 1; j < h; j++) {
        const a = i / h;
        const b = j / h;
        const g = (x: number, y: number) => posOf(G[x][y]);
        const p: V3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          p[k] =
            (1 - a) * g(0, j)[k] + a * g(h, j)[k] + (1 - b) * g(i, 0)[k] + b * g(i, h)[k] -
            ((1 - a) * (1 - b) * g(0, 0)[k] + a * (1 - b) * g(h, 0)[k] + (1 - a) * b * g(0, h)[k] + a * b * g(h, h)[k]);
        }
        G[i][j] = alloc(proj(p));
      }
    }
    for (let i = 0; i < h; i++) for (let j = 0; j < h; j++) fix([G[i][j], G[i][j + 1], G[i + 1][j + 1], G[i + 1][j]]);
  }
  return faces;
}

function newellOf(pts: V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

export function bevelEdges(m: EditMesh, s: Selection, opts: BevelOptions): boolean {
  const width = opts.width;
  const segs = Math.max(1, Math.floor(opts.segments));
  const profile = opts.profile ?? 0.5;
  const em = m.edgeMap();
  const B = new Set<number>();
  for (const k of s.e) {
    const info = em.get(k);
    if (info && info.faces.length === 2 && info.faces[0] !== info.faces[1]) B.add(k);
  }
  if (!B.size) return false;
  const vf = m.vertFaces();
  const affected = new Set<number>();
  for (const k of B) {
    affected.add(ekLo(k));
    affected.add(ekHi(k));
  }

  const infos = new Map<number, VertexBevel>();
  const newCo: V3[] = []; // positions of new vertices allocated lazily
  const base = m.co.length;
  const alloc = (p: V3): number => {
    newCo.push(p);
    return base + newCo.length - 1;
  };
  const posOf = (id: number): V3 => (id >= base ? newCo[id - base] : m.co[id]);

  for (const v of affected) {
    const fan = buildFan(m, v, vf[v]);
    if (!fan) continue;
    const k = fan.faces.length;
    const slots = fan.closed ? k : k + 1;
    const slotEdge: number[] = [];
    for (let j = 0; j < slots; j++) {
      const other = j < k ? fan.prev[j] : fan.next[k - 1];
      slotEdge.push(ek(v, other));
    }
    const slotBevel = slotEdge.map((e) => B.has(e));
    const ptFace: (number | null)[] = new Array(k).fill(null);
    const ptSlot: (number | null)[] = new Array(slots).fill(null);
    const facePos: (V3 | null)[] = new Array(k).fill(null);
    const slidOnto: (number | null)[] = new Array(k).fill(null); // slot index the face slides onto (or -1 when both bev)
    const slotAt = (j: number) => (fan.closed ? j % k : j);
    for (let i = 0; i < k; i++) {
      const bp = slotBevel[slotAt(i)];
      const bn = slotBevel[slotAt(i + 1)];
      if (!bp && !bn) continue;
      const P = m.co[v];
      const up = v3.norm(v3.sub(m.co[fan.prev[i]], P));
      const un = v3.norm(v3.sub(m.co[fan.next[i]], P));
      const cosT = v3.dot(up, un);
      const sinT = Math.max(0.05, Math.sqrt(Math.max(0, 1 - cosT * cosT)));
      const lenP = v3.dist(m.co[fan.prev[i]], P);
      const lenN = v3.dist(m.co[fan.next[i]], P);
      if (bp && bn) {
        const d = Math.min(width / sinT, 0.5 * Math.min(lenP, lenN));
        facePos[i] = v3.add(P, v3.scale(v3.add(up, un), d));
        slidOnto[i] = -1;
      } else if (bp) {
        const d = Math.min(width / sinT, 0.5 * lenN);
        facePos[i] = v3.add(P, v3.scale(un, d));
        slidOnto[i] = slotAt(i + 1);
      } else {
        const d = Math.min(width / sinT, 0.5 * lenP);
        facePos[i] = v3.add(P, v3.scale(up, d));
        slidOnto[i] = slotAt(i);
      }
    }
    // Merge slide points that land on the same non-beveled slot.
    const slotCand = new Map<number, number[]>();
    for (let i = 0; i < k; i++) {
      const sl = slidOnto[i];
      if (sl !== null && sl >= 0) (slotCand.get(sl) ?? slotCand.set(sl, []).get(sl)!).push(i);
    }
    for (const [sl, faces] of slotCand) {
      const avg: V3 = [0, 0, 0];
      for (const i of faces) {
        avg[0] += facePos[i]![0] / faces.length;
        avg[1] += facePos[i]![1] / faces.length;
        avg[2] += facePos[i]![2] / faces.length;
      }
      const id = alloc(avg);
      ptSlot[sl] = id;
      for (const i of faces) ptFace[i] = id;
    }
    for (let i = 0; i < k; i++) {
      if (facePos[i] && ptFace[i] === null) ptFace[i] = alloc(facePos[i]!);
    }
    infos.set(v, { ptFace, ptSlot, fan, slotEdge, slotBevel, runs: new Map(), ptPos: new Map() });
  }
  if (!infos.size) return false;

  // Face runs.
  for (const [v, vb] of infos) {
    const { fan, ptFace, ptSlot, slotBevel } = vb;
    const k = fan.faces.length;
    const slotAt = (j: number) => (fan.closed ? j % k : j);
    for (let i = 0; i < k; i++) {
      const sPrev = slotAt(i);
      const sNext = slotAt(i + 1);
      const start = slotBevel[sPrev] ? ptFace[i] : ptSlot[sPrev] ?? v;
      const end = slotBevel[sNext] ? ptFace[i] : ptSlot[sNext] ?? v;
      const run = start === end ? [start!] : [start!, end!];
      vb.runs.set(fan.faces[i], run);
    }
  }

  // Per-edge profiles and strip faces.
  const stripFaces: number[][] = [];
  const capFaces: number[][] = [];
  const extraAbsorb = new Map<string, number[]>(); // `${v}:${face}` -> replacement run
  const profileAt = new Map<string, number[]>(); // `${edge}:${v}` -> vertex ids A..B

  const arcCentres = new Map<string, V3>();
  const pointArcIds = (A: number, Bp: number, V: V3, edgeDir: V3, key: string): number[] => {
    // The profile lives in the plane perpendicular to the edge: reference the corner at the arc's axial position.
    const pa = posOf(A);
    const pb = posOf(Bp);
    const axial = (v3.dot(v3.sub(pa, V), edgeDir) + v3.dot(v3.sub(pb, V), edgeDir)) / 2;
    const Vref = v3.add(V, v3.scale(edgeDir, axial));
    const ctr = arcCentre(pa, pb, Vref);
    if (ctr) arcCentres.set(key, ctr);
    const pts = profilePoints(pa, pb, Vref, segs, profile);
    const ids = [A];
    for (let i = 1; i < pts.length - 1; i++) ids.push(alloc(pts[i]));
    ids.push(Bp);
    return ids;
  };

  for (const [v, vb] of infos) {
    const { fan, ptFace } = vb;
    const k = fan.faces.length;
    const slots = fan.closed ? k : k + 1;
    for (let j = 0; j < slots; j++) {
      if (!vb.slotBevel[j]) continue;
      const before = fan.closed ? (j + k - 1) % k : j - 1;
      const after = j < k ? j : -1;
      if (before < 0 || after < 0) continue;
      const A = ptFace[before]!;
      const Bp = ptFace[after]!;
      const ek_ = vb.slotEdge[j];
      const other = ekLo(ek_) === v ? ekHi(ek_) : ekLo(ek_);
      const edgeDir = v3.norm(v3.sub(m.co[other], m.co[v]));
      profileAt.set(ek_ + ':' + v, pointArcIds(A, Bp, m.co[v], edgeDir, ek_ + ':' + v));
    }
  }
  for (const k of B) {
    const a = ekLo(k);
    const b = ekHi(k);
    const info = em.get(k)!;
    const [f0, f1] = info.faces;
    // fA: face where the edge runs from -> to
    const runsAB = (() => {
      const f = m.faces[f0];
      const ia = f.indexOf(a);
      return f[(ia + 1) % f.length] === b;
    })();
    const fA = runsAB ? f0 : f1;
    void fA;
    // At vertex `from` the arc goes A(fA)->B(fB); at `to` the arc is stored A'(fA-after)->B'(fB-before)
    // relative to that vertex's own fan, which by construction is also A->B in the same sense.
    const from = runsAB ? a : b;
    const to = runsAB ? b : a;
    const pf = profileAt.get(k + ':' + from);
    const pt = profileAt.get(k + ':' + to);
    if (!pf || !pt) continue;
    // Arc at `to` was built in `to`'s fan order (before->after) = fB-side -> fA-side, so reverse it.
    const ptRev = pt.slice().reverse();
    for (let i = 0; i < pf.length - 1; i++) {
      stripFaces.push([ptRev[i], pf[i], pf[i + 1], ptRev[i + 1]]);
    }
  }

  // Corner caps / absorbing arcs.
  for (const [v, vb] of infos) {
    const { fan, ptFace } = vb;
    const k = fan.faces.length;
    const slots = fan.closed ? k : k + 1;
    const bevSlots: number[] = [];
    for (let j = 0; j < slots; j++) if (vb.slotBevel[j] && (fan.closed || (j > 0 && j < k))) bevSlots.push(j);
    if (!bevSlots.length) continue;
    // Build chain segments in fan order.
    const arcs = bevSlots.map((j) => profileAt.get(vb.slotEdge[j] + ':' + v)!);
    const segments: number[][] = [];
    let cur: number[] = arcs[0].slice();
    for (let x = 1; x < arcs.length; x++) {
      const arc = arcs[x];
      if (cur[cur.length - 1] === arc[0]) cur = cur.concat(arc.slice(1));
      else {
        segments.push(cur);
        cur = arc.slice();
      }
    }
    segments.push(cur);
    // Closed loop when last point meets first point.
    if (segments.length === 1 && segments[0][0] === segments[0][segments[0].length - 1]) {
      const loop = segments[0].slice(0, -1);
      const patch = segs > 1 && bevSlots.length === 3 ? cornerPatch3(loop, segs, m.co[v], bevSlots.map((j) => arcCentres.get(vb.slotEdge[j] + ':' + v)).filter((c): c is V3 => !!c), alloc, posOf) : null;
      if (patch) for (const f of patch) capFaces.push(f);
      else if (loop.length >= 3) capFaces.push(loop);
      continue;
    }
    if (segments.length > 1 && segments[segments.length - 1][segments[segments.length - 1].length - 1] === segments[0][0]) {
      const last = segments.pop()!;
      segments[0] = last.concat(segments[0].slice(1));
      if (segments.length === 1 && segments[0][0] === segments[0][segments[0].length - 1]) {
        const loop = segments[0].slice(0, -1);
        const patch = segs > 1 && bevSlots.length === 3 ? cornerPatch3(loop, segs, m.co[v], bevSlots.map((j) => arcCentres.get(vb.slotEdge[j] + ':' + v)).filter((c): c is V3 => !!c), alloc, posOf) : null;
        if (patch) for (const f of patch) capFaces.push(f);
        else if (loop.length >= 3) capFaces.push(loop);
        continue;
      }
    }
    for (const seg of segments) {
      if (seg.length <= 2) continue;
      const Pm = seg[seg.length - 1];
      const P0 = seg[0];
      // Find an unaffected face whose run is exactly [Pm, P0].
      let absorbed = false;
      for (const fi of fan.faces) {
        const run = vb.runs.get(fi)!;
        if (run.length === 2 && run[0] === Pm && run[1] === P0) {
          const interior = seg.slice(1, -1).reverse();
          extraAbsorb.set(v + ':' + fi, [Pm, ...interior, P0]);
          absorbed = true;
          break;
        }
      }
      if (!absorbed) capFaces.push(seg.slice());
    }
    void ptFace;
  }

  // Commit: allocate vertices, rebuild faces.
  for (const p of newCo) m.addVert(p);
  const newFaces: number[][] = [];
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    let touched = false;
    const out: number[] = [];
    for (const v of f) {
      const vb = infos.get(v);
      if (!vb) {
        out.push(v);
        continue;
      }
      const ab = extraAbsorb.get(v + ':' + fi);
      const run = ab ?? vb.runs.get(fi);
      if (!run) {
        out.push(v);
        continue;
      }
      touched = true;
      for (const r of run) out.push(r);
    }
    newFaces.push(touched ? out : f);
  }
  m.faces = newFaces;
  const before = m.faces.length;
  for (const f of stripFaces) m.faces.push(f);
  // Wind cap polygons opposite to their neighbours' shared edges.
  const directed = new Set<string>();
  for (const f of m.faces) for (let i = 0; i < f.length; i++) directed.add(f[i] + '>' + f[(i + 1) % f.length]);
  for (const f of capFaces) {
    let same = 0;
    let opp = 0;
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      if (directed.has(a + '>' + b)) same++;
      if (directed.has(b + '>' + a)) opp++;
    }
    m.faces.push(same > opp ? f.slice().reverse() : f);
  }
  void before;
  m.cleanupFaces();
  const orphan = m.orphanVerts();
  const remap = orphan.size ? m.removeVerts(orphan) : null;

  // Selection: new strip geometry (Blender selects the bevel result edges).
  const sel = new Selection();
  const mapV = (v: number) => (remap ? remap[v] : v);
  for (const arr of profileAt.values()) for (const v of arr) if (mapV(v) >= 0) sel.v.add(mapV(v));
  s.v = sel.v;
  s.e.clear();
  s.f.clear();
  flushSelection(m, s, 'vert');
  return true;
}

export function bevelVertices(m: EditMesh, s: Selection, opts: BevelOptions): boolean {
  const width = opts.width;
  const segs = Math.max(1, Math.floor(opts.segments));
  const profile = opts.profile ?? 0.5;
  if (!s.v.size) return false;
  const vf = m.vertFaces();
  const ve = m.vertEdges();
  const base = m.co.length;
  const newCo: V3[] = [];
  const alloc = (p: V3) => {
    newCo.push(p);
    return base + newCo.length - 1;
  };
  const runs = new Map<string, number[]>();
  const caps: number[][] = [];
  const done = new Set<number>();
  for (const v of s.v) {
    const fan = buildFan(m, v, vf[v]);
    if (!fan || !fan.closed) {
      // Boundary vertices: only handle fully closed fans.
      continue;
    }
    const k = fan.faces.length;
    const P = m.co[v];
    const pts: number[] = [];
    const posByEdgeOther = new Map<number, number>();
    for (let i = 0; i < k; i++) {
      const other = fan.prev[i];
      const len = v3.dist(m.co[other], P);
      const d = Math.min(width, 0.5 * len);
      const p = v3.add(P, v3.scale(v3.norm(v3.sub(m.co[other], P)), d));
      const id = alloc(p);
      pts.push(id);
      posByEdgeOther.set(other, id);
    }
    // Between consecutive slots i and i+1 (face i): arc points.
    const capLoop: number[] = [];
    for (let i = 0; i < k; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % k];
      const arc = segs > 1 ? profilePoints(newCo[a - base], newCo[b - base], P, segs, profile) : [newCo[a - base], newCo[b - base]];
      const ids = [a];
      for (let x = 1; x < arc.length - 1; x++) ids.push(alloc(arc[x]));
      ids.push(b);
      runs.set(v + ':' + fan.faces[i], ids);
      for (let x = 0; x < ids.length - 1; x++) capLoop.push(ids[x]);
    }
    caps.push(capLoop);
    done.add(v);
    void ve;
  }
  if (!done.size) return false;
  for (const p of newCo) m.addVert(p);
  const out: number[][] = [];
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    const o: number[] = [];
    for (const v of f) {
      const r = runs.get(v + ':' + fi);
      if (r && done.has(v)) o.push(...r);
      else o.push(v);
    }
    out.push(o);
  }
  m.faces = out.concat(caps);
  m.touch();
  const orphan = m.orphanVerts();
  const remap = orphan.size ? m.removeVerts(orphan) : null;
  const sel = new Selection();
  for (const cap of caps) for (const v of cap) {
    const nv = remap ? remap[v] : v;
    if (nv >= 0) sel.v.add(nv);
  }
  s.v = sel.v;
  s.e.clear();
  s.f.clear();
  flushSelection(m, s, 'vert');
  return true;
}
