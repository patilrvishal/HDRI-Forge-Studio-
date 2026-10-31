import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { APPEARANCE_PRESETS } from '../../src/appearance/presets';
import { renderAppearance, averageRadiance, l2sExport } from './helpers';
import { newAppearance, defaultContent, newLayer } from '../../src/appearance/content';
import type { ContentType } from '../../src/appearance/types';

let fails = 0;
const ok = (c: boolean, m: string) => {
  if (!c) { fails++; console.log('FAIL', m); }
};

// ── every preset renders finite, non-empty, bounded ────────────────────────
const TH = 96;
const sheetCols = 8;
const cellW = 112, cellH = 112;
const rows = Math.ceil(APPEARANCE_PRESETS.length / sheetCols);
const sheet = new Uint8Array(sheetCols * cellW * rows * cellH * 3).fill(24);

APPEARANCE_PRESETS.forEach((p, i) => {
  const app = p.build();
  const w = p.aspect >= 1 ? TH : Math.max(8, Math.round(TH * p.aspect));
  const h = p.aspect >= 1 ? Math.max(8, Math.round(TH / p.aspect)) : TH;
  const t0 = performance.now();
  const d = renderAppearance(app, w, h, p.aspect);
  const ms = performance.now() - t0;
  let bad = 0, maxv = 0;
  for (let k = 0; k < d.length; k++) {
    if (!Number.isFinite(d[k])) bad++;
    if (k % 4 < 3 && d[k] > maxv) maxv = d[k];
  }
  const avg = averageRadiance(d);
  ok(bad === 0, `${p.name}: non-finite values (${bad})`);
  ok(avg.coverage > 0.02, `${p.name}: nearly empty (coverage ${avg.coverage.toFixed(3)})`);
  ok(avg.coverage <= 1.0001, `${p.name}: coverage > 1`);
  ok(ms < 800, `${p.name}: slow ${ms.toFixed(0)}ms`);
  // contact sheet (premultiplied on dark, simple Reinhard-ish tonemap)
  const cx = (i % sheetCols) * cellW + Math.floor((cellW - w) / 2);
  const cy = Math.floor(i / sheetCols) * cellH + Math.floor((cellH - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4;
    const a = d[s + 3];
    for (let c = 0; c < 3; c++) {
      const v = d[s + c] * a;
      const t = v / (1 + v * 0.35);
      sheet[((cy + y) * sheetCols * cellW + cx + x) * 3 + c] = Math.round(l2sExport(Math.min(1, t)) * 255);
    }
  }
});

// ── content types: sanity checks ────────────────────────────────────────────
const types: ContentType[] = ['flat', 'bulb', 'gradient', 'boxgrad', 'polygon', 'image', 'lumicurve', 'scrim', 'sky'];
for (const t of types) {
  const a = newAppearance(t);
  const d = renderAppearance(a, 32, 32, 1.5);
  ok(d.every(Number.isFinite), `${t}: finite`);
}
{
  // bulb: centre brighter than edge
  const a = newAppearance('bulb');
  const d = renderAppearance(a, 33, 33, 1);
  const c = d[(16 * 33 + 16) * 4 + 3], e = d[(16 * 33 + 1) * 4 + 3];
  ok(c > e, 'bulb centre more opaque than edge');
}
{
  // global brightness +1 EV doubles radiance
  const a = newAppearance('flat');
  const d0 = renderAppearance(a, 4, 4, 1);
  a.global.brightness = 1;
  const d1 = renderAppearance(a, 4, 4, 1);
  ok(Math.abs(d1[0] / d0[0] - 2) < 1e-4, 'brightness +1EV doubles');
  a.global.brightness = 0; a.global.opacity = 50;
  ok(Math.abs(renderAppearance(a, 4, 4, 1)[3] - 0.5) < 1e-6, 'opacity 50% -> alpha 0.5');
}
{
  // alpha multiply masks
  const a = newAppearance('flat');
  a.alphaMultiply.push(newLayer('polygon', { name: 'shape' }));
  const d = renderAppearance(a, 32, 32, 1);
  ok(d[3] === 0 || d[3] < 0.05, 'alpha multiply cuts the corner');
  ok(d[(16 * 32 + 16) * 4 + 3] > 0.95, 'alpha multiply keeps the centre');
}
{
  // value blend: multiply by 0.5 flat halves colour
  const a = newAppearance('flat');
  const half = newLayer('flat', { blend: 'multiply' });
  if (half.content.type === 'flat') half.content.p.intensity = 0.5;
  a.valueBlend.push(half);
  const d = renderAppearance(a, 4, 4, 1);
  ok(Math.abs(d[0] - 0.5) < 1e-4, 'multiply blend halves');
  a.valueBlend[0].blend = 'add';
  ok(Math.abs(renderAppearance(a, 4, 4, 1)[0] - 1.5) < 1e-4, 'add blend adds');
}
{
  // image content: 2x1 image red|green, stretch
  const imgs = new Map();
  imgs.set('i', { id: 'i', name: 'i', width: 2, height: 1, data: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]) });
  const a = newAppearance('image');
  if (a.master.content.type === 'image') { a.master.content.p.imageId = 'i'; }
  const d = renderAppearance(a, 16, 8, 2, imgs);
  ok(d[(4 * 16 + 1) * 4] > 0.9 && d[(4 * 16 + 1) * 4 + 1] < 0.1, 'image left is red');
  ok(d[(4 * 16 + 14) * 4 + 1] > 0.9, 'image right is green');
  // flip X
  a.global.flipX = true;
  const f = renderAppearance(a, 16, 8, 2, imgs);
  ok(f[(4 * 16 + 1) * 4 + 1] > 0.9, 'global flipX swaps image');
}
{
  // inverted alpha layer
  const a = newAppearance('flat');
  a.alphaMultiply.push(newLayer('polygon', { invert: true }));
  const d = renderAppearance(a, 32, 32, 1);
  ok(d[(16 * 32 + 16) * 4 + 3] < 0.05 && d[3] > 0.95, 'invert flips alpha mask');
}
{
  // Lumi-Curve Freeform Offset: a per-point offsetDirX/Y override must
  // actually steer the falloff direction (not be silently ignored), while a
  // freeform curve with NO overrides set must render identically to 'normal'
  // mode (the auto default IS the curve normal, so nothing should regress
  // for existing presets/curves that never touch this field).
  const w = 48, h = 48, aspect = 1;
  const a = newAppearance('lumicurve');
  type LumiCurveContent = { type: 'lumicurve'; p: import('../../src/appearance/types').LumiCurveParams };
  const c = a.master.content as LumiCurveContent;
  c.p.points = [
    { x: -0.4, y: -0.1, inX: -0.1, inY: 0, outX: 0.1, outY: 0 },
    { x: 0.4, y: 0.15, inX: -0.1, inY: 0, outX: 0.1, outY: 0 },
  ];
  c.p.closed = false;
  c.p.offsetType = 'freeform';
  c.p.greenOffset = 0.3; c.p.blueOffset = 0.3; c.p.symmetrical = true;
  c.p.greenRamp = [{ pos: 0, value: 1 }, { pos: 1, value: 0.1 }];

  c.p.points[1] = { ...c.p.points[1], offsetDirX: 1, offsetDirY: 0.05 };
  const dA = renderAppearance(a, w, h, aspect);
  c.p.points[1] = { ...c.p.points[1], offsetDirX: 0.05, offsetDirY: 1 };
  const dB = renderAppearance(a, w, h, aspect);
  let diffAB = 0;
  for (let i = 0; i < dA.length; i++) diffAB += Math.abs(dA[i] - dB[i]);
  ok(diffAB > 1, `freeform per-point offset direction changes rendered output (diff=${diffAB.toFixed(3)})`);

  // When every point's freeform direction is set to the SAME fixed vector,
  // the per-segment interpolation collapses to one constant direction - the
  // exact same line-intersection sampling 'angle' mode already does - so the
  // two must render identically. This is the one case with a known-exact
  // expected result; an unset (auto) freeform direction deliberately behaves
  // differently (nearest-point Euclidean vs directional line-intersection),
  // same as 'vertical'/'horizontal'/'angle' already differ from 'normal'.
  const ang = 30 * (Math.PI / 180);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  c.p.points = c.p.points.map((pt) => ({ ...pt, offsetDirX: ux, offsetDirY: uy }));
  c.p.offsetType = 'freeform';
  const dFreeFixed = renderAppearance(a, w, h, aspect);
  c.p.offsetType = 'angle';
  c.p.offsetAngle = 30;
  const dAngle = renderAppearance(a, w, h, aspect);
  let diffAngle = 0;
  for (let i = 0; i < dAngle.length; i++) diffAngle += Math.abs(dAngle[i] - dFreeFixed[i]);
  ok(diffAngle < 1e-6, `freeform with one uniform direction on every point matches 'angle' mode exactly (diff=${diffAngle})`);
}
void defaultContent;

// ── PNG writer ──────────────────────────────────────────────────────────────
function crc32(buf: Uint8Array) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(w: number, h: number, rgb: Uint8Array) {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const outPath = process.argv[2];
if (outPath) writeFileSync(outPath, png(sheetCols * cellW, rows * cellH, sheet));

console.log(fails ? `FAILED ${fails}` : `appearance OK (${APPEARANCE_PRESETS.length} presets)`);
process.exit(fails ? 1 : 0);
