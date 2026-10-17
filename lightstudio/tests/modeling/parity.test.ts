import { EditMesh, Selection, meshCounts, flushSelection, ek, selectAll } from '../../src/modeling/EditMesh';
import { makePrimitive } from '../../src/modeling/primitives';
import * as core from '../../src/modeling/opsCore';
import * as shape from '../../src/modeling/opsShape';
import * as loop from '../../src/modeling/opsLoop';
import * as sel from '../../src/modeling/opsSelect';

let pass = 0;
let fail = 0;
function check(name: string, got: number[], want: number[]) {
  const ok = got.length === want.length && got.every((x, i) => x === want[i]);
  if (ok) pass++;
  else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(34) + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
const top = (m: EditMesh) => {
  let b = 0;
  let by = -1e9;
  m.faces.forEach((_, i) => {
    const y = m.faceCenter(i)[1];
    if (y > by) {
      by = y;
      b = i;
    }
  });
  return b;
};
function selFaces(m: EditMesh, fs: number[]): Selection {
  const s = new Selection();
  fs.forEach((f) => s.f.add(f));
  flushSelection(m, s, 'face');
  return s;
}
function selVerts(m: EditMesh, vs: number[]): Selection {
  const s = new Selection();
  vs.forEach((v) => s.v.add(v));
  flushSelection(m, s, 'vert');
  return s;
}
function selEdges(m: EditMesh, ks: number[]): Selection {
  const s = new Selection();
  ks.forEach((k) => s.e.add(k));
  flushSelection(m, s, 'edge');
  return s;
}
const cube = () => makePrimitive('cube');
const cnt = (m: EditMesh) => meshCounts(m) as number[];

// Primitives
check('cube', cnt(makePrimitive('cube')), [8, 12, 6]);
check('plane', cnt(makePrimitive('plane')), [4, 4, 1]);
check('grid 10x10', cnt(makePrimitive('grid')), [121, 220, 100]);
check('circle32 ngon', cnt(makePrimitive('circle')), [32, 32, 1]);
check('uvsphere', cnt(makePrimitive('uvsphere')), [482, 992, 512]);
check('icosphere2', cnt(makePrimitive('icosphere')), [42, 120, 80]);
check('cylinder', cnt(makePrimitive('cylinder')), [64, 96, 34]);
check('cone', cnt(makePrimitive('cone')), [33, 64, 33]);
check('torus', cnt(makePrimitive('torus')), [576, 1152, 576]);

// Delete
{ const m = cube(); const s = selFaces(m, [top(m)]); core.deleteSelection(m, s, 'faces'); check('delete face cube', cnt(m), [8, 12, 5]); }
{ const m = cube(); const s = selVerts(m, [0]); core.deleteSelection(m, s, 'verts'); check('delete vert cube', cnt(m), [7, 9, 3]); }
{ const m = cube(); const k = Array.from(m.edgeMap().keys())[0]; const s = selEdges(m, [k]); core.deleteSelection(m, s, 'edges'); check('delete edge cube', cnt(m), [8, 11, 4]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const s = selFaces(m, [0]); core.deleteSelection(m, s, 'faces'); check('delete corner face grid3', cnt(m), [15, 22, 8]); }
{ const m = makePrimitive('plane'); const s = selFaces(m, [0]); core.deleteSelection(m, s, 'faces'); check('delete plane face', cnt(m), [0, 0, 0]); }
{ const m = makePrimitive('plane'); const s = selFaces(m, [0]); core.deleteSelection(m, s, 'onlyFaces'); check('delete only faces plane', cnt(m), [4, 4, 0]); }
{ const m = makePrimitive('plane'); const s = selFaces(m, [0]); core.deleteSelection(m, s, 'onlyEdgesFaces'); check('delete edges+faces plane', cnt(m), [4, 0, 0]); }

// Dissolve
{ const m = cube(); const k = Array.from(m.edgeMap().keys())[0]; const s = selEdges(m, [k]); core.dissolveEdges(m, s, true); check('dissolve edge cube', cnt(m), [6, 9, 5]); }
{ const m = cube(); const s = selVerts(m, [0]); core.dissolveVerts(m, s, 'vert'); check('dissolve vert cube', cnt(m), [7, 9, 4]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const s = selFaces(m, [0, 1]); core.dissolveFaces(m, s, false); check('dissolve 2 faces grid3', cnt(m), [16, 23, 8]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const center = m.co.findIndex((p) => Math.abs(p[0] + 1 / 3) < 1e-6 && Math.abs(p[2] + 1 / 3) < 1e-6); const s = selVerts(m, [center]); core.dissolveVerts(m, s, 'vert'); check('dissolve center vert grid3', cnt(m), [15, 20, 6]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const s = selFaces(m, m.faces.map((_, i) => i)); core.limitedDissolve(m, s, 0.1); check('limited dissolve grid3', cnt(m), [4, 4, 1]); }

// Merge
{ const m = cube(); const t = top(m); const s = selVerts(m, m.faces[t]); core.mergeVerts(m, s, 'center'); check('merge center top4', cnt(m), [5, 8, 5]); }
{ const m = cube(); const t = top(m); const f = m.faces[t]; const s = selEdges(m, f.map((v, i) => ek(v, f[(i + 1) % 4]))); core.mergeVerts(m, s, 'collapse'); check('collapse top edges', cnt(m), [5, 8, 5]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); core.mergeByDistance(m, null, 0.001); check('merge by distance grid', cnt(m), [16, 24, 9]); }
{ const m = cube(); const cp = m.clone(); cp.co.forEach((p) => m.addVert(p)); check('merge dist dups removed', [core.mergeByDistance(m, null, 0.001)], [8]); }

// Fill
{ const m = makePrimitive('circle', { segments: 8 }); core.deleteSelection(m, selFaces(m, [0]), 'onlyFaces'); const s = new Selection(); m.edgeMap().forEach((_, k) => s.e.add(k)); for (let i = 0; i < 8; i++) s.v.add(i); core.makeEdgeFace(m, s); check('fill ngon 8', cnt(m), [8, 8, 1]); }
{ const m = makePrimitive('circle', { segments: 8 }); core.deleteSelection(m, selFaces(m, [0]), 'onlyFaces'); const s = new Selection(); m.edgeMap().forEach((_, k) => s.e.add(k)); core.fillHoles(m, s); check('fill triangles 8', cnt(m), [8, 13, 6]); }
{ const m = makePrimitive('circle', { segments: 8 }); core.deleteSelection(m, selFaces(m, [0]), 'onlyFaces'); const s = new Selection(); m.edgeMap().forEach((_, k) => s.e.add(k)); core.gridFill(m, s); check('grid fill 8', cnt(m), [9, 12, 4]); }

// Subdivide
{ const m = cube(); const s = new Selection(); selectAll(m, s); core.subdivide(m, s, 'edge', 1); check('subdivide cube 1', cnt(m), [26, 48, 24]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); core.subdivide(m, s, 'edge', 2); check('subdivide cube 2', cnt(m), [56, 108, 54]); }
{ const m = cube(); const k = Array.from(m.edgeMap().keys())[0]; core.subdivide(m, selEdges(m, [k]), 'edge', 1); check('subdivide one edge', cnt(m), [9, 13, 6]); }

// Poke / triangulate / quads / duplicate / separate / solidify / split
{ const m = cube(); const s = new Selection(); selectAll(m, s); core.pokeFaces(m, s); check('poke cube', cnt(m), [14, 36, 24]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); core.triangulateFaces(m, s); check('triangulate cube', cnt(m), [8, 18, 12]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); core.triangulateFaces(m, s); const s2 = new Selection(); selectAll(m, s2); core.trisToQuads(m, s2); check('tris to quads', cnt(m), [8, 12, 6]); }
{ const m = cube(); const s = selFaces(m, [top(m)]); core.duplicateSelection(m, s, 'face'); check('duplicate top face', cnt(m), [12, 16, 7]); }
{ const m = cube(); const s = selFaces(m, [top(m)]); const out = core.separateSelection(m, s); check('separate top: source', cnt(m), [8, 12, 5]); check('separate top: new', out ? cnt(out) : [], [4, 4, 1]); }
{ const m = makePrimitive('plane'); const s = selFaces(m, [0]); core.solidify(m, s, 0.2); check('solidify plane', cnt(m), [8, 12, 6]); }
{ const m = cube(); const s = selFaces(m, [top(m)]); core.splitSelection(m, s, 'face'); check('split top face', cnt(m), [12, 16, 6]); }

// Extrude
{ const m = makePrimitive('plane'); const s = selFaces(m, [0]); shape.extrudeRegion(m, s, 'face'); check('extrude plane face', cnt(m), [8, 12, 6]); }
{ const m = cube(); const s = selFaces(m, [top(m)]); shape.extrudeRegion(m, s, 'face'); check('extrude cube top', cnt(m), [12, 20, 10]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const s = selFaces(m, [4]); shape.extrudeRegion(m, s, 'face'); check('extrude grid3 center', cnt(m), [20, 32, 13]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const s = selFaces(m, [0, 1]); shape.extrudeRegion(m, s, 'face'); check('extrude grid3 2 faces', cnt(m), [22, 36, 15]); }
{ const m = makePrimitive('plane'); const k = Array.from(m.edgeMap().keys())[0]; const s = selEdges(m, [k]); shape.extrudeRegion(m, s, 'edge'); check('extrude plane edge', cnt(m), [6, 7, 2]); }
{ const m = makePrimitive('plane'); const s = selVerts(m, [0]); shape.extrudeRegion(m, s, 'vert'); check('extrude plane vert', cnt(m), [5, 5, 1]); }
{ const m = cube(); const k = Array.from(m.edgeMap().keys())[0]; const s = selEdges(m, [k]); shape.extrudeRegion(m, s, 'edge'); check('extrude cube edge', cnt(m), [10, 15, 7]); }
{ const m = cube(); const s = selVerts(m, [0]); shape.extrudeRegion(m, s, 'vert'); check('extrude cube vert', cnt(m), [9, 13, 6]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.extrudeRegion(m, s, 'face'); check('extrude cube all', cnt(m), [16, 24, 12]); }
{ const m = cube(); const s = selFaces(m, [top(m)]); shape.extrudeIndividualFaces(m, s); check('extrude individual top', cnt(m), [12, 20, 10]); }

// Inset
{ const m = cube(); const s = selFaces(m, [top(m)]); shape.insetFaces(m, s, { thickness: 0.2 }); check('inset cube top', cnt(m), [12, 20, 10]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.insetFaces(m, s, { thickness: 0.2 }); check('inset cube all region', cnt(m), [8, 12, 6]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.insetFaces(m, s, { thickness: 0.2, individual: true }); check('inset cube all indiv', cnt(m), [32, 60, 30]); }
{ const m = makePrimitive('grid', { xSegments: 3, ySegments: 3 }); const s = selFaces(m, [0, 1]); shape.insetFaces(m, s, { thickness: 0.1 }); check('inset grid3 2 faces', cnt(m), [22, 36, 15]); }
{ const m = makePrimitive('plane'); const s = selFaces(m, [0]); shape.insetFaces(m, s, { thickness: 0.1 }); check('inset plane', cnt(m), [8, 12, 5]); }

// Bevel
const topRing = (m: EditMesh) => Array.from(m.edgeMap().values()).filter((e) => m.co[e.a][1] > 0 && m.co[e.b][1] > 0).map((e) => e.key);
for (const seg of [1, 2, 3]) {
  const m = cube();
  const k = Array.from(m.edgeMap().keys())[0];
  const s = selEdges(m, [k]);
  shape.bevelEdges(m, s, { width: 0.2, segments: seg });
  check('bevel cube edge seg' + seg, cnt(m), [[10, 15, 7], [12, 18, 8], [14, 21, 9]][seg - 1]);
}
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.bevelEdges(m, s, { width: 0.2, segments: 1 }); check('bevel cube all seg1', cnt(m), [24, 48, 26]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.bevelEdges(m, s, { width: 0.2, segments: 2 }); check('bevel cube all seg2', cnt(m), [56, 108, 54]); }
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.bevelEdges(m, s, { width: 0.2, segments: 3 }); check('bevel cube all seg3', cnt(m), [96, 192, 98]); }
{ const m = cube(); const s = selEdges(m, topRing(m)); shape.bevelEdges(m, s, { width: 0.2, segments: 1 }); check('bevel top ring seg1', cnt(m), [12, 20, 10]); }
{
  const m = cube();
  const ks = topRing(m);
  const em = m.edgeMap();
  const e0 = em.get(ks[0])!;
  const other = ks.find((k) => { const e = em.get(k)!; return k !== ks[0] && (e.a === e0.a || e.a === e0.b || e.b === e0.a || e.b === e0.b); })!;
  const s = selEdges(m, [ks[0], other]);
  shape.bevelEdges(m, s, { width: 0.2, segments: 1 });
  check('bevel 2 adjacent edges', cnt(m), [11, 17, 8]);
}
{ const m = cube(); const s = new Selection(); selectAll(m, s); shape.bevelVertices(m, s, { width: 0.2, segments: 1 }); check('bevel all verts seg1', cnt(m), [24, 36, 14]); }
{ const m = cube(); const s = selVerts(m, [0]); shape.bevelVertices(m, s, { width: 0.2, segments: 1 }); check('bevel vert0 seg1', cnt(m), [10, 15, 7]); }

// Loop cut / ring / loop / bridge / rip / spin / connect
{
  const m = cube();
  const vert = Array.from(m.edgeMap().values()).find((e) => Math.abs(m.co[e.a][1] - m.co[e.b][1]) > 1)!;
  const ring = loop.edgeRing(m, vert.key)!;
  check('ring length (cube vertical)', [ring.edges.length, ring.closed ? 1 : 0], [4, 1]);
  loop.loopCut(m, ring, 1, 0);
  check('loop cut cube x1', cnt(m), [12, 20, 10]);
}
{
  const m = cube();
  const vert = Array.from(m.edgeMap().values()).find((e) => Math.abs(m.co[e.a][1] - m.co[e.b][1]) > 1)!;
  loop.loopCut(m, loop.edgeRing(m, vert.key)!, 3, 0);
  check('loop cut cube x3', cnt(m), [20, 36, 18]);
  const ys = m.co.map((p) => p[1]).filter((y) => Math.abs(y) < 0.999).sort((a, b) => a - b);
  check('loop cut positions', [Math.round(ys[0] * 100), Math.round(ys[ys.length - 1] * 100)], [-50, 50]);
}
{
  const m = makePrimitive('grid', { xSegments: 4, ySegments: 4 });
  const edge = Array.from(m.edgeMap().values()).find((e) => Math.abs(m.co[e.a][0] - m.co[e.b][0]) < 1e-6 && m.co[e.a][2] < m.co[e.b][2])!;
  const ring = loop.edgeRing(m, edge.key)!;
  check('grid ring open length', [ring.edges.length, ring.closed ? 1 : 0], [5, 0]);
}
{
  const m = cube();
  const e = Array.from(m.edgeMap().values()).find((x) => m.co[x.a][1] > 0 && m.co[x.b][1] > 0)!;
  check('edge loop top ring', [loop.edgeLoop(m, e.key).length], [4]);
}
{
  const m = cube();
  const ft = top(m);
  let fb = 0;
  m.faces.forEach((_, i) => { if (m.faceCenter(i)[1] < m.faceCenter(fb)[1]) fb = i; });
  core.deleteSelection(m, selFaces(m, [ft, fb]), 'onlyFaces');
  const s = new Selection();
  for (const e of m.edgeMap().values()) if (e.faces.length === 1) s.e.add(e.key);
  const r = loop.bridgeEdgeLoops(m, s);
  check('bridge two rings', [r.ok ? 1 : 0, ...cnt(m)], [1, 8, 12, 8]);
}
{
  const m = makePrimitive('grid', { xSegments: 2, ySegments: 2 });
  const center = m.co.findIndex((p) => Math.abs(p[0]) < 1e-6 && Math.abs(p[2]) < 1e-6);
  const s = selVerts(m, [center]);
  loop.ripVertices(m, s, (_v, keys) => keys[0]);
  check('rip center vertex', [m.co.length, m.faces.length], [10, 4]);
}
{
  const m = new EditMesh();
  const a = m.addVert([1, 0, 0]);
  const b = m.addVert([1, 1, 0]);
  m.addLoose(a, b);
  const s = new Selection();
  s.v.add(a); s.v.add(b); s.e.add(ek(a, b));
  core.spinSelection(m, s, [0, 0, 0], [0, 1, 0], Math.PI * 2, 8);
  check('spin edge 360 x8', cnt(m), [16, 24, 8]);
}
{
  const m = makePrimitive('grid', { xSegments: 2, ySegments: 2 });
  const f0 = m.faces[0];
  const s = selVerts(m, [f0[0], f0[2]]);
  core.connectVerts(m, s);
  check('connect vertex pair (grid2)', [m.faces.length], [5]);
}
{
  const m = cube();
  const s = new Selection();
  selectAll(m, s);
  sel.growSelection(m, s, 'vert');
  check('select all + grow = all', [s.v.size], [8]);
  const s2 = selVerts(m, [0]);
  sel.growSelection(m, s2, 'vert');
  check('grow vertex 1 -> 4', [s2.v.size], [4]);
  sel.shrinkSelection(m, s2, 'vert');
  check('shrink back -> 1', [s2.v.size], [1]);
  const s3 = new Selection();
  sel.selectLinked(m, s3, 'vert', [0]);
  check('select linked cube', [s3.v.size], [8]);
  const s4 = selVerts(m, [0, 7]);
  sel.invertSelection(m, s4, 'vert');
  check('invert selection', [s4.v.size], [6]);
  check('shortest path length', [sel.shortestPath(m, 0, 7).length], [4]);
}

// Winding: every face of a beveled cube must point away from the centre.
for (const seg of [1, 2, 3, 4]) {
  const m = cube();
  const s = new Selection();
  selectAll(m, s);
  shape.bevelEdges(m, s, { width: 0.2, segments: seg });
  let bad = 0;
  for (let i = 0; i < m.faces.length; i++) if (v3dot(m.faceNormal(i), m.faceCenter(i)) <= 0) bad++;
  check('bevel winding seg' + seg, [bad], [0]);
}
function v3dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
for (const [name, fn] of [
  ['extrude', () => { const m = cube(); const s = selFaces(m, [top(m)]); shape.extrudeRegion(m, s, 'face'); for (const v of s.v) m.co[v] = [m.co[v][0], m.co[v][1] + 0.5, m.co[v][2]]; return m; }],
  ['inset', () => { const m = cube(); const s = selFaces(m, [top(m)]); shape.insetFaces(m, s, { thickness: 0.3 }); return m; }],
  ['loopcut', () => { const m = cube(); const e = Array.from(m.edgeMap().values()).find((x) => Math.abs(m.co[x.a][1] - m.co[x.b][1]) > 1)!; loop.loopCut(m, loop.edgeRing(m, e.key)!, 2, 0); return m; }],
  ['subdivide', () => { const m = cube(); const s = new Selection(); selectAll(m, s); core.subdivide(m, s, 'edge', 1); return m; }],
  ['poke', () => { const m = cube(); const s = new Selection(); selectAll(m, s); core.pokeFaces(m, s, 0.2); return m; }],
] as [string, () => EditMesh][]) {
  const m = fn();
  let bad = 0;
  for (let i = 0; i < m.faces.length; i++) if (v3dot(m.faceNormal(i), m.faceCenter(i)) <= 0) bad++;
  check(name + ' winding', [bad], [0]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
