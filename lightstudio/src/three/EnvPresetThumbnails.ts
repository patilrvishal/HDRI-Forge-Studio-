import * as THREE from 'three';
import type { HDRIPreset } from '../types/Environment';
import { buildPresetEnvScene } from './presetEnvScene';

/**
 * Real renders for the Environment Browser: each preset is drawn from the very same environment scene the viewport uses,
 * with a chrome ball and a grey ball standing in it, so the icon shows the light the preset really gives (softboxes, warm/cool
 * colour, sky, neon, ...) rather than an invented gradient.
 */
const W = 480;
const H = 270;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.6;
  return renderer;
}

/** Synchronous render of one preset to a PNG data URL (cached). */
export function renderPresetThumbnail(preset: HDRIPreset): string | null {
  const hit = cache.get(preset.id);
  if (hit) return hit;
  try {
    const r = getRenderer();
    const { scene } = buildPresetEnvScene(preset);

    // the same bake the viewport does, so the balls reflect / are lit exactly like real objects would be
    const pmrem = new THREE.PMREMGenerator(r);
    const envRT = pmrem.fromScene(buildPresetEnvScene(preset).scene, 0, 0.1, 100);

    const chrome = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, envMap: envRT.texture, envMapIntensity: 1 }),
    );
    chrome.position.set(-1.1, -1.05, 0.8);
    const grey = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0xc4c4c4, metalness: 0, roughness: 0.55, envMap: envRT.texture, envMapIntensity: 1 }),
    );
    grey.position.set(1.1, -1.05, 0.8);
    scene.add(chrome, grey);

    const cam = new THREE.PerspectiveCamera(78, W / H, 0.1, 100);
    cam.position.set(0, 0.1, 4.6);
    cam.lookAt(0, -0.1, 0);

    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/jpeg', 0.88);

    chrome.geometry.dispose(); (chrome.material as THREE.Material).dispose();
    grey.geometry.dispose(); (grey.material as THREE.Material).dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    envRT.dispose();
    pmrem.dispose();
    cache.set(preset.id, url);
    return url;
  } catch {
    return null;
  }
}

/** Render all given presets, one per frame so the dialog opens without a stall. */
export function renderPresetThumbnails(presets: HDRIPreset[], onEach: (id: string, url: string) => void): () => void {
  let cancelled = false;
  let i = 0;
  const step = () => {
    if (cancelled || i >= presets.length) return;
    const p = presets[i++];
    const url = renderPresetThumbnail(p);
    if (url) onEach(p.id, url);
    window.setTimeout(step, 0);
  };
  window.setTimeout(step, 0);
  return () => { cancelled = true; };
}
