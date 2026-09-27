import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { encodeEXRRGBA } from '../../src/appearance/exr';
import { encodeEXR } from '../../src/three/HDRIExporter';

const W = 5, H = 3;
const px = new Float32Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  px[i] = x + 1; px[i + 1] = (y + 1) * 10; px[i + 2] = 0.5; px[i + 3] = x / (W - 1);
}
function check(name: string, buf: ArrayBuffer) {
  const l = new EXRLoader(); l.setDataType(THREE.FloatType);
  const r = l.parse(buf) as unknown as { width: number; height: number; data: Float32Array };
  const stride = r.data.length / (W * H);
  let bad = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sy = H - 1 - y; // loader returns bottom-up
    const o = (sy * W + x) * stride; const i = (y * W + x) * 4;
    if (Math.abs(r.data[o] - px[i]) > 1e-5 || Math.abs(r.data[o + 1] - px[i + 1]) > 1e-5 || Math.abs(r.data[o + 2] - px[i + 2]) > 1e-5) bad++;
    if (stride === 4 && name === 'rgba' && Math.abs(r.data[o + 3] - px[i + 3]) > 1e-5) bad++;
  }
  console.log(name, 'stride', stride, bad ? 'MISMATCH ' + bad : 'OK');
  return bad;
}
let fails = 0;
try { fails += check('rgba', encodeEXRRGBA(px, W, H, true)); } catch (e) { console.log('rgba threw', (e as Error).message); fails++; }
try { fails += check('existing encodeEXR', encodeEXR(px, W, H)); } catch (e) { console.log('existing threw', (e as Error).message); fails++; }
process.exit(fails ? 1 : 0);
