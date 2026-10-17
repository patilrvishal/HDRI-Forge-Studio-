import { v3, newellNormal, type V3 } from './EditMesh';

/**
 * Triangulate a (possibly concave) planar-ish polygon with ear clipping.
 * Returns triangles as triples of vertex ids taken from `loop`.
 */
export function triangulateLoop(co: V3[], loop: number[]): number[][] {
  const n = loop.length;
  if (n < 3) return [];
  if (n === 3) return [[loop[0], loop[1], loop[2]]];
  if (n === 4) {
    // Blender "Beauty" style: split a quad along the shorter diagonal.
    const [a, b, c, d] = loop;
    const d1 = v3.dist(co[a], co[c]);
    const d2 = v3.dist(co[b], co[d]);
    return d1 <= d2 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
  }

  const nrm = newellNormal(co, loop);
  // Project to the dominant plane.
  const ax = Math.abs(nrm[0]);
  const ay = Math.abs(nrm[1]);
  const az = Math.abs(nrm[2]);
  const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const sign = nrm[drop] >= 0 ? 1 : -1;
  const pt = (v: number): [number, number] => {
    const p = co[v];
    if (drop === 0) return [p[1] * sign, p[2]];
    if (drop === 1) return [p[2] * sign, p[0]];
    return [p[0] * sign, p[1]];
  };

  const idx = loop.map((_, i) => i);
  const P = loop.map((v) => pt(v));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    const pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(neg && pos);
  };

  const tris: number[][] = [];
  let guard = idx.length * idx.length + 10;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const A = P[ia];
      const B = P[ib];
      const C = P[ic];
      if (cross(A, B, C) <= 1e-14) continue; // reflex or degenerate
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(P[j], A, B, C)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push([loop[ia], loop[ib], loop[ic]]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate polygon: fall back to a fan so we still emit something.
      for (let i = 1; i < idx.length - 1; i++) tris.push([loop[idx[0]], loop[idx[i]], loop[idx[i + 1]]]);
      return tris;
    }
  }
  if (idx.length === 3) tris.push([loop[idx[0]], loop[idx[1]], loop[idx[2]]]);
  return tris;
}
