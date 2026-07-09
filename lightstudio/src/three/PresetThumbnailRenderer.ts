/**
 * PresetThumbnailRenderer — renders a chrome sphere lit by preset lights
 * into an offscreen canvas and returns a base64 PNG data URL.
 *
 * Uses a shared renderer instance that is lazily created and reused.
 * Thumbnails are cached in a Map for the session.
 */

import * as THREE from 'three';
import type { PresetLight } from '../types/Preset';

const CACHE = new Map<string, string>();
const THUMB_SIZE = 256;

let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedScene: THREE.Scene | null = null;
let sharedCamera: THREE.PerspectiveCamera | null = null;
let sphereMesh: THREE.Mesh | null = null;

function ensureShared(): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sphere: THREE.Mesh;
} {
  if (sharedRenderer && sharedScene && sharedCamera && sphereMesh) {
    return { renderer: sharedRenderer, scene: sharedScene, camera: sharedCamera, sphere: sphereMesh };
  }

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111118);

  // Subtle ground plane for reflections
  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a12,
    roughness: 0.8,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.1;
  ground.receiveShadow = true;
  scene.add(ground);

  // Chrome preview sphere
  const geo = new THREE.SphereGeometry(1, 64, 64);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    metalness: 1.0,
    roughness: 0.05,
    envMapIntensity: 1.0,
  });
  const sphere = new THREE.Mesh(geo, mat);
  sphere.castShadow = true;
  sphere.position.y = 0;
  scene.add(sphere);

  // Ambient fill so scene is never fully black
  const ambient = new THREE.AmbientLight(0x1a1a2e, 0.3);
  scene.add(ambient);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0.3, 3.2);
  camera.lookAt(0, 0, 0);

  sharedRenderer = renderer;
  sharedScene = scene;
  sharedCamera = camera;
  sphereMesh = sphere;

  return { renderer, scene, camera, sphere };
}

/**
 * Convert a PresetLight's spherical coords into a THREE.js light object
 * and add it to the scene. Returns the light for later removal.
 */
function addLightToScene(scene: THREE.Scene, pl: PresetLight): THREE.Light {
  const color = new THREE.Color(pl.color);
  const intensity = pl.brightness * 0.15; // scale down from UI range to Three.js range
  const pos = pl.transform.position;

  let light: THREE.Light;

  switch (pl.type) {
    case 'spot': {
      const s = new THREE.SpotLight(color, intensity, 20, (pl.transform.rotation?.x ?? 45) * (Math.PI / 180), 0.5, 2);
      s.position.set(pos.x, pos.y, pos.z);
      s.target.position.set(0, 0, 0);
      scene.add(s.target);
      light = s;
      break;
    }
    case 'directional': {
      const d = new THREE.DirectionalLight(color, intensity * 0.5);
      d.position.set(pos.x, pos.y, pos.z);
      light = d;
      break;
    }
    case 'area': {
      const w = 2;
      const h = 2;
      const a = new THREE.RectAreaLight(color, intensity * 0.6, w, h);
      a.position.set(pos.x, pos.y, pos.z);
      a.lookAt(0, 0, 0);
      light = a;
      break;
    }
    case 'rim': {
      const r = new THREE.SpotLight(color, intensity, 15, Math.PI / 4, 0.7, 2);
      r.position.set(pos.x, pos.y, pos.z);
      r.target.position.set(0, 0, 0);
      scene.add(r.target);
      light = r;
      break;
    }
    case 'overhead': {
      const o = new THREE.RectAreaLight(color, intensity * 0.5, 4, 4);
      o.position.set(pos.x, pos.y, pos.z);
      o.lookAt(0, 0, 0);
      light = o;
      break;
    }
    case 'underlight': {
      const u = new THREE.PointLight(color, intensity, 8, 2);
      u.position.set(pos.x, pos.y, pos.z);
      light = u;
      break;
    }
    case 'ies':
    case 'point':
    default: {
      const p = new THREE.PointLight(color, intensity, 12, 2);
      p.position.set(pos.x, pos.y, pos.z);
      light = p;
      break;
    }
  }

  scene.add(light);
  return light;
}

/**
 * Render a thumbnail for a preset.
 * Returns a base64 PNG data URL. Cached by presetId.
 */
export async function renderPresetThumbnail(
  presetId: string,
  lights: PresetLight[],
  size: number = THUMB_SIZE,
): Promise<string> {
  // Check cache
  const cached = CACHE.get(presetId);
  if (cached) return cached;

  return new Promise<string>((resolve) => {
    // Use requestAnimationFrame to avoid blocking the main thread
    requestAnimationFrame(() => {
      const { renderer, scene, camera } = ensureShared();

      // Remove previously added dynamic lights (keep ambient + ground + sphere)
      const toRemove: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (
          (obj instanceof THREE.Light && !(obj instanceof THREE.AmbientLight)) ||
          (obj instanceof THREE.Object3D && obj.type === 'Object3D' && obj !== scene)
        ) {
          // Only remove lights and spot targets we added
          if (obj instanceof THREE.Light) toRemove.push(obj);
          if (obj.type === 'Object3D' && obj.parent === scene) {
            // Check if it's a target (has no geometry)
            const hasGeo = (obj as THREE.Mesh).geometry;
            if (!hasGeo) toRemove.push(obj);
          }
        }
      });
      toRemove.forEach((obj) => {
        scene.remove(obj);
        if (obj instanceof THREE.Light) {
          if ('target' in obj && (obj as THREE.SpotLight).target) {
            scene.remove((obj as THREE.SpotLight).target);
          }
          obj.dispose?.();
        }
      });

      // Add preset lights
      lights.forEach((pl) => addLightToScene(scene, pl));

      // Render
      renderer.render(scene, camera);

      // Extract data URL
      const dataUrl = renderer.domElement.toDataURL('image/png');

      // Cache
      CACHE.set(presetId, dataUrl);

      resolve(dataUrl);
    });
  });
}

/**
 * Batch-render thumbnails for all given presets.
 * Returns a Map<presetId, dataUrl>.
 */
export async function batchRenderThumbnails(
  presets: Array<{ id: string; lights: PresetLight[] }>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  // Process in batches of 2 to avoid blocking
  for (let i = 0; i < presets.length; i += 2) {
    const batch = presets.slice(i, i + 2);
    const rendered = await Promise.all(
      batch.map((p) => renderPresetThumbnail(p.id, p.lights)),
    );
    batch.forEach((p, idx) => {
      results.set(p.id, rendered[idx]);
    });
    // Yield to main thread
    await new Promise((r) => setTimeout(r, 10));
  }
  return results;
}

/**
 * Dispose the shared renderer. Call on app unmount.
 */
export function disposeThumbnailRenderer(): void {
  if (sharedRenderer) {
    sharedRenderer.dispose();
    sharedRenderer = null;
  }
  sharedScene = null;
  sharedCamera = null;
  sphereMesh = null;
  CACHE.clear();
}