/**
 * HDRIExporter — Robust HDRI/EXR export for LightForge Studio.
 *
 * Captures the scene's environment map and exports it as a valid
 * Radiance RGBE (.hdr) or OpenEXR (.exr) file.
 *
 * Capture strategy (priority order):
 *   1. WebGL render: If scene.background is a texture (equirectangular HDRI
 *      shown as backplate), render it to a Float32 render target.
 *   2. Raw data fallback: If raw HDRI ArrayBuffer exists in the store,
 *      load via RGBELoader and render to a render target.
 *   3. PMREM capture: If scene.environment exists (built-in presets or
 *      PMREM-processed textures), capture via CubeCamera + equirect shader.
 *   4. Analytical fallback: If no environment exists, compute radiance
 *      analytically from scene lights.
 *
 * All methods produce a Float32Array of RGBA linear values which are then
 * encoded as RGBE (.hdr) or OpenEXR (.exr) and downloaded.
 */

import * as THREE from 'three';
import { getRawHDRIData } from '../store/hdriDataStore';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HDRIExportOptions {
  width: number;
  height: number;
  format: 'hdr' | 'exr';
  filename?: string;
}

// ─── Main Entry Points ───────────────────────────────────────────────────────

/**
 * Export the scene's environment as a Radiance .hdr file.
 */
export async function exportSceneAsHDR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const width = resolution;
  const height = Math.floor(resolution / 2);

  console.log(`[LightForge HDRI] Exporting ${width}x${height} HDR...`);

  try {
    const pixels = await captureEnvironmentHDRI(renderer, scene, width, height);

    // Verify output
    let maxVal = 0;
    let nonZero = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const m = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (m > maxVal) maxVal = m;
      if (m > 0.001) nonZero++;
    }
    const total = width * height;
    console.log(
      `[LightForge HDRI] Max value: ${maxVal.toFixed(4)}, ` +
      `Non-zero: ${nonZero}/${total} (${((nonZero / total) * 100).toFixed(1)}%)`
    );

    if (nonZero === 0) {
      console.warn('[LightForge HDRI] WARNING: Exported HDRI is entirely black.');
    }

    const buffer = encodeHDR(pixels, width, height);
    downloadBuffer(
      buffer,
      `${options?.filename ?? 'lightforge_hdri_' + Date.now()}.hdr`,
      'image/vnd.radiance',
    );
    console.log('[LightForge HDRI] HDR export complete. File size:', buffer.byteLength, 'bytes');
  } catch (err) {
    console.error('[LightForge HDRI] HDR export failed:', err);
    alert('HDRI export failed. Check the console for details.');
  }
}

/**
 * Export the scene's environment as an OpenEXR .exr file.
 */
export async function exportSceneAsEXR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const width = resolution;
  const height = Math.floor(resolution / 2);

  console.log(`[LightForge HDRI] Exporting ${width}x${height} EXR...`);

  try {
    const pixels = await captureEnvironmentHDRI(renderer, scene, width, height);

    const buffer = encodeEXR(pixels, width, height);
    downloadBuffer(
      buffer,
      `${options?.filename ?? 'lightforge_hdri_' + Date.now()}.exr`,
      'image/x-exr',
    );
    console.log('[LightForge HDRI] EXR export complete. File size:', buffer.byteLength, 'bytes');
  } catch (err) {
    console.error('[LightForge HDRI] EXR export failed:', err);
    alert('EXR export failed. Check the console for details.');
  }
}

// ─── Core: Capture Environment ────────────────────────────────────────────────

/**
 * Capture the scene's environment as an equirectangular Float32Array.
 */
async function captureEnvironmentHDRI(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  width: number,
  height: number,
): Promise<Float32Array> {
  // ── Method 1: Render scene.background texture via WebGL ──────────────────
  if (scene.background instanceof THREE.Texture) {
    console.log('[LightForge HDRI] Method 1: WebGL render of scene.background texture');
    try {
      const pixels = renderTextureToEquirect(renderer, scene.background, width, height);
      if (pixels && hasValidData(pixels)) return pixels;
    } catch (err) {
      console.warn('[LightForge HDRI] Method 1 failed:', err);
    }
  }

  // ── Method 2: Raw HDRI data from store ────────────────────────────────────
  const rawBuffer = getRawHDRIData();
  if (rawBuffer) {
    console.log('[LightForge HDRI] Method 2: Loading raw HDRI data from store');
    try {
      const texture = await loadHDRITexture(rawBuffer);
      if (texture) {
        const pixels = renderTextureToEquirect(renderer, texture, width, height);
        texture.dispose();
        if (pixels && hasValidData(pixels)) return pixels;
      }
    } catch (err) {
      console.warn('[LightForge HDRI] Method 2 failed:', err);
    }
  }

  // ── Method 3: WebGL PMREM capture ─────────────────────────────────────────
  if (scene.environment) {
    console.log('[LightForge HDRI] Method 3: WebGL PMREM capture via CubeCamera');
    try {
      const pixels = capturePMREMAsEquirect(renderer, scene.environment, width, height);
      if (pixels && hasValidData(pixels)) return pixels;
    } catch (err) {
      console.warn('[LightForge HDRI] Method 3 failed:', err);
    }
  }

  // ── Method 4: Analytical fallback ─────────────────────────────────────────
  console.log('[LightForge HDRI] Method 4: Analytical light radiance fallback');
  return generateAnalyticalHDRI(
    scene, width, height,
    new THREE.Vector3(0, 0, 0),
  );
}

// ─── Method 1 & 2: Render Texture to Equirect via WebGL ───────────────────────

/**
 * Render a texture to a Float32 equirectangular render target and read back.
 * This is the most robust approach — works for any texture type.
 */
function renderTextureToEquirect(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
  width: number,
  height: number,
): Float32Array | null {
  // Save renderer state
  const origToneMapping = renderer.toneMapping;
  const origToneMappingExposure = renderer.toneMappingExposure;
  const origOutputColorSpace = renderer.outputColorSpace;
  const currentRenderTarget = renderer.getRenderTarget();

  // Disable tone mapping and color space for raw HDR capture
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });

  try {
    // Create a fullscreen quad that samples the texture
    const quadScene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const quadMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tEnv: { value: texture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tEnv;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tEnv, vUv);
          gl_FragColor = vec4(color.rgb, 1.0);
        }
      `,
    });

    const quad = new THREE.Mesh(quadGeo, quadMat);
    quadScene.add(quad);

    // Render
    renderer.setRenderTarget(rt);
    renderer.render(quadScene, quadCamera);

    // Read back pixels
    const pixels = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);

    // WebGL readRenderTargetPixels returns bottom-to-top; flip to top-to-bottom
    flipVertical(pixels, width, height);

    // Cleanup
    quadGeo.dispose();
    quadMat.dispose();

    return pixels;
  } catch (err) {
    console.error('[LightForge HDRI] WebGL texture render failed:', err);
    return null;
  } finally {
    renderer.toneMapping = origToneMapping;
    renderer.toneMappingExposure = origToneMappingExposure;
    renderer.outputColorSpace = origOutputColorSpace;
    rt.dispose();
    renderer.setRenderTarget(currentRenderTarget);
  }
}

// ─── Method 3: WebGL CubeCamera + Cube-to-Equirect Capture ──────────────────

/**
 * Capture a PMREM environment texture as an equirectangular Float32 image.
 *
 * Strategy:
 *   1. Create an inverted sphere that displays the PMREM env via MeshStandardMaterial
 *   2. Use CubeCamera to capture 6 cube faces from inside
 *   3. Render cube faces to equirectangular via a fullscreen cube-sampling shader
 *   4. Read back Float32 pixels
 */
function capturePMREMAsEquirect(
  renderer: THREE.WebGLRenderer,
  envTexture: THREE.Texture,
  width: number,
  height: number,
): Float32Array | null {
  // Save renderer state
  const origToneMapping = renderer.toneMapping;
  const origToneMappingExposure = renderer.toneMappingExposure;
  const origOutputColorSpace = renderer.outputColorSpace;
  const currentRenderTarget = renderer.getRenderTarget();

  // Disable tone mapping and color space for raw HDR capture
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cubeSize = Math.min(height, 1024);

  // Create cube render target (Float32 for HDR)
  const cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
  });

  // Create equirect render target
  const equirectRT = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });

  try {
    // Step 1: Create environment-only scene with inverted sphere
    const envScene = new THREE.Scene();

    const sphereGeo = new THREE.SphereGeometry(50, 128, 64);
    const sphereMat = new THREE.MeshStandardMaterial({
      side: THREE.BackSide,
      roughness: 0.0,
      metalness: 0.0,
      color: 0xffffff,
      envMap: envTexture,
      envMapIntensity: 1.0,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    envScene.add(sphere);

    // Small ambient so MeshStandardMaterial is "active"
    const ambient = new THREE.AmbientLight(0xffffff, 0.001);
    envScene.add(ambient);

    // Step 2: Capture with CubeCamera
    const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRT);
    envScene.add(cubeCamera);
    cubeCamera.update(renderer, envScene);

    // Step 3: Convert cube faces to equirectangular
    const convertScene = new THREE.Scene();
    const convertCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const quadMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tCubeMap: { value: cubeRT.texture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform samplerCube tCubeMap;
        varying vec2 vUv;

        const float PI = 3.141592653589793;

        void main() {
          // Convert equirectangular UV to 3D direction
          float theta = vUv.x * 2.0 * PI;
          float phi = vUv.y * PI;

          vec3 dir = vec3(
            sin(phi) * sin(theta),
            cos(phi),
            sin(phi) * cos(theta)
          );

          vec4 color = textureCube(tCubeMap, dir);
          gl_FragColor = vec4(color.rgb, 1.0);
        }
      `,
    });

    const quad = new THREE.Mesh(quadGeo, quadMat);
    convertScene.add(quad);

    // Render cube → equirectangular
    renderer.setRenderTarget(equirectRT);
    renderer.render(convertScene, convertCamera);

    // Step 4: Read back pixels
    const pixels = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(equirectRT, 0, 0, width, height, pixels);

    // Flip bottom-to-top → top-to-bottom
    flipVertical(pixels, width, height);

    // Cleanup
    sphereGeo.dispose();
    sphereMat.dispose();
    quadGeo.dispose();
    quadMat.dispose();

    // Verify
    let maxVal = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const m = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (m > maxVal) maxVal = m;
    }
    console.log(`[LightForge HDRI] CubeCamera capture: max value = ${maxVal.toFixed(4)}`);
    if (maxVal < 0.0001) {
      console.warn('[LightForge HDRI] CubeCamera capture produced near-zero values');
      return null;
    }

    return pixels;
  } catch (err) {
    console.error('[LightForge HDRI] CubeCamera capture error:', err);
    return null;
  } finally {
    renderer.toneMapping = origToneMapping;
    renderer.toneMappingExposure = origToneMappingExposure;
    renderer.outputColorSpace = origOutputColorSpace;
    cubeRT.dispose();
    equirectRT.dispose();
    renderer.setRenderTarget(currentRenderTarget);
  }
}

// ─── Method 4: Analytical Light Radiance (Fallback) ──────────────────────────

interface ExtractedLight {
  type: 'point' | 'spot' | 'directional' | 'area' | 'hemisphere';
  color: THREE.Color;
  intensity: number;
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  angle?: number;
  penumbra?: number;
  decay?: number;
  width?: number;
  height?: number;
  right?: THREE.Vector3;
  up?: THREE.Vector3;
  normal?: THREE.Vector3;
  groundColor?: THREE.Color;
}

const SUN_ANGULAR_RADIUS = 0.004635;
const POINT_LIGHT_VISUAL_RADIUS = 2.5 * (Math.PI / 180);
const GAUSSIAN_SOFTNESS = 4.0;

function pixelToDirection(x: number, y: number, w: number, h: number): THREE.Vector3 {
  const u = (x + 0.5) / w;
  const v = (y + 0.5) / h;
  const theta = u * 2 * Math.PI;
  const phi = v * Math.PI;
  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  ).normalize();
}

function softFalloff(angle: number, radius: number): number {
  if (angle >= radius) return 0;
  const t = angle / radius;
  const s = t * t * (3 - 2 * t);
  return 1.0 - s;
}

function evaluateLightRadiance(
  light: ExtractedLight,
  dir: THREE.Vector3,
  capturePoint: THREE.Vector3,
): THREE.Color {
  const result = { r: 0, g: 0, b: 0 };

  switch (light.type) {
    case 'point': {
      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      toLight.normalize();
      const cosAngle = Math.max(-1, Math.min(1, dir.dot(toLight)));
      const angle = Math.acos(cosAngle);
      const physicalRadius = Math.atan2(0.3, dist);
      const visualRadius = Math.max(physicalRadius, POINT_LIGHT_VISUAL_RADIUS);
      const falloff = softFalloff(angle, visualRadius * GAUSSIAN_SOFTNESS);
      if (falloff <= 0) break;
      const solidAngle = Math.PI * Math.sin(visualRadius) * Math.sin(visualRadius);
      const safeSolidAngle = Math.max(1e-6, solidAngle);
      const radiance = (light.intensity / safeSolidAngle) * 200 * falloff;
      result.r = light.color.r * radiance;
      result.g = light.color.g * radiance;
      result.b = light.color.b * radiance;
      break;
    }
    case 'spot': {
      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      toLight.normalize();
      const toCaptureDir = new THREE.Vector3().subVectors(capturePoint, light.position).normalize();
      const lightDir = light.direction ?? new THREE.Vector3(0, -1, 0).clone().normalize();
      const spotAngle = Math.acos(Math.max(-1, Math.min(1, toCaptureDir.dot(lightDir))));
      const halfAngle = light.angle ?? Math.PI / 4;
      const penumbra = light.penumbra ?? 0.1;
      if (spotAngle >= halfAngle) break;
      const coneT = Math.max(0, Math.min(1, (halfAngle - spotAngle) / Math.max(0.001, penumbra * halfAngle)));
      const coneFalloff = coneT * coneT * (3 - 2 * coneT);
      const cosAngle = Math.max(-1, Math.min(1, dir.dot(toLight)));
      const angle = Math.acos(cosAngle);
      const physicalRadius = Math.atan2(0.3, dist);
      const coneScale = Math.sin(halfAngle);
      const visualRadius = Math.max(physicalRadius, POINT_LIGHT_VISUAL_RADIUS * coneScale);
      const falloff = softFalloff(angle, visualRadius * GAUSSIAN_SOFTNESS);
      if (falloff <= 0) break;
      const decay = light.decay ?? 2;
      const distDecay = Math.pow(Math.max(0.1, dist), -decay) * Math.pow(Math.max(0.1, 5), decay);
      const solidAngle = Math.PI * Math.sin(visualRadius) * Math.sin(visualRadius);
      const safeSolidAngle = Math.max(1e-6, solidAngle);
      const radiance = (light.intensity / safeSolidAngle) * 200 * falloff * coneFalloff * distDecay;
      result.r = light.color.r * radiance;
      result.g = light.color.g * radiance;
      result.b = light.color.b * radiance;
      break;
    }
    case 'directional': {
      const lightDir = light.direction ?? new THREE.Vector3(0, -1, 0).clone().normalize();
      const toSun = lightDir.clone().negate().normalize();
      const cosAngle = Math.max(-1, Math.min(1, dir.dot(toSun)));
      const angleToSun = Math.acos(cosAngle);
      if (angleToSun < SUN_ANGULAR_RADIUS) {
        const radiance = light.intensity * 80000;
        result.r = light.color.r * radiance;
        result.g = light.color.g * radiance;
        result.b = light.color.b * radiance;
      } else {
        const glowRadius = SUN_ANGULAR_RADIUS * 8;
        const glowFalloff = softFalloff(angleToSun, glowRadius);
        if (glowFalloff > 0) {
          const glowRadiance = light.intensity * 50 * glowFalloff;
          result.r = light.color.r * glowRadiance;
          result.g = light.color.g * glowRadiance;
          result.b = light.color.b * glowRadiance;
        }
      }
      break;
    }
    case 'area': {
      const lightNormal = light.normal ?? new THREE.Vector3(0, 0, 1);
      const facingDir = new THREE.Vector3().subVectors(capturePoint, light.position).normalize();
      if (facingDir.dot(lightNormal) < 0) break;
      const lightRight = light.right ?? new THREE.Vector3(1, 0, 0);
      const lightUp = light.up ?? new THREE.Vector3(0, 1, 0);
      const rectW = light.width ?? 2;
      const rectH = light.height ?? 2;
      const samples = 12;
      let accR = 0, accG = 0, accB = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const su = (sx + 0.5) / samples;
          const sv = (sy + 0.5) / samples;
          const px = light.position.x + lightRight.x * (su - 0.5) * rectW + lightUp.x * (sv - 0.5) * rectH;
          const py = light.position.y + lightRight.y * (su - 0.5) * rectW + lightUp.y * (sv - 0.5) * rectH;
          const pz = light.position.z + lightRight.z * (su - 0.5) * rectW + lightUp.z * (sv - 0.5) * rectH;
          const dx = px - capturePoint.x;
          const dy = py - capturePoint.y;
          const dz = pz - capturePoint.z;
          const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy + dz * dz));
          const invDist = 1 / dist;
          const tx = dx * invDist;
          const ty = dy * invDist;
          const tz = dz * invDist;
          const cosA = Math.max(-1, Math.min(1, dir.x * tx + dir.y * ty + dir.z * tz));
          const angle = Math.acos(cosA);
          const subW = rectW / samples;
          const subH = rectH / samples;
          const sampleRadius = Math.atan2(Math.max(subW, subH) * 0.6, dist);
          const falloff = softFalloff(angle, sampleRadius * GAUSSIAN_SOFTNESS);
          if (falloff <= 0) continue;
          const cosEmit = Math.max(0, -(tx * lightNormal.x + ty * lightNormal.y + tz * lightNormal.z));
          const solidAngle = Math.PI * Math.sin(sampleRadius) * Math.sin(sampleRadius);
          const safeSA = Math.max(1e-6, solidAngle);
          const radiance = (light.intensity * cosEmit / safeSA) * 150 * falloff;
          accR += light.color.r * radiance;
          accG += light.color.g * radiance;
          accB += light.color.b * radiance;
        }
      }
      const totalSamples = samples * samples;
      result.r = accR / totalSamples;
      result.g = accG / totalSamples;
      result.b = accB / totalSamples;
      break;
    }
    case 'hemisphere': {
      const t = (dir.y + 1) / 2;
      const skyCol = light.color;
      const gndCol = light.groundColor ?? new THREE.Color(0, 0, 0);
      result.r = (gndCol.r * (1 - t) + skyCol.r * t) * light.intensity;
      result.g = (gndCol.g * (1 - t) + skyCol.g * t) * light.intensity;
      result.b = (gndCol.b * (1 - t) + skyCol.b * t) * light.intensity;
      break;
    }
  }

  return new THREE.Color(result.r, result.g, result.b);
}

function extractLightsFromScene(scene: THREE.Scene): ExtractedLight[] {
  const lights: ExtractedLight[] = [];
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();

  scene.traverse((child) => {
    if (!(child instanceof THREE.Light)) return;
    if (!child.visible) return;
    if (child.userData.isLightHelper === true) return;
    if (child.userData.isProxy === true) return;
    if (child.userData.isGrid === true) return;

    child.getWorldPosition(worldPos);

    if (child instanceof THREE.PointLight) {
      lights.push({
        type: 'point', color: child.color.clone(), intensity: child.intensity,
        position: worldPos.clone(), decay: child.decay,
      });
      return;
    }
    if (child instanceof THREE.SpotLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({
        type: 'spot', color: child.color.clone(), intensity: child.intensity,
        position: worldPos.clone(), direction: dir.clone(),
        angle: child.angle, penumbra: child.penumbra, decay: child.decay,
      });
      return;
    }
    if (child instanceof THREE.DirectionalLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({
        type: 'directional', color: child.color.clone(), intensity: child.intensity,
        position: worldPos.clone(), direction: dir.clone(),
      });
      return;
    }
    if (child instanceof THREE.RectAreaLight) {
      child.getWorldQuaternion(worldQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
      lights.push({
        type: 'area', color: child.color.clone(), intensity: child.intensity,
        position: worldPos.clone(), width: child.width, height: child.height,
        right: right.clone(), up: up.clone(), normal: normal.clone(),
      });
      return;
    }
    if (child instanceof THREE.HemisphereLight) {
      lights.push({
        type: 'hemisphere', color: child.color.clone(), intensity: child.intensity,
        position: worldPos.clone(),
        groundColor: child.groundColor?.clone() ?? new THREE.Color(0, 0, 0),
      });
      return;
    }
  });

  return lights;
}

/**
 * Generate HDRI analytically from scene lights (fallback).
 */
async function generateAnalyticalHDRI(
  scene: THREE.Scene,
  width: number,
  height: number,
  capturePoint: THREE.Vector3,
): Promise<Float32Array> {
  const pixels = new Float32Array(width * height * 4);
  const lights = extractLightsFromScene(scene);
  console.log('[LightForge HDRI] Analytical: found', lights.length, 'lights');

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dir = pixelToDirection(x, y, width, height);
      let r = 0, g = 0, b = 0;

      for (let i = 0; i < lights.length; i++) {
        const c = evaluateLightRadiance(lights[i], dir, capturePoint);
        r += c.r;
        g += c.g;
        b += c.b;
      }

      const idx = (y * width + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 1.0;
    }

    // Yield to the event loop every 100 rows
    if (y % 100 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return pixels;
}

// ─── Encoding: RGBE (.hdr) ───────────────────────────────────────────────────

/**
 * Encode Float32 RGBA pixel data into a valid Radiance RGBE .hdr file.
 *
 * Uses the standard RLE (run-length encoding) format with proper
 * per-scanline headers, ensuring compatibility with Photoshop,
 * Blender, HDRShop, and all other HDR readers.
 *
 * Input:  RGBA Float32Array (4 floats/pixel, top-to-bottom, linear).
 * Output: Complete .hdr file as ArrayBuffer.
 */
export function encodeHDR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  // ── Build header ─────────────────────────────────────────────────────────
  const headerLines = [
    '#?RADIANCE',
    'SOFTWARE=LightForge Studio',
    'FORMAT=32-bit_rle_rgbe',
    '',
    `-Y ${height} +X ${width}`,
    '',
  ];
  const headerStr = headerLines.join('\n');
  const headerBytes = new TextEncoder().encode(headerStr);

  // ── Convert all pixels to RGBE bytes ─────────────────────────────────────
  // rgbeData[y][x] = [R, G, B, E] as uint8
  const rgbeData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * 4;
    rgbFloatToRGBE(
      pixels[srcIdx], pixels[srcIdx + 1], pixels[srcIdx + 2],
      rgbeData, i * 4,
    );
  }

  // ── RLE encode scanlines ────────────────────────────────────────────────
  // Pre-allocate a generous buffer for RLE output.
  // Worst case: each scanline expands slightly for RLE overhead.
  // Max RLE per scanline: 4 channels * (128 + 128 * 2) = ~1280 bytes per channel
  // So max per scanline: 4 (header) + 4 * 1280 = ~5124 bytes
  const maxRLEPerScanline = 4 + 4 * (128 + 128 * 2); // header + 4 channels worst case
  const rleBuffer = new Uint8Array(height * maxRLEPerScanline);
  let rleOffset = 0;

  for (let y = 0; y < height; y++) {
    // New RLE scanline header: 0x02, 0x02, width_hi, width_lo
    rleBuffer[rleOffset++] = 0x02;
    rleBuffer[rleOffset++] = 0x02;
    rleBuffer[rleOffset++] = (width >> 8) & 0xFF;
    rleBuffer[rleOffset++] = width & 0xFF;

    // RLE encode each of the 4 channels (R, G, B, E)
    for (let ch = 0; ch < 4; ch++) {
      rleOffset += rleEncodeChannel(rgbeData, y * width * 4, ch, width, rleBuffer, rleOffset);
    }
  }

  // ── Assemble final file ─────────────────────────────────────────────────
  const totalSize = headerBytes.length + rleOffset;
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);
  view.set(headerBytes, 0);
  view.set(rleBuffer.subarray(0, rleOffset), headerBytes.length);

  return buffer;
}

/**
 * RLE-encode one channel of one scanline into the output buffer.
 *
 * Radiance RLE format for a single channel:
 *   - Run of identical bytes (3-128): write (count | 0x80), value  → 2 bytes
 *   - Literal run (1-128 different bytes): write count, byte1..byteN  → 1+count bytes
 *
 * @param rgbeData  The full RGBE byte array
 * @param rowOffset Byte offset to the start of this scanline's RGBE data
 * @param channel   Channel index (0=R, 1=G, 2=B, 3=E)
 * @param width     Number of pixels in the scanline
 * @param out       Output buffer
 * @param outOff    Current write offset in output buffer
 * @returns Number of bytes written
 */
function rleEncodeChannel(
  rgbeData: Uint8Array,
  rowOffset: number,
  channel: number,
  width: number,
  out: Uint8Array,
  outOff: number,
): number {
  let written = 0;
  let x = 0;

  while (x < width) {
    // Count the run of identical bytes starting at x
    let runLen = 1;
    const val = rgbeData[rowOffset + x * 4 + channel];
    while (x + runLen < width && runLen < 128 && rgbeData[rowOffset + (x + runLen) * 4 + channel] === val) {
      runLen++;
    }

    if (runLen >= 3) {
      // Write run: count byte (0x80 | runLen), value byte
      out[outOff + written++] = 0x80 | runLen;
      out[outOff + written++] = val;
      x += runLen;
    } else {
      // Collect a literal run of non-repeating bytes
      let litLen = 0;
      let litStart = x;

      // Find how many literal bytes we can write (max 128)
      while (litLen < 128 && x + litLen < width) {
        // Check if starting a new run of 3+ identical bytes
        if (litLen > 0) {
          const nextVal = rgbeData[rowOffset + (x + litLen) * 4 + channel];
          let futureRun = 1;
          while (x + litLen + futureRun < width && futureRun < 3 &&
                 rgbeData[rowOffset + (x + litLen + futureRun) * 4 + channel] === nextVal) {
            futureRun++;
          }
          if (futureRun >= 3) break; // Stop literal, let the run be encoded separately
        }
        litLen++;
      }

      // Write literal: count byte, then litLen bytes
      out[outOff + written++] = litLen;
      for (let i = 0; i < litLen; i++) {
        out[outOff + written++] = rgbeData[rowOffset + (litStart + i) * 4 + channel];
      }
      x += litLen;
    }
  }

  return written;
}

/**
 * Convert a single RGB float triplet to Radiance RGBE (4 bytes).
 */
function rgbFloatToRGBE(
  r: number,
  g: number,
  b: number,
  out: Uint8Array,
  off: number,
): void {
  const maxVal = Math.max(r, g, b);

  if (maxVal < 1e-32) {
    out[off] = 0;
    out[off + 1] = 0;
    out[off + 2] = 0;
    out[off + 3] = 0;
    return;
  }

  // Compute exponent: largest power of 2 such that maxVal / 2^exp < 1.0
  let exp = Math.floor(Math.log2(maxVal)) + 1;
  const scaled = maxVal * Math.pow(2, -exp);

  // Adjust exponent so that scaled is in [0.5, 1.0)
  if (scaled < 0.5) {
    exp--;
  } else if (scaled >= 1.0) {
    exp++;
  }

  // Encode mantissa: scale each channel to [0, 255]
  const scale = Math.pow(2, -exp) * 256.0;
  out[off] = Math.max(0, Math.min(255, Math.floor(r * scale)));
  out[off + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
  out[off + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
  out[off + 3] = Math.max(0, Math.min(255, exp + 128));
}

// ─── Encoding: OpenEXR (.exr) ────────────────────────────────────────────────

/**
 * Encode Float32 RGBA pixel data into a valid OpenEXR 2.0 .exr file.
 *
 * Channels: B, G, R (alphabetical order, each float32).
 * Compression: NO_COMPRESSION (0).
 * Version: 2 (includes ySampling in channel entries).
 * Input: RGBA Float32Array (4 floats/pixel, top-to-bottom, linear).
 * Output: Complete .exr file as ArrayBuffer.
 */
export function encodeEXR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  const CHANNEL_NAMES = ['B', 'G', 'R'] as const;
  const PIXEL_TYPE_FLOAT = 2;
  const NUM_CHANNELS = 3;
  const BYTES_PER_PIXEL = NUM_CHANNELS * 4; // 3 channels × 4 bytes
  const SCANLINE_PIXEL_DATA_SIZE = width * BYTES_PER_PIXEL;

  // ── Helper functions ────────────────────────────────────────────────────
  const intToBytesLE = (val: number): Uint8Array => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, val, true); // little-endian
    return new Uint8Array(buf);
  };

  const floatToBytesLE = (val: number): Uint8Array => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    return new Uint8Array(buf);
  };

  // Build a channel entry: name\0 + padding + 5 × int32 fields
  const buildChannelEntry = (name: string): Uint8Array => {
    const nameBytes = new TextEncoder().encode(name);
    const nameWithNull = nameBytes.length + 1; // includes null terminator
    const namePadded = nameWithNull + ((4 - (nameWithNull % 4)) % 4);

    // 5 int32 fields: pixelType, pLinear, reserved, xSampling, ySampling
    const entrySize = namePadded + 5 * 4;
    const entry = new Uint8Array(entrySize);
    const dv = new DataView(entry.buffer);

    // Write name + null + padding
    entry.set(nameBytes, 0);
    // entry[nameBytes.length] is already 0 from Uint8Array initialization (null terminator)
    // Padding bytes are also already 0

    // Write channel fields (all little-endian int32)
    let off = namePadded;
    dv.setInt32(off, PIXEL_TYPE_FLOAT, true); off += 4; // pixel type = FLOAT
    dv.setInt32(off, 0, true);             off += 4; // pLinear = 0
    dv.setInt32(off, 0, true);             off += 4; // reserved = 0
    dv.setInt32(off, 1, true);             off += 4; // xSampling = 1
    dv.setInt32(off, 1, true);             off += 4; // ySampling = 1 (required for version 2)

    return entry;
  };

  // Build an attribute: name\0 + type\0 + size(int32) + value + padding
  const buildAttribute = (name: string, type: string, valueBytes: Uint8Array): Uint8Array => {
    const nameBytes = new TextEncoder().encode(name);
    const typeBytes = new TextEncoder().encode(type);
    const valuePadLen = (4 - (valueBytes.length % 4)) % 4;

    // OpenEXR spec: name (null-terminated, NO padding) + type (null-terminated, NO padding)
    // + size (int32) + value (padded to 4-byte boundary)
    const totalSize = nameBytes.length + 1 + typeBytes.length + 1 + 4 + valueBytes.length + valuePadLen;

    const attr = new Uint8Array(totalSize);
    const dv = new DataView(attr.buffer);
    let off = 0;

    // Name + null terminator (NO padding between name and type)
    attr.set(nameBytes, off); off += nameBytes.length;
    off += 1; // null terminator (already 0 from Uint8Array)

    // Type + null terminator (NO padding between type and size)
    attr.set(typeBytes, off); off += typeBytes.length;
    off += 1; // null terminator

    // Value size (int32 LE)
    dv.setInt32(off, valueBytes.length, true); off += 4;

    // Value bytes + padding to 4-byte boundary
    attr.set(valueBytes, off); off += valueBytes.length;
    // Value padding bytes already 0 from Uint8Array initialization

    return attr;
  };

  // ── Build channel list attribute value ──────────────────────────────────
  const channelEntries: Uint8Array[] = [];
  for (const chName of CHANNEL_NAMES) {
    channelEntries.push(buildChannelEntry(chName));
  }
  // Null terminator for channel list
  const nullTerminator = new Uint8Array(1); // single 0x00 byte
  const channelListValue = concatUint8Arrays(...channelEntries, nullTerminator);

  // ── Build header attributes ─────────────────────────────────────────────
  const compressionValue = new Uint8Array([0]); // NO_COMPRESSION = 0

  const dataWindowValue = new Uint8Array(16);
  const dwDv = new DataView(dataWindowValue.buffer);
  dwDv.setInt32(0, 0, true);                     // xMin
  dwDv.setInt32(4, 0, true);                     // yMin
  dwDv.setInt32(8, width - 1, true);             // xMax
  dwDv.setInt32(12, height - 1, true);           // yMax

  const displayWindowValue = new Uint8Array(16);
  const dpDv = new DataView(displayWindowValue.buffer);
  dpDv.setInt32(0, 0, true);
  dpDv.setInt32(4, 0, true);
  dpDv.setInt32(8, width - 1, true);
  dpDv.setInt32(12, height - 1, true);

  const lineOrderValue = new Uint8Array([0]); // INCREASING_Y

  const pixelAspectRatioValue = floatToBytesLE(1.0);

  const screenWindowCenterValue = concatUint8Arrays(floatToBytesLE(0.0), floatToBytesLE(0.0));
  const screenWindowWidthValue = floatToBytesLE(1.0);

  // Build attributes
  const attrs: Uint8Array[] = [
    buildAttribute('channels', 'chlist', channelListValue),
    buildAttribute('compression', 'compression', compressionValue),
    buildAttribute('dataWindow', 'box2i', dataWindowValue),
    buildAttribute('displayWindow', 'box2i', displayWindowValue),
    buildAttribute('lineOrder', 'lineOrder', lineOrderValue),
    buildAttribute('pixelAspectRatio', 'float', pixelAspectRatioValue),
    buildAttribute('screenWindowCenter', 'v2f', screenWindowCenterValue),
    buildAttribute('screenWindowWidth', 'float', screenWindowWidthValue),
  ];

  // Concatenate all attributes + end-of-header null byte + padding to 8 bytes
  const headerContent = concatUint8Arrays(...attrs);
  const endOfHeader = new Uint8Array(1); // null terminator
  const prePadding = concatUint8Arrays(headerContent, endOfHeader);
  const headerPadLen = (8 - (prePadding.length % 8)) % 8;
  const headerPadding = new Uint8Array(headerPadLen); // all zeros
  const headerBlock = concatUint8Arrays(prePadding, headerPadding);

  // ── Compute file layout ─────────────────────────────────────────────────
  const magicNumberSize = 8; // 4 bytes magic + 4 bytes version
  const offsetTableSize = height * 8; // each offset is uint64
  const scanlineDataStart = magicNumberSize + headerBlock.length + offsetTableSize;

  // Each scanline: y(int32) + pixelDataSize(int32) + pixelData
  const scanlineHeaderSize = 8; // 2 × int32
  const scanlineTotalSize = scanlineHeaderSize + SCANLINE_PIXEL_DATA_SIZE;

  // ── Build offset table ──────────────────────────────────────────────────
  const offsetTable = new Uint8Array(offsetTableSize);
  const otDv = new DataView(offsetTable.buffer);
  for (let y = 0; y < height; y++) {
    const offset = scanlineDataStart + y * scanlineTotalSize;
    // Write as uint64 LE (two uint32 values)
    otDv.setUint32(y * 8, offset & 0xFFFFFFFF, true);         // low 32 bits
    otDv.setUint32(y * 8 + 4, Math.floor(offset / 0x100000000), true); // high 32 bits
  }

  // ── Build scanline data ─────────────────────────────────────────────────
  const scanlineDataSize = height * scanlineTotalSize;
  const scanlineData = new Uint8Array(scanlineDataSize);
  const slDv = new DataView(scanlineData.buffer);

  for (let y = 0; y < height; y++) {
    const baseOff = y * scanlineTotalSize;

    // y coordinate (int32 LE)
    slDv.setInt32(baseOff, y, true);
    // pixel data size (int32 LE)
    slDv.setInt32(baseOff + 4, SCANLINE_PIXEL_DATA_SIZE, true);

    // Pixel data: for each pixel, write B, G, R as float32 LE
    const pixelStart = baseOff + scanlineHeaderSize;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const pixOff = pixelStart + x * BYTES_PER_PIXEL;

      // B (channel index 2)
      slDv.setFloat32(pixOff, pixels[srcIdx + 2], true);
      // G (channel index 1)
      slDv.setFloat32(pixOff + 4, pixels[srcIdx + 1], true);
      // R (channel index 0)
      slDv.setFloat32(pixOff + 8, pixels[srcIdx], true);
    }
  }

  // ── Assemble final file ─────────────────────────────────────────────────
  const magicAndVersion = new Uint8Array(8);
  const mvDv = new DataView(magicAndVersion.buffer);
  mvDv.setUint32(0, 20000630, true); // magic number
  mvDv.setUint32(4, 2, true);         // version 2, no flags

  const totalSize = magicNumberSize + headerBlock.length + offsetTableSize + scanlineData.length;
  const file = new Uint8Array(totalSize);

  file.set(magicAndVersion, 0);
  file.set(headerBlock, magicNumberSize);
  file.set(offsetTable, magicNumberSize + headerBlock.length);
  file.set(scanlineData, scanlineDataStart);

  return file.buffer;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Load a raw .hdr ArrayBuffer into a THREE.DataTexture via RGBELoader.
 */
function loadHDRITexture(buffer: ArrayBuffer): Promise<THREE.DataTexture | null> {
  return new Promise<THREE.DataTexture | null>((resolve) => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const loader = new RGBELoader();
    loader.load(
      url,
      (texture) => {
        URL.revokeObjectURL(url);
        resolve(texture);
      },
      undefined,
      () => {
        URL.revokeObjectURL(url);
        resolve(null);
      },
    );
  });
}

/**
 * Flip a pixel buffer vertically (bottom-to-top → top-to-bottom).
 * Operates in-place on RGBA Float32 data.
 */
function flipVertical(pixels: Float32Array, width: number, height: number): void {
  const rowSize = width * 4;
  const halfHeight = Math.floor(height / 2);
  const tempRow = new Float32Array(rowSize);

  for (let y = 0; y < halfHeight; y++) {
    const topIdx = y * rowSize;
    const botIdx = (height - 1 - y) * rowSize;
    tempRow.set(pixels.subarray(topIdx, topIdx + rowSize));
    pixels.copyWithin(topIdx, botIdx, botIdx + rowSize);
    pixels.set(tempRow, botIdx);
  }
}

/**
 * Check if pixel data has any meaningful non-zero values.
 */
function hasValidData(pixels: Float32Array): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    const m = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (m > 0.001) return true;
  }
  return false;
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const a of arrays) {
    result.set(a, off);
    off += a.length;
  }
  return result;
}

/**
 * Convert sRGB gamma value to linear.
 */
function sRGBToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Trigger a browser download for an ArrayBuffer.
 */
function downloadBuffer(buffer: ArrayBuffer, filename: string, mimeType: string): void {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (link.parentNode) link.parentNode.removeChild(link);
  }, 250);
}