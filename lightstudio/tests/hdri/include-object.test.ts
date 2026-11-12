// Objects switched to "Include in HDRI": they must paint only where they really are, never wipe the map.
// Run: npm run test:hdri
import * as THREE from 'three';
import { generateAnalyticalHDRI, type EnvLayer } from '../../src/three/HDRIExporter';
import { useObjectHdriStore, defaultObjectHdri } from '../../src/store/objectHdriStore';
import { objectKey } from '../../src/three/objectBinding';

let failed = 0;
function check(ok: boolean, msg: string): void {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + msg);
  if (!ok) failed++;
}

const W = 128, H = 64;

/** A recognisable sky: left half red, right half blue, top brighter than bottom. */
function sky(): EnvLayer {
  const w = 64, h = 32;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const top = 1 - y / h;
    data[i] = x < w / 2 ? 2 * (0.5 + top) : 0;
    data[i + 1] = 0.2;
    data[i + 2] = x < w / 2 ? 0 : 2 * (0.5 + top);
    data[i + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return { texture: tex, intensity: 1, rotation: 0 };
}

function plane(w: number, h: number, pos: [number, number, number], rotX: number, color = 0x808080): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color }));
  m.position.set(...pos);
  m.rotation.x = rotX;
  m.name = 'TestPlane';
  m.updateMatrixWorld(true);
  return m;
}

async function bake(scene: THREE.Scene): Promise<Float32Array> {
  return generateAnalyticalHDRI(scene, W, H, new THREE.Vector3(0, 0, 0), [sky()]);
}

function include(obj: THREE.Object3D, patch: Partial<ReturnType<typeof defaultObjectHdri>> = {}): void {
  useObjectHdriStore.getState().set(objectKey(obj), { ...defaultObjectHdri(), include: true, ...patch });
}

/** Share of pixels that differ from the plain sky bake. */
function changedShare(a: Float32Array, b: Float32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 1e-3) n++;
  }
  return n / (a.length / 4);
}

async function main(): Promise<void> {
  const reference = await bake(new THREE.Scene());

  // 1. A plane that passes through the capture point (the default for a new plane at the origin): the viewer
  //    stands on it, so it is the ground below the horizon and must never turn the whole map grey.
  {
    useObjectHdriStore.getState().clear();
    const scene = new THREE.Scene();
    const p = plane(6, 6, [0, 0, 0], -Math.PI / 2);
    scene.add(p);
    include(p);
    const out = await bake(scene);
    let upper = 0, lower = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(out[i] - reference[i]) + Math.abs(out[i + 1] - reference[i + 1]) + Math.abs(out[i + 2] - reference[i + 2]);
      if (d > 1e-3) { if (y < H / 2) upper++; else lower++; }
    }
    check(upper === 0, `a plane at the capture point leaves the sky above the horizon intact (${upper} px changed)`);
    check(lower > (W * H) / 4, `...and paints the ground side below it (${lower} px)`);
  }

  // 2. A horizontal plane below the capture point covers only the ground side of the map.
  {
    useObjectHdriStore.getState().clear();
    const scene = new THREE.Scene();
    const p = plane(8, 8, [0, -1, 0], -Math.PI / 2);
    scene.add(p);
    include(p);
    const out = await bake(scene);
    let upperChanged = 0, lowerChanged = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(out[i] - reference[i]) + Math.abs(out[i + 1] - reference[i + 1]) + Math.abs(out[i + 2] - reference[i + 2]);
      if (d > 1e-3) { if (y < H / 2) upperChanged++; else lowerChanged++; }
    }
    check(upperChanged === 0, `a floor plane leaves the sky above the horizon untouched (${upperChanged} px changed)`);
    check(lowerChanged > 200 && lowerChanged < (W * H) / 2, `a floor plane paints part of the ground side (${lowerChanged} px)`);
  }

  // 3. A vertical card beside the capture point paints only a patch, the rest of the sky is kept.
  {
    useObjectHdriStore.getState().clear();
    const scene = new THREE.Scene();
    const p = plane(2, 2, [0, 0.5, -4], 0);              // faces the capture point, 4 m away
    scene.add(p);
    include(p);
    const out = await bake(scene);
    const share = changedShare(reference, out);
    check(share > 0.005 && share < 0.25, `a card paints just a patch of the map (${(share * 100).toFixed(1)}% of pixels)`);
  }

  // 4. Not included = never in the map.
  {
    useObjectHdriStore.getState().clear();
    const scene = new THREE.Scene();
    const p = plane(2, 2, [0, 0.5, -4], 0);
    scene.add(p);
    const out = await bake(scene);
    check(changedShare(reference, out) === 0, 'an object that is not included never appears in the map');
  }

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
