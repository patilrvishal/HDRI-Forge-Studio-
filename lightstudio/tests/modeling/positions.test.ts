import { readFileSync } from 'node:fs';
import { EditMesh, Selection, flushSelection, ek, selectAll } from '../../src/modeling/EditMesh';
import { makePrimitive } from '../../src/modeling/primitives';
import * as shape from '../../src/modeling/opsShape';
import * as loop from '../../src/modeling/opsLoop';
import * as core from '../../src/modeling/opsCore';

const ref = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, number[][]>;
let pass = 0;
let fail = 0;

function sortedVerts(m: EditMesh): number[][] {
  return m.co
    .map((p) => [Math.round(p[0] * 1e4) / 1e4 + 0, Math.round(p[1] * 1e4) / 1e4 + 0, Math.round(p[2] * 1e4) / 1e4 + 0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
function compare(name: string, m: EditMesh, want: number[][]) {
  const got = sortedVerts(m);
  const w = want.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  let maxd = 0;
  let ok = got.length === w.length;
  if (ok) {
    for (let i = 0; i < got.length; i++) {
      const d = Math.hypot(got[i][0] - w[i][0], got[i][1] - w[i][1], got[i][2] - w[i][2]);
      maxd = Math.max(maxd, d);
    }
    ok = maxd < 1e-3;
  }
  if (ok) pass++;
  else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(22) + ' verts ' + got.length + '/' + w.length + ' maxDelta ' + maxd.toFixed(4));
  if (!ok && got.length === w.length && process.env.VERBOSE) {
    for (let i = 0; i < got.length; i++) console.log('   ', JSON.stringify(got[i]), JSON.stringify(w[i]));
  }
}
const sel = (m: EditMesh, e: number[] = [], f: number[] = []) => {
  const s = new Selection();
  e.forEach((k) => s.e.add(k));
  f.forEach((k) => s.f.add(k));
  flushSelection(m, s, f.length ? 'face' : 'edge');
  return s;
};
const cube = () => makePrimitive('cube');
const vEdge = (m: EditMesh) => Array.from(m.edgeMap().values()).find((e) => Math.abs(m.co[e.a][0] - 1) < 1e-6 && Math.abs(m.co[e.b][0] - 1) < 1e-6 && Math.abs(m.co[e.a][2] + 1) < 1e-6 && Math.abs(m.co[e.b][2] + 1) < 1e-6)!;
const topFace = (m: EditMesh) => {
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

for (const seg of [1, 2, 3]) {
  const m = cube();
  shape.bevelEdges(m, sel(m, [vEdge(m).key]), { width: 0.2, segments: seg, profile: 0.5 });
  compare('bevel 1 edge seg' + seg, m, ref['bevel1_seg' + seg]);
}
for (const seg of [1, 2, 3]) {
  const m = cube();
  const s = new Selection();
  selectAll(m, s);
  shape.bevelEdges(m, s, { width: 0.2, segments: seg });
  compare('bevel all seg' + seg, m, ref['bevel_all_seg' + seg]);
}
{
  const m = cube();
  shape.insetFaces(m, sel(m, [], [topFace(m)]), { thickness: 0.2 });
  compare('inset top', m, ref['inset_top']);
}
{
  const m = cube();
  shape.insetFaces(m, sel(m, [], [topFace(m)]), { thickness: 0.2, depth: 0.3 });
  compare('inset top depth', m, ref['inset_top_depth']);
}
{
  const m = cube();
  const s = sel(m, [], [topFace(m)]);
  shape.extrudeRegion(m, s, 'face');
  for (const v of s.v) m.co[v] = [m.co[v][0], m.co[v][1] + 0.5, m.co[v][2]];
  compare('extrude top +0.5', m, ref['extrude_top']);
}
{
  const m = cube();
  const e = Array.from(m.edgeMap().values()).find((x) => Math.abs(m.co[x.a][1] - m.co[x.b][1]) > 1)!;
  loop.loopCut(m, loop.edgeRing(m, e.key)!, 1, 0);
  compare('loop cut x1', m, ref['loopcut1']);
}
{
  const m = cube();
  const s = new Selection();
  selectAll(m, s);
  core.pokeFaces(m, s, 0);
  compare('poke', m, ref['poke']);
}
void ek;
console.log('\n' + pass + ' passed, ' + fail + ' failed');
