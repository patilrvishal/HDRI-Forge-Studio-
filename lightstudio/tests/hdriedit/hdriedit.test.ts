import { applyEdits, detectSun, regionMask, renderSky, dirTables, uvToDir } from '../../src/hdriedit/apply';
import { newEditLayer, defaultSky, type EditLayer } from '../../src/hdriedit/types';
import { sphericalFlux, defaultDiffusion, type FloatImage } from '../../src/filters/filters';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

const W = 256, H = 128;
function flat(v: number): FloatImage {
  const d = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 1; }
  return { data: d, width: W, height: H };
}
const px = (d: Float32Array, u: number, v: number, c = 0) => d[(Math.floor(v * H) * W + Math.floor(u * W)) * 4 + c];
const layer = (kind: Parameters<typeof newEditLayer>[0], f?: (l: EditLayer) => void, region?: Parameters<typeof newEditLayer>[1]) => { const l = newEditLayer(kind, region); f?.(l); return l; };

// region masks
{
  const m = regionMask({ shape: 'circle', u: 0.5, v: 0.5, size: 20, sizeV: 10, rotation: 0, feather: 0, invert: false }, W, H)!;
  ok(m[Math.floor(0.5 * H) * W + Math.floor(0.5 * W)] === 1, 'circle mask is 1 at its centre');
  ok(m[10 * W + 10] === 0, 'circle mask is 0 far away');
  let covered = 0; const t = dirTables(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x] > 0.5) covered += t.sa[y];
  const expected = 2 * Math.PI * (1 - Math.cos((20 * Math.PI) / 180));
  covered *= 2 * Math.PI;
  ok(Math.abs(covered / expected - 1) < 0.08, `circle mask solid angle matches the cap (${(covered / expected).toFixed(3)})`);
  const inv = regionMask({ shape: 'circle', u: 0.5, v: 0.5, size: 20, sizeV: 10, rotation: 0, feather: 0, invert: true }, W, H)!;
  ok(inv[Math.floor(0.5 * H) * W + Math.floor(0.5 * W)] === 0 && inv[10 * W + 10] === 1, 'invert flips the mask');
  const r = regionMask({ shape: 'rect', u: 0.5, v: 0.5, size: 30, sizeV: 10, rotation: 0, feather: 0, invert: false }, W, H)!;
  ok(r[64 * W + 128 + 20] === 1 && r[(64 - 20) * W + 128] === 0, 'rect mask is wider than tall');
  ok(regionMask({ shape: 'global', u: 0, v: 0, size: 0, sizeV: 0, rotation: 0, feather: 0, invert: false }, W, H) === null, 'global = no mask');
}

// adjust
{
  const out = applyEdits(flat(1), [layer('adjust', (l) => { if (l.edit.kind === 'adjust') l.edit.p.exposure = 1; })]);
  ok(Math.abs(out[0] - 2) < 1e-4, 'exposure +1 EV doubles');
  const loc = applyEdits(flat(1), [layer('adjust', (l) => { if (l.edit.kind === 'adjust') l.edit.p.exposure = 2; l.region = { ...l.region, shape: 'circle', u: 0.5, v: 0.5, size: 15, feather: 0 }; })]);
  ok(Math.abs(px(loc, 0.5, 0.5) - 4) < 1e-3 && Math.abs(px(loc, 0.1, 0.1) - 1) < 1e-6, 'local exposure only changes the region');
  const col = flat(0.3); for (let i = 0; i < W * H; i++) col.data[i * 4] = 0.8;
  const sat = applyEdits(col, [layer('adjust', (l) => { if (l.edit.kind === 'adjust') l.edit.p.saturation = -100; })]);
  ok(Math.abs(sat[0] - sat[1]) < 0.02, 'saturation -100 desaturates');
}

// blocker
{
  const out = applyEdits(flat(5), [layer('blocker', undefined, { u: 0.5, v: 0.5, size: 20, feather: 0 })]);
  ok(px(out, 0.5, 0.5) === 0 && px(out, 0.1, 0.9) === 5, 'blocker blacks out only its region');
  const half = applyEdits(flat(5), [layer('blocker', (l) => { l.opacity = 50; }, { u: 0.5, v: 0.5, size: 20, feather: 0 })]);
  ok(Math.abs(px(half, 0.5, 0.5) - 2.5) < 1e-3, 'layer opacity 50% halves the blocker');
}

// fill / remove
{
  const img = flat(1);
  for (let y = 58; y < 70; y++) for (let x = 118; x < 138; x++) { const i = (y * W + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 500; }
  const out = applyEdits(img, [layer('fill', undefined, { u: 0.5, v: 0.5, size: 22, feather: 20 })]);
  ok(px(out, 0.5, 0.5) < 5, `remove fills the bright patch from its surroundings (${px(out, 0.5, 0.5).toFixed(2)})`);
  ok(Math.abs(px(out, 0.1, 0.1) - 1) < 1e-6, 'remove leaves the rest untouched');
  const cl = flat(1); for (let y = 0; y < H; y++) for (let x = 0; x < 64; x++) { const i = (y * W + x) * 4; cl.data[i] = 9; }
  const c = applyEdits(cl, [layer('fill', (l) => { if (l.edit.kind === 'fill') { l.edit.p.mode = 'clone'; l.edit.p.sourceU = 0.125; l.edit.p.sourceV = 0.5; } }, { u: 0.6, v: 0.5, size: 10, feather: 0 })]);
  ok(Math.abs(px(c, 0.6, 0.5) - 9) < 0.5, 'clone copies the source area');
}

// sun
{
  const img = flat(0.5);
  const cx = 100, cy = 40, r = 3;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { const i = (y * W + x) * 4; img.data[i] = 8000; img.data[i + 1] = 7000; img.data[i + 2] = 5000; }
  const region = { u: cx / W, v: cy / H, size: 20, feather: 0 };
  const det = detectSun(img, { ...newEditLayer('sun', region).region }, 25);
  ok(!!det && Math.abs(det!.info.u - cx / W) < 0.01, 'sun detected at the right place');
  const before = sphericalFlux(img);
  const big = applyEdits(img, [layer('sun', (l) => { if (l.edit.kind === 'sun') { l.edit.p.action = 'resize'; l.edit.p.scale = 2; } }, region)]);
  const small = applyEdits(img, [layer('sun', (l) => { if (l.edit.kind === 'sun') { l.edit.p.action = 'resize'; l.edit.p.scale = 0.6; } }, region)]);
  const fb = sphericalFlux({ data: big, width: W, height: H }), fs = sphericalFlux({ data: small, width: W, height: H });
  ok(Math.abs(fb / before - 1) < 0.08, `sun resize x2 preserves energy (${(fb / before).toFixed(3)})`);
  ok(Math.abs(fs / before - 1) < 0.08, `sun resize x0.6 preserves energy (${(fs / before).toFixed(3)})`);
  console.log('   peaks', px(img.data, cx / W, cy / H), px(big, cx / W, cy / H), px(small, cx / W, cy / H));
  ok(px(big, cx / W, cy / H) < px(img.data, cx / W, cy / H) && px(small, cx / W, cy / H) > 0, 'bigger sun is dimmer per pixel');
  let count = (d: Float32Array) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 500) n++; return n; };
  ok(count(big) > count(img.data) && count(small) < count(img.data) + 1, 'sun disc grows / shrinks');
  const gone = applyEdits(img, [layer('sun', (l) => { if (l.edit.kind === 'sun') l.edit.p.action = 'remove'; }, region)]);
  ok(px(gone, cx / W, cy / H) < 5, `sun remove leaves ordinary sky (${px(gone, cx / W, cy / H).toFixed(2)})`);
  const moved = applyEdits(img, [layer('sun', (l) => { if (l.edit.kind === 'sun') { l.edit.p.action = 'move'; l.edit.p.scale = 1; l.edit.p.targetU = 0.8; l.edit.p.targetV = 0.3; } }, region)]);
  ok(px(moved, 0.8, 0.3) > 100 && px(moved, cx / W, cy / H) < 50, 'sun move relocates it');
  const fm = sphericalFlux({ data: moved, width: W, height: H });
  ok(Math.abs(fm / before - 1) < 0.1, `sun move preserves energy (${(fm / before).toFixed(3)})`);
}

// mix
{
  const other = flat(3); const base = flat(1);
  const out = applyEdits(base, [layer('mix', (l) => { if (l.edit.kind === 'mix') l.edit.p.assetId = 'x'; }, { shape: 'circle', u: 0.5, v: 0.5, size: 20, feather: 0 })], { resolveAsset: (id) => (id === 'x' ? other : undefined) });
  ok(Math.abs(px(out, 0.5, 0.5) - 3) < 1e-3 && Math.abs(px(out, 0.1, 0.1) - 1) < 1e-6, 'mix brings in the other HDRI only inside the region');
  const add = applyEdits(base, [layer('mix', (l) => { if (l.edit.kind === 'mix') { l.edit.p.assetId = 'x'; l.edit.p.blend = 'add'; } })], { resolveAsset: () => other });
  ok(Math.abs(add[0] - 4) < 1e-3, 'mix add blend adds');
}

// blur layer
{
  const img = flat(0.1); const i = (64 * W + 128) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 2000;
  const out = applyEdits(img, [layer('blur', (l) => { if (l.edit.kind === 'blur') l.edit.p.filters = [{ id: 'a', enabled: true, params: { ...defaultDiffusion(), amount: 25 } }]; })]);
  ok(out[i] < 1000 && Math.abs(sphericalFlux({ data: out, width: W, height: H }) / sphericalFlux(img) - 1) < 0.03, 'blur layer softens and keeps energy');
}

// sky
{
  const sky = renderSky(defaultSky(), W, H);
  ok(sky.every(Number.isFinite), 'sky finite');
  const sun = defaultSky(); const [su, sv] = (() => { const el = sun.sunElevation * Math.PI / 180, az = sun.sunAzimuth * Math.PI / 180; const th = az; const ph = Math.PI / 2 - el; return [th / (2 * Math.PI) + 0.5, ph / Math.PI]; })();
  ok(px(sky, ((su % 1) + 1) % 1, sv) > 100, `sun is where azimuth/elevation say (${px(sky, ((su % 1) + 1) % 1, sv).toFixed(0)})`);
  ok(px(sky, 0.5, 0.05, 2) > px(sky, 0.5, 0.05, 0) * 0.8, 'sky is bluish overhead');
  ok(px(sky, 0.3, 0.95) < px(sky, 0.3, 0.2), 'ground is darker than sky');
  const big = renderSky({ ...defaultSky(), sunSize: 3 }, W, H), std = renderSky(defaultSky(), W, H);
  ok(Math.abs(sphericalFlux({ data: big, width: W, height: H }) / sphericalFlux({ data: std, width: W, height: H }) - 1) < 0.15, 'a bigger sun keeps the sky energy');
  void uvToDir;
}

console.log(fails ? `FAILED ${fails}` : 'hdriedit OK');
process.exit(fails ? 1 : 0);
