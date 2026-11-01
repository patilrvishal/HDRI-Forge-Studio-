import { EditMesh, v3, type V3 } from './EditMesh';

/**
 * Mesh primitives. Topology (vertex / edge / face counts) matches Blender's
 * Add > Mesh defaults; axes are Y-up (three.js) instead of Blender's Z-up.
 */

export type PrimitiveKind =
  | 'cube'
  | 'plane'
  | 'circle'
  | 'grid'
  | 'uvsphere'
  | 'icosphere'
  | 'cylinder'
  | 'cone'
  | 'torus';

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: 'Cube',
  plane: 'Plane',
  circle: 'Circle',
  grid: 'Grid',
  uvsphere: 'UV Sphere',
  icosphere: 'Ico Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Torus',
};

export interface PrimitiveParams {
  size?: number;
  radius?: number;
  depth?: number;
  segments?: number;
  rings?: number;
  subdivisions?: number;
  xSegments?: number;
  ySegments?: number;
  majorSegments?: number;
  minorSegments?: number;
  majorRadius?: number;
  minorRadius?: number;
  radius2?: number;
  fill?: 'ngon' | 'trifan' | 'none';
}

/** Flip every face so normals point away from the centroid (closed shapes only). */
function orientOutward(m: EditMesh): void {
  const c: V3 = [0, 0, 0];
  for (const p of m.co) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const n = Math.max(1, m.co.length);
  c[0] /= n;
  c[1] /= n;
  c[2] /= n;
  let score = 0;
  for (let fi = 0; fi < m.faces.length; fi++) {
    score += v3.dot(m.faceNormal(fi), v3.sub(m.faceCenter(fi), c));
  }
  if (score < 0) for (const f of m.faces) f.reverse();
  m.touch();
}

export function makeCube(size = 2): EditMesh {
  const m = new EditMesh();
  const h = size / 2;
  for (const y of [-h, h]) for (const z of [-h, h]) for (const x of [-h, h]) m.addVert([x, y, z]);
  // index = x + 2*z + 4*y  (x fastest)
  const idx = (x: number, y: number, z: number) => x + 2 * z + 4 * y;
  m.addFace([idx(0, 0, 0), idx(1, 0, 0), idx(1, 0, 1), idx(0, 0, 1)]); // -Y
  m.addFace([idx(0, 1, 0), idx(0, 1, 1), idx(1, 1, 1), idx(1, 1, 0)]); // +Y
  m.addFace([idx(0, 0, 0), idx(0, 1, 0), idx(1, 1, 0), idx(1, 0, 0)]); // -Z
  m.addFace([idx(0, 0, 1), idx(1, 0, 1), idx(1, 1, 1), idx(0, 1, 1)]); // +Z
  m.addFace([idx(0, 0, 0), idx(0, 0, 1), idx(0, 1, 1), idx(0, 1, 0)]); // -X
  m.addFace([idx(1, 0, 0), idx(1, 1, 0), idx(1, 1, 1), idx(1, 0, 1)]); // +X
  orientOutward(m);
  return m;
}

export function makeGrid(xSeg = 1, ySeg = 1, size = 2): EditMesh {
  const m = new EditMesh();
  const h = size / 2;
  for (let j = 0; j <= ySeg; j++) {
    for (let i = 0; i <= xSeg; i++) {
      m.addVert([-h + (size * i) / xSeg, 0, -h + (size * j) / ySeg]);
    }
  }
  const w = xSeg + 1;
  for (let j = 0; j < ySeg; j++) {
    for (let i = 0; i < xSeg; i++) {
      const a = j * w + i;
      // CCW seen from +Y
      m.addFace([a, a + w, a + w + 1, a + 1]);
    }
  }
  m.touch();
  return m;
}

export function makeCircle(segments = 32, radius = 1, fill: 'ngon' | 'trifan' | 'none' = 'ngon'): EditMesh {
  const m = new EditMesh();
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    m.addVert([Math.cos(a) * radius, 0, -Math.sin(a) * radius]);
  }
  if (fill === 'ngon') {
    m.addFace(Array.from({ length: segments }, (_, i) => i));
  } else if (fill === 'trifan') {
    const c = m.addVert([0, 0, 0]);
    for (let i = 0; i < segments; i++) m.addFace([c, i, (i + 1) % segments]);
  } else {
    for (let i = 0; i < segments; i++) m.addLoose(i, (i + 1) % segments);
  }
  m.touch();
  return m;
}

export function makeUVSphere(segments = 32, rings = 16, radius = 1): EditMesh {
  const m = new EditMesh();
  const top = m.addVert([0, radius, 0]);
  for (let j = 1; j < rings; j++) {
    const phi = (Math.PI * j) / rings;
    for (let i = 0; i < segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      m.addVert([
        radius * Math.sin(phi) * Math.cos(th),
        radius * Math.cos(phi),
        -radius * Math.sin(phi) * Math.sin(th),
      ]);
    }
  }
  const bottom = m.addVert([0, -radius, 0]);
  const ring = (j: number, i: number) => 1 + (j - 1) * segments + (i % segments);
  for (let i = 0; i < segments; i++) m.addFace([top, ring(1, i), ring(1, i + 1)]);
  for (let j = 1; j < rings - 1; j++) {
    for (let i = 0; i < segments; i++) {
      m.addFace([ring(j, i), ring(j + 1, i), ring(j + 1, i + 1), ring(j, i + 1)]);
    }
  }
  for (let i = 0; i < segments; i++) m.addFace([bottom, ring(rings - 1, i + 1), ring(rings - 1, i)]);
  orientOutward(m);
  return m;
}

export function makeIcoSphere(subdivisions = 2, radius = 1): EditMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => v3.norm(p as V3));
  let tris: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 1; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      verts.push(v3.norm(v3.mid(verts[a], verts[b])));
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  const m = new EditMesh();
  for (const p of verts) m.addVert(v3.scale(p, radius));
  for (const f of tris) m.addFace(f);
  orientOutward(m);
  verts = [];
  return m;
}

export function makeCylinder(
  segments = 32,
  radius1 = 1,
  radius2 = 1,
  depth = 2,
  fill: 'ngon' | 'trifan' | 'none' = 'ngon',
): EditMesh {
  const m = new EditMesh();
  const h = depth / 2;
  const ringVerts = (r: number, y: number): number[] => {
    if (r <= 1e-9) return [m.addVert([0, y, 0])];
    const out: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      out.push(m.addVert([Math.cos(a) * r, y, -Math.sin(a) * r]));
    }
    return out;
  };
  const bottom = ringVerts(radius1, -h);
  const top = ringVerts(radius2, h);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    if (bottom.length === 1) m.addFace([bottom[0], top[j], top[i]]);
    else if (top.length === 1) m.addFace([bottom[i], bottom[j], top[0]]);
    else m.addFace([bottom[i], bottom[j], top[j], top[i]]);
  }
  const cap = (ring: number[], y: number) => {
    if (ring.length < 3 || fill === 'none') return;
    if (fill === 'ngon') m.addFace(ring);
    else {
      const c = m.addVert([0, y, 0]);
      for (let i = 0; i < ring.length; i++) m.addFace([c, ring[i], ring[(i + 1) % ring.length]]);
    }
  };
  cap(bottom, -h);
  cap(top, h);
  orientOutward(m);
  return m;
}

export function makeCone(segments = 32, radius1 = 1, radius2 = 0, depth = 2, fill: 'ngon' | 'trifan' | 'none' = 'ngon'): EditMesh {
  return makeCylinder(segments, radius1, radius2, depth, fill);
}

export function makeTorus(majorSeg = 48, minorSeg = 12, majorR = 1, minorR = 0.25): EditMesh {
  const m = new EditMesh();
  for (let i = 0; i < majorSeg; i++) {
    const a = (i / majorSeg) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let j = 0; j < minorSeg; j++) {
      const b = (j / minorSeg) * Math.PI * 2;
      const r = majorR + minorR * Math.cos(b);
      m.addVert([ca * r, minorR * Math.sin(b), -sa * r]);
    }
  }
  const id = (i: number, j: number) => (i % majorSeg) * minorSeg + (j % minorSeg);
  for (let i = 0; i < majorSeg; i++) {
    for (let j = 0; j < minorSeg; j++) {
      m.addFace([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  }
  // Torus centroid is the origin, so the generic outward test works.
  orientOutward(m);
  return m;
}

export function makePrimitive(kind: PrimitiveKind, p: PrimitiveParams = {}): EditMesh {
  switch (kind) {
    case 'cube':
      return makeCube(p.size ?? 2);
    case 'plane':
      return makeGrid(1, 1, p.size ?? 2);
    case 'grid':
      return makeGrid(p.xSegments ?? 10, p.ySegments ?? 10, p.size ?? 2);
    case 'circle':
      return makeCircle(p.segments ?? 32, p.radius ?? 1, p.fill ?? 'ngon');
    case 'uvsphere':
      return makeUVSphere(p.segments ?? 32, p.rings ?? 16, p.radius ?? 1);
    case 'icosphere':
      return makeIcoSphere(p.subdivisions ?? 2, p.radius ?? 1);
    case 'cylinder':
      return makeCylinder(p.segments ?? 32, p.radius ?? 1, p.radius ?? 1, p.depth ?? 2, p.fill ?? 'ngon');
    case 'cone':
      return makeCone(p.segments ?? 32, p.radius ?? 1, p.radius2 ?? 0, p.depth ?? 2, p.fill ?? 'ngon');
    case 'torus':
      return makeTorus(p.majorSegments ?? 48, p.minorSegments ?? 12, p.majorRadius ?? 1, p.minorRadius ?? 0.25);
  }
}
