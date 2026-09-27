import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { EditMesh, v3, newellNormal, type V3 } from './EditMesh';
import { triangulateLoop } from './triangulate';

export interface BuiltGeometry {
  geometry: THREE.BufferGeometry;
  /** For each triangle, the index of the polygon face it came from. */
  triToFace: Int32Array;
}

/** Box-projected UVs (dominant axis of the face normal), 1 unit = 1 world unit. */
function boxUV(p: V3, n: V3): [number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [p[2], p[1]];
  if (ay >= az) return [p[0], p[2]];
  return [p[0], p[1]];
}

/** Sharp-edge aware smooth normals: faces are grouped per vertex by connectivity through non-sharp edges. */
function smoothNormals(m: EditMesh, tris: number[][], triFace: number[]): Float32Array {
  const faceN = m.faces.map((_, i) => m.faceNormal(i));
  // Angle-weighted vertex normals per (vertex) - sharp edges split via face grouping.
  const acc = new Map<number, V3>();
  const key = (v: number, g: number) => v * 4096 + g;
  void key;
  const vf = m.vertFaces();
  // group id per (face,vertex): flood through shared non-sharp edges
  const group = new Map<string, number>();
  for (let v = 0; v < m.co.length; v++) {
    const faces = vf[v];
    const seen = new Set<number>();
    let g = 0;
    for (const f0 of faces) {
      if (seen.has(f0)) continue;
      const stack = [f0];
      seen.add(f0);
      const sum: V3 = [0, 0, 0];
      const members: number[] = [];
      while (stack.length) {
        const f = stack.pop()!;
        members.push(f);
        const w = faceAngleAt(m, f, v);
        sum[0] += faceN[f][0] * w;
        sum[1] += faceN[f][1] * w;
        sum[2] += faceN[f][2] * w;
        const loop = m.faces[f];
        const i = loop.indexOf(v);
        for (const nb of [loop[(i + 1) % loop.length], loop[(i + loop.length - 1) % loop.length]]) {
          const k = v < nb ? v * 1048576 + nb : nb * 1048576 + v;
          if (m.sharp.has(k)) continue;
          for (const g2 of vf[v]) {
            if (seen.has(g2)) continue;
            const l2 = m.faces[g2];
            if (l2.includes(nb) && (l2[(l2.indexOf(v) + 1) % l2.length] === nb || l2[(l2.indexOf(v) + l2.length - 1) % l2.length] === nb)) {
              seen.add(g2);
              stack.push(g2);
            }
          }
        }
      }
      const n = v3.norm(sum);
      for (const f of members) group.set(f + ':' + v, g);
      acc.set(v * 4096 + g, n);
      g++;
    }
  }
  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => {
    const f = triFace[ti];
    for (let c = 0; c < 3; c++) {
      const v = t[c];
      const g = group.get(f + ':' + v) ?? 0;
      const n = acc.get(v * 4096 + g) ?? faceN[f];
      out[ti * 9 + c * 3] = n[0];
      out[ti * 9 + c * 3 + 1] = n[1];
      out[ti * 9 + c * 3 + 2] = n[2];
    }
  });
  return out;
}

function faceAngleAt(m: EditMesh, f: number, v: number): number {
  const loop = m.faces[f];
  const i = loop.indexOf(v);
  const p = m.co[loop[(i + loop.length - 1) % loop.length]];
  const c = m.co[v];
  const n = m.co[loop[(i + 1) % loop.length]];
  const a = v3.norm(v3.sub(p, c));
  const b = v3.norm(v3.sub(n, c));
  return Math.acos(Math.max(-1, Math.min(1, v3.dot(a, b)))) || 0.01;
}

export function buildGeometry(m: EditMesh): BuiltGeometry {
  const tris: number[][] = [];
  const triFace: number[] = [];
  for (let fi = 0; fi < m.faces.length; fi++) {
    const loop = m.faces[fi];
    if (loop.some((v) => m.hidden.has(v))) continue;
    for (const t of triangulateLoop(m.co, loop)) {
      tris.push(t);
      triFace.push(fi);
    }
  }
  const pos = new Float32Array(tris.length * 9);
  const uv = new Float32Array(tris.length * 6);
  const nor = m.smooth ? smoothNormals(m, tris, triFace) : new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => {
    const fn = newellNormal(m.co, m.faces[triFace[ti]]);
    for (let c = 0; c < 3; c++) {
      const p = m.co[t[c]];
      pos[ti * 9 + c * 3] = p[0];
      pos[ti * 9 + c * 3 + 1] = p[1];
      pos[ti * 9 + c * 3 + 2] = p[2];
      if (!m.smooth) {
        nor[ti * 9 + c * 3] = fn[0];
        nor[ti * 9 + c * 3 + 1] = fn[1];
        nor[ti * 9 + c * 3 + 2] = fn[2];
      }
      const [u, vv] = boxUV(p, fn);
      uv[ti * 6 + c * 2] = u;
      uv[ti * 6 + c * 2 + 1] = vv;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  if (tris.length > 0 && tris.length < 250000) {
    // Accelerated ray picking / occlusion tests.
    (geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(geometry);
  }
  return { geometry, triToFace: Int32Array.from(triFace) };
}

/** Make a THREE.Mesh use the BVH-accelerated raycast when it has a boundsTree. */
export function enableAcceleratedRaycast(mesh: THREE.Mesh): void {
  mesh.raycast = acceleratedRaycast;
}

export function disposeGeometry(g: THREE.BufferGeometry | null | undefined): void {
  if (!g) return;
  const t = (g as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree;
  if (t) delete (g as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree;
  g.dispose();
}
