import { diffusionSpherical, diffusionPlanar, motionSpherical, motionPlanar, reflectionFilter, sphericalFlux, defaultDiffusion, defaultMotion, defaultMotionAdvanced, defaultReflection, type FloatImage } from '../../src/filters/filters';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

function blank(w: number, h: number, v = 0): FloatImage {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 1; }
  return { data: d, width: w, height: h };
}
const set = (img: FloatImage, x: number, y: number, v: number) => { const i = (y * img.width + x) * 4; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; };
const get = (d: Float32Array, w: number, x: number, y: number) => d[(y * w + x) * 4];

// ── spherical diffusion: energy + spreading ─────────────────────────────────
for (const [name, x, y] of [['equator', 128, 64], ['near pole', 100, 6], ['seam', 0, 64]] as const) {
  const img = blank(256, 128);
  set(img, x, y, 5000);
  const before = sphericalFlux(img);
  const t0 = performance.now();
  const out = diffusionSpherical(img, { ...defaultDiffusion(), amount: 30 });
  const ms = performance.now() - t0;
  const after = sphericalFlux({ data: out, width: 256, height: 128 });
  ok(Math.abs(after / before - 1) < 0.02, `diffusion conserves flux (${name}): ${(after / before).toFixed(4)}`);
  ok(get(out, 256, x, y) < 5000 * 0.2, `diffusion lowers peak (${name})`);
  ok(out.every(Number.isFinite), `diffusion finite (${name})`);
  void ms;
}
{
  // without energy conserving the total may drift, with it not; amount 0 is a no-op
  const img = blank(64, 32, 1);
  const same = diffusionSpherical(img, { ...defaultDiffusion(), amount: 0 });
  ok(same.every((v, i) => v === img.data[i]), 'amount 0 leaves image unchanged');
  const flat = diffusionSpherical(img, { ...defaultDiffusion(), amount: 50 });
  let maxdev = 0; for (let i = 0; i < flat.length; i += 4) maxdev = Math.max(maxdev, Math.abs(flat[i] - 1));
  ok(maxdev < 0.03, `flat image stays flat (dev ${maxdev.toFixed(4)})`);
}
{
  // bigger amount spreads further
  const img = blank(256, 128); set(img, 128, 64, 1000);
  const a = diffusionSpherical(img, { ...defaultDiffusion(), amount: 10 });
  const b = diffusionSpherical(img, { ...defaultDiffusion(), amount: 40 });
  ok(get(b, 256, 128 + 30, 64) > get(a, 256, 128 + 30, 64), 'larger amount spreads light further');
  ok(get(b, 256, 128, 64) < get(a, 256, 128, 64), 'larger amount lowers the peak more');
}
{
  // timing at a realistic preview size
  const img = blank(1024, 512, 0.2); set(img, 500, 200, 20000);
  const t0 = performance.now();
  diffusionSpherical(img, { ...defaultDiffusion(), amount: 50 });
  const ms = performance.now() - t0;
  ok(ms < 4000, `1024x512 diffusion takes ${ms.toFixed(0)}ms`);
}

// ── planar diffusion ────────────────────────────────────────────────────────
{
  const img = blank(64, 64);
  for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) set(img, x, y, 2);
  const out = diffusionPlanar(img, { ...defaultDiffusion(), amount: 25 });
  let before = 0, after = 0;
  for (let i = 0; i < img.data.length; i += 4) { before += img.data[i] * img.data[i + 3]; after += out[i] * out[i + 3]; }
  ok(Math.abs(after / before - 1) < 0.02, `planar diffusion conserves energy (${(after / before).toFixed(3)})`);
  ok(get(out, 64, 20, 32) > 0 || out[(32 * 64 + 20) * 4 + 3] > 0, 'planar diffusion spreads outward');
  ok(out.every(Number.isFinite), 'planar finite');
}

// ── motion blur ─────────────────────────────────────────────────────────────
{
  const img = blank(256, 128); set(img, 128, 64, 1000);
  const before = sphericalFlux(img);
  const h = motionSpherical(img, { ...defaultMotion(), u: 1, v: 0, length: 30 });
  const v = motionSpherical(img, { ...defaultMotion(), u: 0, v: -1, length: 30 });
  ok(get(h, 256, 128 + 8, 64) > 1 && get(h, 256, 128, 64 + 8) < 1e-3, 'angle 0 streaks horizontally');
  ok(get(v, 256, 128, 64 - 6) > 1 && get(v, 256, 128 + 8, 64) < 1e-3, 'angle 90 streaks vertically');
  const after = sphericalFlux({ data: h, width: 256, height: 128 });
  ok(Math.abs(after / before - 1) < 0.02, `motion blur conserves flux (${(after / before).toFixed(3)})`);
  const adv = motionSpherical(img, { ...defaultMotionAdvanced(), u: 1, v: 0, length: 40, curvature: 1 });
  let offAxis = 0; for (let y = 70; y < 92; y++) for (let x = 100; x < 156; x++) offAxis += get(adv, 256, x, y);
  ok(offAxis > 0.5, 'advanced curve bends the streak off the straight line');
  const noisy = motionSpherical(img, { ...defaultMotionAdvanced(), length: 40, curvature: 0, noise: { spread: 1, seed: 3, amplitude: 1, groundClamp: false } });
  ok(noisy.every(Number.isFinite), 'noise finite');
  // speed map: black map = no motion
  const stat = blank(256, 128, 0);
  const still = motionSpherical(img, { ...defaultMotionAdvanced(), curvature: 0, length: 40, speedMap: stat });
  ok(Math.abs(get(still, 256, 128, 64) - 1000) < 5, 'black speed map removes the motion');
}
{
  const img = blank(64, 64); for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) set(img, x, y, 3);
  const out = motionPlanar(img, { ...defaultMotion(), angle: 0, length: 30 });
  ok(get(out, 64, 40, 32) > 0.05 && get(out, 64, 32, 44) < 1e-3, 'planar motion streaks horizontally');
}

// accuracy / bias / scale to fit / reflection
{
  const img = blank(256, 128); set(img, 128, 64, 1000);
  const lo = diffusionSpherical(img, { ...defaultDiffusion(), amount: 30, accuracy: 'low' });
  const hi = diffusionSpherical(img, { ...defaultDiffusion(), amount: 30, accuracy: 'high' });
  ok(lo.every(Number.isFinite) && hi.every(Number.isFinite), 'accuracy low/high finite');
  ok(Math.abs(sphericalFlux({ data: hi, width: 256, height: 128 }) / sphericalFlux(img) - 1) < 0.02, 'high accuracy conserves flux');
  const b1 = motionSpherical(img, { ...defaultMotion(), length: 40, bias: 1 });
  const b4 = motionSpherical(img, { ...defaultMotion(), length: 40, bias: 4 });
  ok(get(b4, 256, 128, 64) > get(b1, 256, 128, 64), 'higher bias keeps more of the un-blurred image');
  const fit = blank(64, 64); for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) set(fit, x, y, 2);
  const spill = diffusionPlanar(fit, { ...defaultDiffusion(), amount: 40, scaleToFit: false });
  const kept = diffusionPlanar(fit, { ...defaultDiffusion(), amount: 40, scaleToFit: true });
  const edge = (d: Float32Array) => d[(32 * 64 + 1) * 4 + 3];
  ok(edge(spill) > edge(kept) - 1e-6 && kept.every(Number.isFinite), 'scale to fit keeps the blur inside the image');
  const m = blank(256, 128); set(m, 128 + 30, 64, 100);
  const r = reflectionFilter(m, { ...defaultReflection(), axis: 0, direction: 'backward', blend: 0.05 }, true);
  ok(get(r, 256, 128 - 30, 64) > 10 || get(r, 256, 128 + 30, 64) > 10, 'reflection filter mirrors the light across the axis');
  const rp = blank(64, 64); set(rp, 50, 32, 5);
  const rpo = reflectionFilter(rp, { ...defaultReflection(), axis: 0, direction: 'backward', blend: 0.05 }, false);
  ok(rpo.every(Number.isFinite), 'planar reflection finite');
}

console.log(fails ? `FAILED ${fails}` : 'filters OK');
process.exit(fails ? 1 : 0);
