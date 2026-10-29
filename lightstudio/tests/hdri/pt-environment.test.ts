// The environment map the path tracer is lit with must carry the HDRI asset's own settings.
// Run: npm run test:hdri
import { encodeHDR } from '../../src/three/HDRIExporter';
import { bakePathTracerEnvironment } from '../../src/three/ptEnvironment';
import { useHDRIAssetStore, type HDRIAsset } from '../../src/store/hdriAssetStore';

// the Radiance loader reports progress with browser events
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class { constructor(public type: string) {} };

let failed = 0;
function check(ok: boolean, msg: string): void {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + msg);
  if (!ok) failed++;
}

const W = 64, H = 32;

/** A map where every pixel is different and recognisable, so orientation mistakes show up. */
function sourceImage(): Float32Array {
  const px = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    px[i] = 0.2 + x / W;          // red grows to the right
    px[i + 1] = 0.2 + y / H;      // green grows downward
    px[i + 2] = 0.3;
    px[i + 3] = 1;
  }
  return px;
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString('base64');
}

function asset(patch: Partial<HDRIAsset> = {}): HDRIAsset {
  return {
    id: 'a1', name: 'test', fileName: 'test.hdr', blobUrl: null,
    dataBase64: toBase64(encodeHDR(sourceImage(), W, H)),
    intensity: 1, rotation: 0, opacity: 100, contrast: 0, gamma: 1, saturation: 0, active: true,
    ...patch,
  } as HDRIAsset;
}

async function bake(patch: Partial<HDRIAsset> = {}): Promise<Float32Array> {
  useHDRIAssetStore.setState({ assets: [asset(patch)] });
  const tex = await bakePathTracerEnvironment(undefined, W);
  if (!tex) throw new Error('no environment baked');
  return tex.image.data as Float32Array;
}

const at = (px: Float32Array, x: number, y: number): [number, number, number] => {
  const i = (y * W + x) * 4;
  return [px[i], px[i + 1], px[i + 2]];
};
const near = (a: number, b: number, tol = 0.03): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

async function main(): Promise<void> {
  // No active asset: nothing to bake (the loaded file is used as is).
  useHDRIAssetStore.setState({ assets: [] });
  check((await bakePathTracerEnvironment(undefined, W)) === null, 'no active HDRI asset: nothing is baked');

  // Default settings reproduce the source map pixel for pixel (same orientation as the viewport's equirect).
  const base = await bake();
  const src = sourceImage();
  let worst = 0;
  for (let y = 4; y < H - 4; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(base[i + c] - src[i + c]));
  }
  check(worst < 0.03, `default settings keep the map exactly as loaded (worst error ${worst.toFixed(4)})`);

  // Exposure scales the map.
  const bright = await bake({ intensity: 3 });
  const a = at(base, 20, 10), b = at(bright, 20, 10);
  check(near(b[0], a[0] * 3) && near(b[1], a[1] * 3), `Exposure 3 triples the radiance (${a[0].toFixed(2)} -> ${b[0].toFixed(2)})`);
  const dark = await bake({ intensity: 0 });
  check(at(dark, 20, 10)[0] === 0, 'Exposure 0 blacks the map out');

  // Yaw rotation turns the map: 90 degrees = a quarter of the width.
  const rot = await bake({ rotation: 90 });
  const moved = [16, -16].some((dx) => near(at(rot, (20 + W + dx) % W, 10)[0], at(base, 20, 10)[0], 0.06));
  check(moved, 'Rotation Y 90 turns the map by a quarter of its width');

  // Flip mirrors it.
  const flip = await bake({ flipX: true });
  check(Math.abs(at(flip, 10, 12)[0] - at(base, 10, 12)[0]) > 0.1, 'Flip horizontal changes the map');

  // Grading reaches the map.
  const sat = await bake({ saturation: -100 });
  const s = at(sat, 50, 10);
  check(Math.abs(s[0] - s[1]) < 0.05 && Math.abs(s[1] - s[2]) < 0.05, `Saturation -100 makes it grey (${s.map((v) => v.toFixed(2)).join(', ')})`);
  const blur = await bake({ blur: 100 });
  check(Math.abs(at(blur, 3, 8)[0] - at(base, 3, 8)[0]) > 0.001, 'Blur softens the map');

  // Opacity < 100 over nothing dims it.
  const half = await bake({ opacity: 50 });
  check(near(at(half, 20, 10)[0], at(base, 20, 10)[0] * 0.5, 0.05), 'Opacity 50 halves a lone layer');

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
