import * as THREE from 'three';
import type { HDRIPreset } from '../types/Environment';
import { buildPresetEnvScene } from './presetEnvScene';

/**
 * Real renders for the Environment Browser: each preset's 360 degree environment (the very same scene the viewport lights with:
 * its softboxes, colours, sky, neon, ...) is captured and wrapped on a 3D globe, so the icon is the HDRI preview of that
 * environment shown as a sphere. A faint latitude/longitude grid and a glossy rim make it read as a globe.
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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.2;
  return renderer;
}

const VERT = /* glsl */ `
varying vec3 vDir;
varying vec3 vN;
varying vec3 vView;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform samplerCube tEnv;
varying vec3 vDir;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 col = textureCube(tEnv, vec3(vDir.x, vDir.y, vDir.z)).rgb;
  // faint latitude / longitude grid so the sphere reads as an HDRI globe
  float lon = atan(vDir.z, vDir.x) / 6.2831853 * 12.0;
  float lat = asin(clamp(vDir.y, -1.0, 1.0)) / 3.1415927 * 6.0;
  float gl = abs(fract(lon + 0.5) - 0.5) / max(fwidth(lon), 1e-4);
  float gt = abs(fract(lat + 0.5) - 0.5) / max(fwidth(lat), 1e-4);
  float grid = 1.0 - min(min(gl, gt), 1.0);
  col = mix(col, vec3(1.0), grid * 0.10);
  // glossy rim + soft top-left highlight
  float fres = pow(1.0 - clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0), 3.0);
  col += vec3(0.55, 0.62, 0.75) * fres * 0.45;
  vec3 L = normalize(vec3(-0.5, 0.7, 0.6));
  float spec = pow(max(dot(reflect(-L, normalize(vN)), normalize(vView)), 0.0), 40.0);
  col += vec3(spec) * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Synchronous render of one preset to a PNG data URL (cached). */
export function renderPresetThumbnail(preset: HDRIPreset): string | null {
  const hit = cache.get(preset.id);
  if (hit) return hit;
  try {
    const r = getRenderer();
    const { scene: envScene } = buildPresetEnvScene(preset);

    // capture the full 360 degrees of the environment
    const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
    cubeCam.update(r, envScene);

    const mat = new THREE.ShaderMaterial({
      uniforms: { tEnv: { value: cubeRT.texture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    mat.extensions = { derivatives: true } as never;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
    globe.rotation.set(0.38, Math.PI * 0.82, 0.05);
    const scene = new THREE.Scene();
    scene.add(globe);

    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
    cam.position.set(0, 0, 4.0);
    cam.lookAt(0, 0, 0);

    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');

    globe.geometry.dispose();
    mat.dispose();
    cubeRT.dispose();
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
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
