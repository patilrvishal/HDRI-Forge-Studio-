/**
 * HDRIExporter — WebGL-based HDRI/EXR export for LightForge Studio.
 *
 * Captures the actual environment map displayed in the viewport and exports
 * it as a true HDR equirectangular image (.hdr or .exr).
 *
 * Export strategy (in priority order):
 *   1. Direct texture read: If scene.background is a DataTexture (custom HDRI
 *      shown as backplate), read its Float32 pixel data directly.
 *   2. Raw data fallback: If raw HDRI ArrayBuffer exists in the store
 *      (custom HDRI loaded but not shown as background), load via RGBELoader
 *      and read pixels.
 *   3. WebGL PMREM capture: If scene.environment exists (built-in presets
 *      or PMREM-processed textures), render it to equirectangular via a
 *      WebGL shader that samples the PMREM texture.
 *   4. Analytical fallback: If no environment exists at all, compute
 *      radiance analytically from scene lights.
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
 *
 * Captures the actual HDRI environment visible in the viewport (not analytical
 * light radiance). Falls back to analytical generation only if no environment
 * texture exists.
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
  console.log(`[LightForge HDRI] Max value: ${maxVal.toFixed(2)}, Non-zero: ${nonZero}/${total} (${((nonZero / total) * 100).toFixed(1)}%)`);

  if (nonZero === 0) {
    console.warn('[LightForge HDRI] WARNING: Exported HDRI is entirely black. No environment or lights found.');
  }

  const buffer = encodeHDR(pixels, width, height);
  downloadBuffer(buffer, `${options?.filename ?? 'lightforge_hdri_' + Date.now()}.hdr`, 'image/vnd.radiance');
  console.log('[LightForge HDRI] HDR export complete.');
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

  const pixels = await captureEnvironmentHDRI(renderer, scene, width, height);

  const buffer = encodeEXR(pixels, width, height);
  downloadBuffer(buffer, `${options?.filename ?? 'lightforge_hdri_' + Date.now()}.exr`, 'image/x-exr');
  console.log('[LightForge HDRI] EXR export complete.');
}

// ─── Core: Capture Environment ────────────────────────────────────────────────

/**
 * Capture the scene's environment as an equirectangular Float32Array.
 *
 * Strategy:
 *   1. If scene.background is a texture → read pixels directly
 *   2. If raw HDRI data exists in store → load and read
 *   3. If scene.environment exists → WebGL PMREM capture
 *   4. Fall back to analytical light radiance
 */
async function captureEnvironmentHDRI(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  width: number,
  height: number,
): Promise<Float32Array> {
  // ── Method 1: Direct texture read from scene.background ───────────────────
  // This works when a custom HDRI is loaded and showBackground=true,
  // because EnvironmentLoader.setBackgroundFromEnv() sets scene.background
  // to the original equirectangular DataTexture.
  if (scene.background instanceof THREE.Texture) {
    console.log('[LightForge HDRI] Method 1: Reading scene.background texture directly');
    const pixels = readEquirectTexturePixels(scene.background, width, height);
    if (pixels) return pixels;
  }

  // ── Method 2: Raw HDRI data from store ────────────────────────────────────
  // This works when a custom HDRI was loaded but showBackground=false.
  const rawBuffer = getRawHDRIData();
  if (rawBuffer) {
    console.log('[LightForge HDRI] Method 2: Loading raw HDRI data from store');
    try {
      const texture = await loadHDRITexture(rawBuffer);
      if (texture) {
        const pixels = readEquirectTexturePixels(texture, width, height);
        texture.dispose();
        if (pixels) return pixels;
      }
    } catch (err) {
      console.warn('[LightForge HDRI] Failed to load raw HDRI data:', err);
    }
  }

  // ── Method 3: WebGL PMREM capture ─────────────────────────────────────────
  // This works for built-in presets where scene.environment is a PMREM texture.
  if (scene.environment) {
    console.log('[LightForge HDRI] Method 3: WebGL PMREM capture');
    try {
      const pixels = capturePMREMAsEquirect(renderer, scene.environment, width, height);
      if (pixels) return pixels;
    } catch (err) {
      console.warn('[LightForge HDRI] PMREM capture failed:', err);
    }
  }

  // ── Method 4: Analytical fallback ─────────────────────────────────────────
  console.log('[LightForge HDRI] Method 4: Analytical light radiance fallback');
  return generateAnalyticalHDRI(
    scene, width, height,
    new THREE.Vector3(0, 0, 0),
    false, null, 1.0, 0,
  );
}

// ─── Method 1 & 2: Read Equirectangular Texture Pixels ───────────────────────

/**
 * Read pixel data from an equirectangular DataTexture and resize to target dimensions.
 *
 * Handles:
 *   - DataTexture with Float32Array image data (from RGBELoader)
 *   - DataTexture with Uint8Array image data (from Canvas/Image)
 *   - Arbitrary source dimensions → resized to target width x height
 *
 * @returns Float32Array of RGBA (4 floats/pixel, linear, top-to-bottom) or null on failure.
 */
function readEquirectTexturePixels(
  texture: THREE.Texture,
  targetWidth: number,
  targetHeight: number,
): Float32Array | null {
  const img = texture.image as unknown as Record<string, unknown> | null;
  if (!img || typeof img !== 'object' || !('width' in img) || !('height' in img)) return null;

  const srcW = Number(img.width);
  const srcH = Number(img.height);
  if (srcW < 1 || srcH < 1) return null;

  // Get source pixel data
  let srcData: Float32Array | Uint8Array | null = null;
  let isFloat = false;

  if (img instanceof HTMLCanvasElement) {
    const ctx = img.getContext('2d');
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, srcW, srcH);
    srcData = new Uint8Array(imgData.data.buffer) ;
  } else if (img instanceof ImageData) {
    srcData = new Uint8Array(img.data.buffer);
  } else if ((img as any).data) {
    const d = (img as any).data;
    if (d instanceof Float32Array) {
      srcData = d;
      isFloat = true;
    } else if (d instanceof Uint8Array) {
      srcData = d;
    }
  }

  if (!srcData) return null;

  // If source dimensions match target, read directly
  if (srcW === targetWidth && srcH === targetHeight) {
    return extractAndConvert(srcData, isFloat, srcW * srcH);
  }

  // Otherwise, bilinear-resample from source to target
  const pixels = new Float32Array(targetWidth * targetHeight * 4);
  const channels = 4;

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      // Map target pixel to source UV
      const u = (tx + 0.5) / targetWidth;
      const v = (ty + 0.5) / targetHeight;

      // Source pixel coordinates (with 0.5 offset for center-sampling)
      const sx = u * srcW - 0.5;
      const sy = v * srcH - 0.5;

      // Bilinear interpolation
      const x0 = ((Math.floor(sx) % srcW) + srcW) % srcW;
      const y0 = ((Math.floor(sy) % srcH) + srcH) % srcH;
      const x1 = (x0 + 1) % srcW;
      const y1 = (y0 + 1) % srcH;
      const fx = sx - Math.floor(sx);
      const fy = sy - Math.floor(sy);

      const getPixel = (xi: number, yi: number): [number, number, number, number] => {
        const idx = (yi * srcW + xi) * channels;
        if (idx < 0 || idx + 3 >= srcData.length) return [0, 0, 0, 1];
        if (isFloat) {
          const f = srcData as Float32Array;
          return [f[idx], f[idx + 1], f[idx + 2], f[idx + 3]];
        }
        // Uint8 → sRGB to linear
        return [
          sRGBToLinear((srcData[idx] ?? 0) / 255),
          sRGBToLinear((srcData[idx + 1] ?? 0) / 255),
          sRGBToLinear((srcData[idx + 2] ?? 0) / 255),
          (srcData[idx + 3] ?? 255) / 255,
        ];
      };

      const c00 = getPixel(x0, y0);
      const c10 = getPixel(x1, y0);
      const c01 = getPixel(x0, y1);
      const c11 = getPixel(x1, y1);

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const outIdx = (ty * targetWidth + tx) * 4;
      pixels[outIdx]     = c00[0] * w00 + c10[0] * w10 + c01[0] * w01 + c11[0] * w11;
      pixels[outIdx + 1] = c00[1] * w00 + c10[1] * w10 + c01[1] * w01 + c11[1] * w11;
      pixels[outIdx + 2] = c00[2] * w00 + c10[2] * w10 + c01[2] * w01 + c11[2] * w11;
      pixels[outIdx + 3] = 1.0;
    }
  }

  return pixels;
}

/**
 * Extract pixel data from a source array, converting to Float32 linear RGBA.
 */
function extractAndConvert(
  srcData: Float32Array | Uint8Array,
  isFloat: boolean,
  pixelCount: number,
): Float32Array {
  const pixels = new Float32Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const si = i * 4;
    const di = i * 4;
    if (isFloat) {
      const f = srcData as Float32Array;
      pixels[di]     = f[si] ?? 0;
      pixels[di + 1] = f[si + 1] ?? 0;
      pixels[di + 2] = f[si + 2] ?? 0;
      pixels[di + 3] = f[si + 3] ?? 1;
    } else {
      pixels[di]     = sRGBToLinear(((srcData[si] ?? 0) as number) / 255);
      pixels[di + 1] = sRGBToLinear(((srcData[si + 1] ?? 0) as number) / 255);
      pixels[di + 2] = sRGBToLinear(((srcData[si + 2] ?? 0) as number) / 255);
      pixels[di + 3] = 1.0;
    }
  }
  return pixels;
}

// ─── Method 3: WebGL CubeCamera + Cube-to-Equirect Capture ──────────────────

/**
 * Capture a PMREM environment texture as an equirectangular Float32 image
 * using CubeCamera and cube-to-equirectangular conversion.
 *
 * Strategy:
 *   1. Create an environment-only scene with a large inverted sphere that
 *      displays the PMREM environment map via MeshStandardMaterial.
 *   2. Use CubeCamera to capture 6 cube faces from inside the sphere.
 *   3. Render the cube faces to an equirectangular map using a fullscreen
 *      shader with standard samplerCube sampling.
 *   4. Read back Float32 pixels.
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

  // Disable tone mapping and color space conversion for raw HDR capture
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // Use half-height as cube face size (quality vs speed balance)
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
    // ── Step 1: Create environment-only scene with inverted sphere ────────
    const envScene = new THREE.Scene();

    // Large inverted sphere that shows the environment map on its inner surface.
    // MeshStandardMaterial properly handles PMREM texture sampling (Three.js
    // sets all required CUBEUV defines internally).
    // roughness=0 gives sharp reflections (mip 0), metalness=0 for no tint.
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

    // Ambient light so the material is "active" (MeshStandardMaterial needs
    // some light to render, but envMap provides the visual content)
    const ambient = new THREE.AmbientLight(0xffffff, 0.001);
    envScene.add(ambient);

    // ── Step 2: Capture with CubeCamera ───────────────────────────────────
    const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRT);
    envScene.add(cubeCamera);
    cubeCamera.update(renderer, envScene);

    // ── Step 3: Convert cube faces to equirectangular ────────────────────
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

          // Sample cube map (standard hardware cube map sampling)
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

    // ── Step 4: Read back pixels ─────────────────────────────────────────
    const pixels = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(equirectRT, 0, 0, width, height, pixels);

    // WebGL readRenderTargetPixels returns bottom-to-top, flip to top-to-bottom
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

    // ── Cleanup ──────────────────────────────────────────────────────────
    sphereGeo.dispose();
    sphereMat.dispose();
    quadGeo.dispose();
    quadMat.dispose();

    // Verify we got meaningful data
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
    // Restore renderer state
    renderer.toneMapping = origToneMapping;
    renderer.toneMappingExposure = origToneMappingExposure;
    renderer.outputColorSpace = origOutputColorSpace;
    cubeRT.dispose();
    equirectRT.dispose();
    renderer.setRenderTarget(currentRenderTarget);
  }
}

// ─── Method 4: Analytical Light Radiance (Fallback) ──────────────────────────

/** Normalized light data extracted from a THREE.Scene. */
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
      lights.push({ type: 'point', color: child.color.clone(), intensity: child.intensity, position: worldPos.clone(), decay: child.decay });
      return;
    }
    if (child instanceof THREE.SpotLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({ type: 'spot', color: child.color.clone(), intensity: child.intensity, position: worldPos.clone(), direction: dir.clone(), angle: child.angle, penumbra: child.penumbra, decay: child.decay });
      return;
    }
    if (child instanceof THREE.DirectionalLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({ type: 'directional', color: child.color.clone(), intensity: child.intensity, position: worldPos.clone(), direction: dir.clone() });
      return;
    }
    if (child instanceof THREE.RectAreaLight) {
      child.getWorldQuaternion(worldQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
      lights.push({ type: 'area', color: child.color.clone(), intensity: child.intensity, position: worldPos.clone(), width: child.width, height: child.height, right: right.clone(), up: up.clone(), normal: normal.clone() });
      return;
    }
    if (child instanceof THREE.HemisphereLight) {
      lights.push({ type: 'hemisphere', color: child.color.clone(), intensity: child.intensity, position: worldPos.clone(), groundColor: child.groundColor?.clone() ?? new THREE.Color(0, 0, 0) });
      return;
    }
  });

  return lights;
}

/**
 * Generate HDRI analytically from scene lights (fallback when no environment texture exists).
 */
async function generateAnalyticalHDRI(
  scene: THREE.Scene,
  width: number,
  height: number,
  capturePoint: THREE.Vector3,
  includeEnv: boolean,
  envTexture: THREE.Texture | null,
  envIntensity: number,
  envRotation: number,
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

    if (y % 100 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return pixels;
}

// ─── Encoding: RGBE (.hdr) ───────────────────────────────────────────────────

/**
 * Encode Float32 RGBA pixel data into a Radiance RGBE .hdr file.
 *
 * Uses UNCOMPRESSED RGBE format (not RLE) for maximum compatibility.
 * Header uses `FORMAT=32-bit_rgbe` (without `_rle`) to match the data format.
 *
 * Input: RGBA Float32Array (4 floats/pixel, top-to-bottom, linear).
 * Output: Complete .hdr file as ArrayBuffer.
 */
export function encodeHDR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  // Use uncompressed format string (not rle) for compatibility
  const headerText =
    '#?RADIANCE\n' +
    'SOFTWARE=LightForge Studio\n' +
    'FORMAT=32-bit_rgbe\n' +  // uncompressed — matches our data layout
    '\n' +
    `-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(headerText);

  const pixelDataSize = width * height * 4;
  const pixelData = new Uint8Array(pixelDataSize);

  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    rgbFloatToRGBE(r, g, b, pixelData, i * 4);
  }

  const buffer = new ArrayBuffer(headerBytes.length + pixelDataSize);
  const view = new Uint8Array(buffer);
  view.set(headerBytes, 0);
  view.set(pixelData, headerBytes.length);
  return buffer;
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

  let exp = Math.floor(Math.log2(maxVal)) + 1;
  const scaled = maxVal * Math.pow(2, -exp);
  if (scaled < 0.5) {
    exp--;
  } else if (scaled >= 1.0) {
    exp++;
  }

  const scale = Math.pow(2, -exp) * 256.0;
  out[off] = Math.max(0, Math.min(255, Math.floor(r * scale)));
  out[off + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
  out[off + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
  out[off + 3] = Math.max(0, Math.min(255, exp + 128));
}

// ─── Encoding: OpenEXR (.exr) ────────────────────────────────────────────────

/**
 * Encode Float32 RGBA pixel data into an OpenEXR .exr file.
 *
 * Channels: B, G, R (alphabetical order, float32).
 * Compression: NO_COMPRESSION (0).
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
  const BYTES_PER_PIXEL = NUM_CHANNELS * 4;
  const SCANLINE_DATA_SIZE = width * BYTES_PER_PIXEL;

  const intToBytes = (val: number): number[] => [
    val & 0xff,
    (val >>> 8) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 24) & 0xff,
  ];

  const floatToBytes = (val: number): number[] => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    return [...new Uint8Array(buf)];
  };

  const writeName = (arr: number[], str: string): void => {
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) arr.push(b);
    arr.push(0);
  };

  const writeChannelEntry = (arr: number[], name: string): void => {
    const bytes = new TextEncoder().encode(name);
    for (const b of bytes) arr.push(b);
    arr.push(0);
    const nameLen = bytes.length + 1;
    const pad = (4 - (nameLen % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
    for (const v of intToBytes(PIXEL_TYPE_FLOAT)) arr.push(v);
    for (const v of intToBytes(0)) arr.push(v);
    for (const v of intToBytes(1)) arr.push(v);
    for (const v of intToBytes(1)) arr.push(v);
  };

  const writeAttrValue = (arr: number[], valueBytes: number[]): void => {
    for (const v of intToBytes(valueBytes.length)) arr.push(v);
    for (const b of valueBytes) arr.push(b);
    const pad = (4 - (valueBytes.length % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
  };

  // Build header
  const hdr: number[] = [];

  writeName(hdr, 'channels');
  writeName(hdr, 'chlist');
  const channelData: number[] = [];
  for (const chName of CHANNEL_NAMES) {
    writeChannelEntry(channelData, chName);
  }
  channelData.push(0);
  writeAttrValue(hdr, channelData);

  writeName(hdr, 'compression');
  writeName(hdr, 'compression');
  writeAttrValue(hdr, [0]);

  writeName(hdr, 'dataWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0), ...intToBytes(0),
    ...intToBytes(width - 1), ...intToBytes(height - 1),
  ]);

  writeName(hdr, 'displayWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0), ...intToBytes(0),
    ...intToBytes(width - 1), ...intToBytes(height - 1),
  ]);

  writeName(hdr, 'lineOrder');
  writeName(hdr, 'lineOrder');
  writeAttrValue(hdr, [0]);

  writeName(hdr, 'pixelAspectRatio');
  writeName(hdr, 'float');
  writeAttrValue(hdr, floatToBytes(1.0));

  writeName(hdr, 'screenWindowCenter');
  writeName(hdr, 'v2f');
  writeAttrValue(hdr, [...floatToBytes(0.0), ...floatToBytes(0.0)]);

  writeName(hdr, 'screenWindowWidth');
  writeName(hdr, 'float');
  writeAttrValue(hdr, floatToBytes(1.0));

  // End of header
  hdr.push(0);
  while (hdr.length % 8 !== 0) hdr.push(0);

  const fileHeaderSize = 8;
  const headerSize = hdr.length;
  const offsetTableSize = height * 8;
  const scanlineDataStart = fileHeaderSize + headerSize + offsetTableSize;
  const scanlineBlockSize = 4 + 4 + SCANLINE_DATA_SIZE;

  // Offset table
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(scanlineDataStart + y * scanlineBlockSize);
  }

  // Scanline pixel data
  const scanlines: number[] = [];
  for (let y = 0; y < height; y++) {
    for (const v of intToBytes(y)) scanlines.push(v);
    for (const v of intToBytes(SCANLINE_DATA_SIZE)) scanlines.push(v);
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      for (const b of floatToBytes(pixels[srcIdx + 2])) scanlines.push(b); // B
      for (const b of floatToBytes(pixels[srcIdx + 1])) scanlines.push(b); // G
      for (const b of floatToBytes(pixels[srcIdx])) scanlines.push(b);     // R
    }
  }

  // Assemble file
  const totalSize = fileHeaderSize + headerSize + offsetTableSize + scanlines.length;
  const file = new Uint8Array(totalSize);
  const dv = new DataView(file.buffer);

  dv.setUint32(0, 20000630, true);
  dv.setUint32(4, 2, true);

  file.set(new Uint8Array(hdr), 8);

  const offsetBase = fileHeaderSize + headerSize;
  for (let y = 0; y < height; y++) {
    const off = offsets[y];
    dv.setUint32(offsetBase + y * 8, off & 0xffffffff, true);
    dv.setUint32(offsetBase + y * 8 + 4, Math.floor(off / 0x100000000) & 0xffffffff, true);
  }

  file.set(new Uint8Array(scanlines), scanlineDataStart);

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