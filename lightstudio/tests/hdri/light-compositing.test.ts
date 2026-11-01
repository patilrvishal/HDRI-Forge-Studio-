// Per-light compositing controls in the HDRI bake: Blend channel and Mapping.
// Run: npm run test:hdri
import * as THREE from 'three';
import { generateAnalyticalHDRI } from '../../src/three/HDRIExporter';

let failed = 0;
function check(ok: boolean, msg: string): void {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + msg);
  if (!ok) failed++;
}

const W = 128, H = 64;

/** A white-ish rect light straight ahead (+Z of the capture point at the origin), facing the capture point. */
function sceneWith(opts: { width: number; height: number; color?: number; blendChannel?: string; mapping?: string; blendMode?: string }): THREE.Scene {
  const scene = new THREE.Scene();
  const light = new THREE.RectAreaLight(opts.color ?? 0xffffff, 10, opts.width, opts.height);
  light.position.set(0, 0, 4);
  light.lookAt(0, 0, 0);
  light.updateMatrixWorld(true);
  light.userData.opacity = 1;
  light.userData.edgeSoftness = 0;
  light.userData.blendChannel = opts.blendChannel;
  light.userData.mapping = opts.mapping;
  light.userData.blendMode = opts.blendMode;
  scene.add(light);
  return scene;
}

async function bake(scene: THREE.Scene): Promise<Float32Array> {
  return generateAnalyticalHDRI(scene, W, H, new THREE.Vector3(0, 0, 0), []);
}

function litPixels(px: Float32Array): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 0.01) n++;
  return n;
}
function peak(px: Float32Array): [number, number, number] {
  let best = 0, bi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const m = px[i] + px[i + 1] + px[i + 2];
    if (m > best) { best = m; bi = i; }
  }
  return [px[bi], px[bi + 1], px[bi + 2]];
}

async function main(): Promise<void> {
  // ── Blend channel ──────────────────────────────────────────────
  const all = peak(await bake(sceneWith({ width: 2, height: 2 })));
  check(all[0] > 1 && all[1] > 1 && all[2] > 1, `all channels: the light writes red, green and blue (${all.map((v) => v.toFixed(1)).join(', ')})`);

  const red = peak(await bake(sceneWith({ width: 2, height: 2, blendChannel: 'red' })));
  check(red[0] > 1 && red[1] === 0 && red[2] === 0, `red only: green and blue stay untouched (${red.map((v) => v.toFixed(1)).join(', ')})`);

  const green = peak(await bake(sceneWith({ width: 2, height: 2, blendChannel: 'green' })));
  check(green[1] > 1 && green[0] === 0 && green[2] === 0, `green only: red and blue stay untouched (${green.map((v) => v.toFixed(1)).join(', ')})`);

  const blue = peak(await bake(sceneWith({ width: 2, height: 2, blendChannel: 'blue', blendMode: 'add' })));
  check(blue[2] > 1 && blue[0] === 0 && blue[1] === 0, `blue only with a non-normal blend mode (${blue.map((v) => v.toFixed(1)).join(', ')})`);

  const unset = await bake(sceneWith({ width: 2, height: 2 }));
  const explicitAll = await bake(sceneWith({ width: 2, height: 2, blendChannel: 'all' }));
  check(unset.every((v, i) => v === explicitAll[i]), 'unset blend channel is identical to "all" (existing lights unchanged)');

  // ── Mapping ────────────────────────────────────────────────────
  const small = { width: 0.4, height: 0.4 };
  const perspSmall = litPixels(await bake(sceneWith({ ...small })));
  const planeSmall = litPixels(await bake(sceneWith({ ...small, mapping: 'plane' })));
  check(Math.abs(perspSmall - planeSmall) <= Math.max(3, perspSmall * 0.1),
    `a small light looks the same in both mappings (${perspSmall} vs ${planeSmall} px)`);

  const big = { width: 10, height: 10 };
  const perspBig = litPixels(await bake(sceneWith({ ...big })));
  const planeBig = litPixels(await bake(sceneWith({ ...big, mapping: 'plane' })));
  check(perspBig !== planeBig, `a big light differs between mappings (perspective ${perspBig} px, plane ${planeBig} px)`);
  check(planeBig > 0 && planeBig < W * H, 'the plane-mapped big light is a finite, non-empty patch');

  const unsetMap = await bake(sceneWith({ ...big }));
  const explicitPersp = await bake(sceneWith({ ...big, mapping: 'perspective' }));
  check(unsetMap.every((v, i) => v === explicitPersp[i]), 'unset mapping is identical to "perspective" (existing lights unchanged)');

  // ── Spot / directional aim comes from the light's target ──────
  const peakPos = (px: Float32Array): [number, number] => {
    let best = 0, bx = 0, by = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const m = px[i] + px[i + 1] + px[i + 2];
      if (m > best) { best = m; bx = x; by = y; }
    }
    return [bx, by];
  };
  const aimed = async (make: (p: THREE.Vector3) => THREE.DirectionalLight | THREE.SpotLight, at: [number, number, number]): Promise<Float32Array> => {
    const scene = new THREE.Scene();
    const l = make(new THREE.Vector3(...at));
    l.position.set(...at);
    l.target.position.set(0, 0, 0);
    scene.add(l, l.target);
    scene.updateMatrixWorld(true);
    return bake(scene);
  };
  const sunA = peakPos(await aimed(() => new THREE.DirectionalLight(0xffffff, 5), [5, 2, 0]));
  const sunB = peakPos(await aimed(() => new THREE.DirectionalLight(0xffffff, 5), [-5, 2, 0]));
  check(Math.abs(sunA[0] - sunB[0]) > W / 4, `a directional light lands where it is placed (x ${sunA[0]} vs ${sunB[0]})`);
  const spotPx = await aimed(() => new THREE.SpotLight(0xffffff, 5, 50, Math.PI / 4, 0.5, 2), [5, 2, 0]);
  check(litPixels(spotPx) > 0, 'a spot light aimed at the capture point shows up in the map');

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
