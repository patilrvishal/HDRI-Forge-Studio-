import { EditMesh, ek, type V3 } from './EditMesh';

const avg = (pts: V3[]): V3 => {
  const o: V3 = [0, 0, 0];
  for (const p of pts) { o[0] += p[0]; o[1] += p[1]; o[2] += p[2]; }
  const n = Math.max(1, pts.length);
  return [o[0] / n, o[1] / n, o[2] / n];
};

/** One Catmull-Clark step: every face becomes quads, the surface rounds off (open boundaries stay on their edge curve). */
function step(m: EditMesh): void {
  const old = m.co;
  const nV = old.length;
  const fp: V3[] = m.faces.map((f) => avg(f.map((i) => old[i])));
  const edgeFaces = new Map<number, number[]>();
  const vertFaces: number[][] = Array.from({ length: nV }, () => []);
  const vertEdges: Set<number>[] = Array.from({ length: nV }, () => new Set<number>());
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = ek(a, b);
      const list = edgeFaces.get(k);
      if (list) list.push(fi); else edgeFaces.set(k, [fi]);
      vertEdges[a].add(k); vertEdges[b].add(k);
    }
    for (const v of f) vertFaces[v].push(fi);
  });
  const endpoints = (k: number): [number, number] => {
    for (const fi of edgeFaces.get(k)!) {
      const f = m.faces[fi];
      for (let i = 0; i < f.length; i++) if (ek(f[i], f[(i + 1) % f.length]) === k) return [f[i], f[(i + 1) % f.length]];
    }
    return [0, 0];
  };
  const edgeIndex = new Map<number, number>();
  const edgeCo: V3[] = [];
  const mid = new Map<number, V3>();
  for (const [k, fs] of edgeFaces) {
    const [a, b] = endpoints(k);
    const mp = avg([old[a], old[b]]);
    mid.set(k, mp);
    const pt = fs.length === 2 ? avg([old[a], old[b], fp[fs[0]], fp[fs[1]]]) : mp;
    edgeIndex.set(k, nV + edgeCo.length);
    edgeCo.push(pt);
  }
  const faceBase = nV + edgeCo.length;
  const out: V3[] = [];
  for (let v = 0; v < nV; v++) {
    const ek_ = Array.from(vertEdges[v]);
    if (!ek_.length) { out.push([old[v][0], old[v][1], old[v][2]]); continue; }       // loose vertex
    const boundary = ek_.filter((k) => edgeFaces.get(k)!.length === 1);
    if (boundary.length >= 2) {
      const nb = boundary.slice(0, 2).map((k) => { const [a, b] = endpoints(k); return old[a === v ? b : a]; });
      out.push([(6 * old[v][0] + nb[0][0] + nb[1][0]) / 8, (6 * old[v][1] + nb[0][1] + nb[1][1]) / 8, (6 * old[v][2] + nb[0][2] + nb[1][2]) / 8]);
      continue;
    }
    const n = ek_.length;
    const F = avg(vertFaces[v].map((fi) => fp[fi]));
    const R = avg(ek_.map((k) => mid.get(k)!));
    out.push([0, 1, 2].map((c) => (F[c] + 2 * R[c] + (n - 3) * old[v][c]) / n) as V3);
  }
  const newFaces: number[][] = [];
  m.faces.forEach((f, fi) => {
    const n = f.length;
    for (let i = 0; i < n; i++) {
      const prev = f[(i + n - 1) % n], cur = f[i], next = f[(i + 1) % n];
      newFaces.push([cur, edgeIndex.get(ek(cur, next))!, faceBase + fi, edgeIndex.get(ek(prev, cur))!]);
    }
  });
  m.co = [...out, ...edgeCo, ...fp];
  m.faces = newFaces;
  m.seam.clear();
  m.sharp.clear();
}

/** Subdivision surface (Catmull-Clark), `levels` times. Returns false when there is nothing to subdivide. */
export function catmullClark(m: EditMesh, levels = 1): boolean {
  if (!m.faces.length) return false;
  for (let i = 0; i < levels; i++) step(m);
  m.touch();
  return true;
}
