/**
 * HDRIExporter — Analytical HDRI generation for LightForge Studio.
 *
 * Generates true HDR (.hdr / .exr) equirectangular images from scene lights
 * using PURE MATHEMATICS — no CubeCamera, no proxy meshes, no WebGL rendering.
 *
 * For every pixel in the output image:
 *   1. Convert pixel position → world direction vector (equirectangular mapping)
 *   2. For each light in scene → calculate radiance mathematically from that direction
 *   3. Write the raw float value directly to pixel array
 *   4. Encode as RGBE (.hdr) or float32 (.exr)
 *
 * This is how Blender, Maya, and HDRI Light Studio generate light-studio HDRIs.
 * No CubeCamera. No proxy meshes. Pure math.
 *
 * Supported light types:
 *   - PointLight, SpotLight, DirectionalLight, RectAreaLight, HemisphereLight
 *
 * No external libraries — pure Three.js + TypeScript.
 */
import * as THREE from 'three';
import { getRawHDRIData } from '../store/hdriDataStore';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Normalized light data extracted from a THREE.Scene. */
interface ExtractedLight {
  type: 'point' | 'spot' | 'directional' | 'area' | 'hemisphere';
  color: THREE.Color;
  intensity: number;
  position: THREE.Vector3;
  /** SpotLight only */
  direction?: THREE.Vector3;
  angle?: number;
  penumbra?: number;
  decay?: number;
  /** RectAreaLight only */
  width?: number;
  height?: number;
  right?: THREE.Vector3;
  up?: THREE.Vector3;
  normal?: THREE.Vector3;
  /** HemisphereLight only */
  groundColor?: THREE.Color;
}

/** Options for the main downloadHDRI() entry point. */
export interface HDRIExportOptions {
  /** Equirectangular width: 512 | 1024 | 2048 | 4096 */
  width: 512 | 1024 | 2048 | 4096;
  /** Equirectangular height: 256 | 512 | 1024 | 2048 */
  height: 256 | 512 | 1024 | 2048;
  /** Output format */
  format: 'hdr' | 'exr';
  /** Include loaded environment texture in export */
  includeEnvironment: boolean;
  /** User-loaded environment texture (equirectangular) */
  environmentTexture: THREE.Texture | null;
  /** Environment brightness multiplier */
  environmentIntensity: number;
  /** Environment rotation in radians (around Y axis) */
  environmentRotation: number;
  /** World-space capture point (default: origin) */
  capturePoint?: THREE.Vector3;
  /** Optional filename (without extension) */
  filename?: string;
}

// ─── FUNCTION 1: pixelToDirection ────────────────────────────────────────────

/**
 * Convert an output image pixel (x, y) to a 3D world direction vector
 * using equirectangular (latitude-longitude) projection.
 *
 * @param x      - Horizontal pixel coordinate (0 = left edge).
 * @param y      - Vertical pixel coordinate (0 = top edge).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Normalized direction vector in world space.
 */
function pixelToDirection(
  x: number,
  y: number,
  width: number,
  height: number,
): THREE.Vector3 {
  const u = (x + 0.5) / width;
  const v = (y + 0.5) / height;
  const theta = u * 2 * Math.PI; // azimuth 0→2PI
  const phi = v * Math.PI;        // elevation 0→PI

  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta), // X
    Math.cos(phi),                   // Y (up)
    Math.sin(phi) * Math.cos(theta), // Z
  ).normalize();
}

// ─── FUNCTION 2: evaluateLightRadiance ───────────────────────────────────────

/**
 * For a given light and view direction, calculate the radiance arriving from
 * that direction at the capture point.
 *
 * @param light       - Extracted light data.
 * @param dir         - Normalized world direction being evaluated.
 * @param capturePoint - World-space capture position.
 * @returns Radiance color (linear, can be >> 1.0 for true HDR).
 */
function evaluateLightRadiance(
  light: ExtractedLight,
  dir: THREE.Vector3,
  capturePoint: THREE.Vector3,
): THREE.Color {
  const result = { r: 0, g: 0, b: 0 };

  switch (light.type) {
    // ── Point Light ────────────────────────────────────────────────────────
    case 'point': {
      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      toLight.normalize();

      // Treat point light as a tiny sphere (radius = 0.05)
      const angularRadius = Math.atan2(0.05, dist);
      const cosAngle = dir.dot(toLight);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

      if (angle < angularRadius) {
        const decay = light.decay ?? 2;
        const falloff = Math.pow(dist, -decay);
        const radiance = light.intensity * falloff * 500;
        result.r = light.color.r * radiance;
        result.g = light.color.g * radiance;
        result.b = light.color.b * radiance;
      }
      break;
    }

    // ── Spot Light ─────────────────────────────────────────────────────────
    case 'spot': {
      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      toLight.normalize();

      const angularRadius = Math.atan2(0.05, dist);
      const cosAngle = dir.dot(toLight);
      const angleToLight = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

      if (angleToLight < angularRadius) {
        // Check if capture point is inside the spot cone
        const toCaptureDir = new THREE.Vector3()
          .subVectors(capturePoint, light.position)
          .normalize();
        const lightDir = light.direction ?? new THREE.Vector3(0, -1, 0);
        const spotAngle = Math.acos(
          Math.max(-1, Math.min(1, toCaptureDir.dot(lightDir.normalize()))),
        );
        const halfAngle = light.angle ?? Math.PI / 4;
        const penumbra = light.penumbra ?? 0.1;

        if (spotAngle < halfAngle) {
          const t = Math.max(0, Math.min(1, (halfAngle - spotAngle) / Math.max(0.001, penumbra)));
          // Smoothstep-like falloff within penumbra
          const falloff = t * t * (3 - 2 * t);
          const decay = light.decay ?? 2;
          const distFalloff = Math.pow(dist, -decay);
          const radiance = light.intensity * distFalloff * falloff * 500;
          result.r = light.color.r * radiance;
          result.g = light.color.g * radiance;
          result.b = light.color.b * radiance;
        }
      }
      break;
    }

    // ── Directional Light (Sun) ────────────────────────────────────────────
    case 'directional': {
      const lightDir = light.direction ?? new THREE.Vector3(0, -1, 0).normalize();
      const toSun = lightDir.clone().negate().normalize();
      const sunAngRad = 0.004635; // real sun angular radius ~0.2657°
      const cosAngle = dir.dot(toSun);
      const angleToSun = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

      if (angleToSun < sunAngRad) {
        // Sun disk — extremely bright
        const radiance = light.intensity * 80000;
        result.r = light.color.r * radiance;
        result.g = light.color.g * radiance;
        result.b = light.color.b * radiance;
      } else {
        // Soft sky gradient contribution around the sun
        const skyFactor = Math.max(0, dir.y) * 0.3;
        const radiance = light.intensity * skyFactor;
        result.r = light.color.r * radiance;
        result.g = light.color.g * radiance;
        result.b = light.color.b * radiance;
      }
      break;
    }

    // ── Rect Area Light ────────────────────────────────────────────────────
    case 'area': {
      const lightNormal = light.normal ?? new THREE.Vector3(0, 0, 1);
      const facingDir = new THREE.Vector3()
        .subVectors(capturePoint, light.position)
        .normalize();

      // Only contribute if capture point faces the front of the rect
      if (facingDir.dot(lightNormal) < 0) break;

      const lightRight = light.right ?? new THREE.Vector3(1, 0, 0);
      const lightUp = light.up ?? new THREE.Vector3(0, 1, 0);
      const rectW = light.width ?? 2;
      const rectH = light.height ?? 2;
      const samples = 16;

      let accR = 0, accG = 0, accB = 0;
      let contribCount = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const su = (sx + 0.5) / samples;
          const sv = (sy + 0.5) / samples;

          // Sample point on rectangle surface
          const p = new THREE.Vector3()
            .copy(light.position)
            .addScaledVector(lightRight, (su - 0.5) * rectW)
            .addScaledVector(lightUp, (sv - 0.5) * rectH);

          const toP = new THREE.Vector3().subVectors(p, capturePoint);
          const dist = Math.max(0.01, toP.length());
          toP.normalize();

          const cosA = dir.dot(toP);
          const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));

          const srcRadius = Math.min(rectW, rectH) / 32;
          const angRadius = Math.atan2(srcRadius, dist);

          if (angle < angRadius) {
            const cosEmit = Math.max(0, toP.clone().negate().dot(lightNormal));
            const radiance = light.intensity * cosEmit * 200 / (dist * dist + 0.1);
            accR += light.color.r * radiance;
            accG += light.color.g * radiance;
            accB += light.color.b * radiance;
            contribCount++;
          }
        }
      }

      if (contribCount > 0) {
        result.r = accR / (samples * samples);
        result.g = accG / (samples * samples);
        result.b = accB / (samples * samples);
      }
      break;
    }

    // ── Hemisphere Light ───────────────────────────────────────────────────
    case 'hemisphere': {
      const t = (dir.y + 1) / 2; // 0 = ground, 1 = sky
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

// ─── FUNCTION 3: generateAnalyticalHDRI ──────────────────────────────────────

/**
 * Generate a true HDR equirectangular image analytically from scene lights.
 *
 * For every pixel in the output:
 *   1. Convert pixel → world direction (equirectangular projection)
 *   2. Sum radiance contributions from all lights
 *   3. Optionally add environment map contribution
 *   4. Write raw float values directly
 *
 * @param scene           - The THREE.Scene containing lights.
 * @param width           - Output width in pixels.
 * @param height          - Output height in pixels.
 * @param capturePoint    - World-space capture position (default: origin).
 * @param includeEnv      - Whether to include loaded environment texture.
 * @param envTexture      - User-loaded equirectangular environment texture.
 * @param envIntensity    - Environment brightness multiplier.
 * @param envRotation     - Environment rotation in radians (around Y axis).
 * @returns Float32Array of RGBA (4 floats per pixel, linear, top-to-bottom).
 */
export async function generateAnalyticalHDRI(
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

  // Extract all lights from scene
  const lights = extractLightsFromScene(scene);
  console.log('[LightForge] Found lights:', lights.length);

  // For each pixel, calculate analytical radiance
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dir = pixelToDirection(x, y, width, height);

      let r = 0, g = 0, b = 0;

      // Sum all light contributions
      for (let i = 0; i < lights.length; i++) {
        const c = evaluateLightRadiance(lights[i], dir, capturePoint);
        r += c.r;
        g += c.g;
        b += c.b;
      }

      // Add environment map contribution if provided
      if (includeEnv && envTexture) {
        const e = sampleEnvTexture(envTexture, dir, envRotation, envIntensity);
        r += e.r;
        g += e.g;
        b += e.b;
      }

      const idx = (y * width + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 1.0;
    }

    // Log progress every 100 rows
    if (y % 100 === 0) {
      const pct = Math.round((y / height) * 100);
      console.log(`[LightForge HDRI] ${pct}% complete`);
      // Yield to the event loop so the UI stays responsive
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // VERIFY — this MUST print > 1.0 for true HDR
  let maxVal = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const m = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (m > maxVal) maxVal = m;
  }
  console.log('[LightForge HDRI] Max pixel value:', maxVal);
  console.log('[LightForge HDRI] True HDR:', maxVal > 1.0);

  return pixels;
}

// ─── FUNCTION 4: extractLightsFromScene ──────────────────────────────────────

/**
 * Traverse a THREE.Scene and extract all physical lights into a
 * plain-data format suitable for analytical radiance evaluation.
 *
 * Skips objects where:
 *   - obj.userData.isLightHelper === true
 *   - obj.userData.isProxy === true
 *   - obj.userData.isGrid === true
 *   - obj.visible === false
 *
 * @param scene - The THREE.Scene to traverse.
 * @returns Array of extracted light data objects.
 */
function extractLightsFromScene(scene: THREE.Scene): ExtractedLight[] {
  const lights: ExtractedLight[] = [];
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();

  scene.traverse((child) => {
    // Skip non-lights
    if (!(child instanceof THREE.Light)) return;

    // Skip hidden / helper / proxy objects
    if (!child.visible) return;
    if (child.userData.isLightHelper === true) return;
    if (child.userData.isProxy === true) return;
    if (child.userData.isGrid === true) return;

    child.getWorldPosition(worldPos);

    // ── PointLight ─────────────────────────────────────────────────────────
    if (child instanceof THREE.PointLight) {
      lights.push({
        type: 'point',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        decay: child.decay,
      });
      return;
    }

    // ── SpotLight ──────────────────────────────────────────────────────────
    if (child instanceof THREE.SpotLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({
        type: 'spot',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        direction: dir.clone(),
        angle: child.angle,
        penumbra: child.penumbra,
        decay: child.decay,
      });
      return;
    }

    // ── DirectionalLight ───────────────────────────────────────────────────
    if (child instanceof THREE.DirectionalLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({
        type: 'directional',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        direction: dir.clone(),
      });
      return;
    }

    // ── RectAreaLight ──────────────────────────────────────────────────────
    if (child instanceof THREE.RectAreaLight) {
      child.getWorldQuaternion(worldQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
      lights.push({
        type: 'area',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        width: child.width,
        height: child.height,
        right: right.clone(),
        up: up.clone(),
        normal: normal.clone(),
      });
      return;
    }

    // ── HemisphereLight ────────────────────────────────────────────────────
    if (child instanceof THREE.HemisphereLight) {
      lights.push({
        type: 'hemisphere',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        groundColor: child.groundColor?.clone() ?? new THREE.Color(0, 0, 0),
      });
      return;
    }
  });

  return lights;
}

// ─── FUNCTION 5: sampleEnvTexture ────────────────────────────────────────────

/**
 * Sample a loaded HDRI environment texture for a given world direction.
 *
 * Applies envRotation (rotation around Y axis), converts direction to UV
 * via equirectangular projection, then bilinear-samples the texture.
 *
 * @param texture     - Equirectangular environment texture.
 * @param dir         - Normalized world direction to sample.
 * @param rotation    - Rotation in radians around Y axis.
 * @param intensity   - Brightness multiplier.
 * @returns Sampled color (linear, scaled by intensity).
 */
function sampleEnvTexture(
  texture: THREE.Texture,
  dir: THREE.Vector3,
  rotation: number,
  intensity: number,
): THREE.Color {
  // Apply Y-axis rotation to the direction
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const rx = dir.x * cosR + dir.z * sinR;
  const rz = -dir.x * sinR + dir.z * cosR;
  const ry = dir.y;

  // Convert direction to equirectangular UV
  const phi = Math.acos(Math.max(-1, Math.min(1, ry)));
  let theta = Math.atan2(rx, rz);
  if (theta < 0) theta += 2 * Math.PI;

  const u = theta / (2 * Math.PI);
  const v = 1 - phi / Math.PI;

  // Get texture image data
  const img = texture.image;
  if (!img || !('width' in img) || !('height' in img)) {
    return new THREE.Color(0, 0, 0);
  }

  const texW = img.width as number;
  const texH = img.height as number;

  let data: Uint8Array | Float32Array;
  let isFloat = false;

  if (img instanceof HTMLCanvasElement) {
    const ctx = img.getContext('2d');
    if (!ctx) return new THREE.Color(0, 0, 0);
    const imgData = ctx.getImageData(0, 0, texW, texH);
    data = imgData.data;
  } else if (img instanceof ImageData) {
    data = img.data;
  } else if (texture.isDataTexture && (img as any).data) {
    const d = (img as any).data;
    if (d instanceof Float32Array) {
      data = d;
      isFloat = true;
    } else {
      data = d;
    }
  } else {
    // Unsupported texture source
    return new THREE.Color(0, 0, 0);
  }

  // Bilinear sampling
  const px = u * texW - 0.5;
  const py = v * texH - 0.5;
  const x0 = Math.floor(px) % texW;
  const y0 = Math.floor(py) % texH;
  const x1 = (x0 + 1) % texW;
  const y1 = (y0 + 1) % texH;
  const fx = px - Math.floor(px);
  const fy = py - Math.floor(py);

  const channels = isFloat ? 4 : 4; // both RGBA
  const getPixel = (xi: number, yi: number): [number, number, number] => {
    const idx = (yi * texW + xi) * channels;
    if (idx < 0 || idx + 2 >= data.length) return [0, 0, 0];
    if (isFloat) {
      const f = data as Float32Array;
      return [f[idx], f[idx + 1], f[idx + 2]];
    }
    // Uint8 — convert from sRGB to linear
    return [
      sRGBToLinear((data[idx] ?? 0) / 255),
      sRGBToLinear((data[idx + 1] ?? 0) / 255),
      sRGBToLinear((data[idx + 2] ?? 0) / 255),
    ];
  };

  const c00 = getPixel(x0, y0);
  const c10 = getPixel(x1, y0);
  const c01 = getPixel(x0, y1);
  const c11 = getPixel(x1, y1);

  const r = (c00[0] * (1 - fx) * (1 - fy) + c10[0] * fx * (1 - fy) +
             c01[0] * (1 - fx) * fy + c11[0] * fx * fy) * intensity;
  const g = (c00[1] * (1 - fx) * (1 - fy) + c10[1] * fx * (1 - fy) +
             c01[1] * (1 - fx) * fy + c11[1] * fx * fy) * intensity;
  const b = (c00[2] * (1 - fx) * (1 - fy) + c10[2] * fx * (1 - fy) +
             c01[2] * (1 - fx) * fy + c11[2] * fx * fy) * intensity;

  return new THREE.Color(r, g, b);
}

/**
 * Convert sRGB gamma value to linear.
 */
function sRGBToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

// ─── FUNCTION 6: encodeHDR — Radiance RGBE ───────────────────────────────────

/**
 * Encode HDR pixel data into a Radiance RGBE .hdr file (ArrayBuffer).
 *
 * Uses uncompressed (flat) RGBE encoding for maximum compatibility.
 * Input is RGBA Float32Array (4 floats per pixel, top-to-bottom, linear).
 *
 * @param pixels - Float32Array of RGBA (4 floats/pixel, linear).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .hdr file as ArrayBuffer.
 */
export function encodeHDR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  const headerText =
    '#?RADIANCE\n' +
    'SOFTWARE=LightForge Studio\n' +
    'FORMAT=32-bit_rle_rgbe\n' +
    'EXPOSURE=1.0\n' +
    `\n-Y ${height} +X ${width}\n`;
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
 *
 * RGBE encoding with shared exponent:
 *   maxVal = max(r, g, b)
 *   if maxVal < 1e-32: output [0,0,0,0]
 *   else:
 *     exp = floor(log2(maxVal)) + 1
 *     correction pass: adjust if needed
 *     scale = 2^(-exp) * 256
 *     R/G/B = clamp(floor(component * scale), 0, 255)
 *     E = clamp(exp + 128, 0, 255)
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

  // Correction pass: ensure mantissa is in [0.5, 1.0)
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

// ─── FUNCTION 7: encodeEXR — OpenEXR ────────────────────────────────────────

/**
 * Encode HDR pixel data into an OpenEXR .exr file (ArrayBuffer).
 *
 * Channels: B, G, R (alphabetical, float32) — standard HDRI EXR convention.
 * Compression: NO_COMPRESSION (0).
 * Alpha is set to 1.0 for all pixels.
 *
 * Input is RGBA Float32Array (4 floats per pixel, top-to-bottom, linear).
 * The alpha channel in the input is ignored; alpha in EXR is always 1.0.
 *
 * @param pixels - Float32Array of RGBA (4 floats/pixel, linear).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .exr file as ArrayBuffer.
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

  // ── Low-level write helpers ──────────────────────────────────────────────
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
    arr.push(0); // null terminator
    // Pad name to 4-byte boundary (including null)
    const nameLen = bytes.length + 1;
    const pad = (4 - (nameLen % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
    // Channel properties (16 bytes): pixel_type(i32) + pLinear(u32) + x_sampling(u32) + y_sampling(u32)
    for (const v of intToBytes(PIXEL_TYPE_FLOAT)) arr.push(v);
    for (const v of intToBytes(0)) arr.push(v);            // pLinear
    for (const v of intToBytes(1)) arr.push(v);            // x sampling
    for (const v of intToBytes(1)) arr.push(v);            // y sampling
  };

  const writeAttrValue = (arr: number[], valueBytes: number[]): void => {
    for (const v of intToBytes(valueBytes.length)) arr.push(v);
    for (const b of valueBytes) arr.push(b);
    const pad = (4 - (valueBytes.length % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
  };

  // ── Build header attributes ──────────────────────────────────────────────
  const hdr: number[] = [];

  // 1) channels (chlist): 3 entries × 20 bytes + 1 terminator byte = 61 bytes
  writeName(hdr, 'channels');
  writeName(hdr, 'chlist');
  const channelData: number[] = [];
  for (const chName of CHANNEL_NAMES) {
    writeChannelEntry(channelData, chName);
  }
  channelData.push(0); // channel list terminator
  writeAttrValue(hdr, channelData);

  // 2) compression: 1 byte (0 = NO_COMPRESSION)
  writeName(hdr, 'compression');
  writeName(hdr, 'compression');
  writeAttrValue(hdr, [0]);

  // 3) dataWindow (box2i): 4 × int32 = 16 bytes
  writeName(hdr, 'dataWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0),
    ...intToBytes(0),
    ...intToBytes(width - 1),
    ...intToBytes(height - 1),
  ]);

  // 4) displayWindow (box2i): 4 × int32 = 16 bytes
  writeName(hdr, 'displayWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0),
    ...intToBytes(0),
    ...intToBytes(width - 1),
    ...intToBytes(height - 1),
  ]);

  // 5) lineOrder: 1 byte (0 = INCREASING_Y)
  writeName(hdr, 'lineOrder');
  writeName(hdr, 'lineOrder');
  writeAttrValue(hdr, [0]);

  // 6) pixelAspectRatio (float): 4 bytes
  writeName(hdr, 'pixelAspectRatio');
  writeName(hdr, 'float');
  writeAttrValue(hdr, floatToBytes(1.0));

  // 7) screenWindowCenter (v2f): 8 bytes
  writeName(hdr, 'screenWindowCenter');
  writeName(hdr, 'v2f');
  writeAttrValue(hdr, [...floatToBytes(0.0), ...floatToBytes(0.0)]);

  // 8) screenWindowWidth (float): 4 bytes
  writeName(hdr, 'screenWindowWidth');
  writeName(hdr, 'float');
  writeAttrValue(hdr, floatToBytes(1.0));

  // End of header: empty name (single null byte), then pad to 8-byte boundary
  hdr.push(0);
  while (hdr.length % 8 !== 0) hdr.push(0);

  const fileHeaderSize = 8; // magic(4) + version(4)
  const headerSize = hdr.length;
  const offsetTableSize = height * 8;
  const scanlineDataStart = fileHeaderSize + headerSize + offsetTableSize;
  const scanlineBlockSize = 4 + 4 + SCANLINE_DATA_SIZE;

  // ── Offset table ────────────────────────────────────────────────────────
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(scanlineDataStart + y * scanlineBlockSize);
  }

  // ── Scanline pixel data ─────────────────────────────────────────────────
  // Each scanline: [y_coord (u32)] [data_size (u32)] [B(u32) G(u32) R(u32) per pixel]
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

  // ── Assemble file ───────────────────────────────────────────────────────
  const totalSize = fileHeaderSize + headerSize + offsetTableSize + scanlines.length;
  const file = new Uint8Array(totalSize);
  const dv = new DataView(file.buffer);

  // Magic number: 0x762F3101 (20000630 decimal)
  dv.setUint32(0, 20000630, true);
  // Version: 2
  dv.setUint32(4, 2, true);

  file.set(new Uint8Array(hdr), 8);

  // Offset table
  const offsetBase = fileHeaderSize + headerSize;
  for (let y = 0; y < height; y++) {
    const off = offsets[y];
    dv.setUint32(offsetBase + y * 8, off & 0xffffffff, true);
    dv.setUint32(offsetBase + y * 8 + 4, Math.floor(off / 0x100000000) & 0xffffffff, true);
  }

  // Scanline data
  file.set(new Uint8Array(scanlines), scanlineDataStart);

  return file.buffer;
}

// ─── FUNCTION 8: downloadHDRI ───────────────────────────────────────────────

/**
 * Generate and download a true HDR equirectangular image from scene lights.
 *
 * This is the main entry point for HDRI export. It analytically computes
 * radiance for every pixel (no CubeCamera, no WebGL rendering), then
 * encodes and downloads the result as .hdr or .exr.
 *
 * @param scene   - The THREE.Scene containing lights to export.
 * @param options - Export configuration (resolution, format, env settings).
 */
export async function downloadHDRI(
  scene: THREE.Scene,
  options: HDRIExportOptions,
): Promise<void> {
  const {
    width,
    height,
    format,
    includeEnvironment,
    environmentTexture,
    environmentIntensity,
    environmentRotation,
    capturePoint,
    filename,
  } = options;

  const cp = capturePoint ?? new THREE.Vector3(0, 0, 0);

  console.log(`[LightForge HDRI] Generating ${width}x${height} ${format.toUpperCase()} analytically...`);

  const pixels = await generateAnalyticalHDRI(
    scene,
    width,
    height,
    cp,
    includeEnvironment,
    environmentTexture,
    environmentIntensity,
    environmentRotation,
  );

  const baseName = filename ?? `lightforge_hdri_${Date.now()}`;
  const ext = format === 'hdr' ? '.hdr' : '.exr';
  const mimeType = format === 'hdr' ? 'image/vnd.radiance' : 'image/x-exr';

  const buffer: ArrayBuffer =
    format === 'hdr'
      ? encodeHDR(pixels, width, height)
      : encodeEXR(pixels, width, height);

  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}${ext}`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (link.parentNode) link.parentNode.removeChild(link);
  }, 250);

  console.log(`[LightForge HDRI] Export complete: ${baseName}${ext}`);
}

// ─── Environment texture loader (for custom .hdr) ───────────────────────────

/**
 * Load a raw .hdr ArrayBuffer into a THREE.DataTexture via RGBELoader.
 * Used to prepare the environment texture for analytical sampling.
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

// ─── Convenience wrappers (backward-compatible with TopMenubar) ──────────────

/**
 * Export the scene as a Radiance .hdr file using analytical generation.
 *
 * @deprecated Use downloadHDRI() directly for more control over options.
 * @param renderer - WebGL renderer (unused in analytical mode, kept for API compat).
 * @param scene    - The THREE.Scene containing lights.
 * @param options  - Export size and optional filename.
 */
export async function exportSceneAsHDR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const height = Math.floor(resolution / 2);

  // Try to load custom HDRI if available
  let envTexture: THREE.Texture | null = null;
  const rawBuffer = getRawHDRIData();
  if (rawBuffer) {
    try {
      envTexture = await loadHDRITexture(rawBuffer);
    } catch {
      // Fall back to no environment
    }
  }

  await downloadHDRI(scene, {
    width: resolution as 512 | 1024 | 2048 | 4096,
    height: height as 256 | 512 | 1024 | 2048,
    format: 'hdr',
    includeEnvironment: !!envTexture,
    environmentTexture: envTexture,
    environmentIntensity: 1.0,
    environmentRotation: 0,
    filename: options?.filename,
  });
}

/**
 * Export the scene as an OpenEXR .exr file using analytical generation.
 *
 * @deprecated Use downloadHDRI() directly for more control over options.
 * @param renderer - WebGL renderer (unused in analytical mode, kept for API compat).
 * @param scene    - The THREE.Scene containing lights.
 * @param options  - Export size and optional filename.
 */
export async function exportSceneAsEXR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const height = Math.floor(resolution / 2);

  // Try to load custom HDRI if available
  let envTexture: THREE.Texture | null = null;
  const rawBuffer = getRawHDRIData();
  if (rawBuffer) {
    try {
      envTexture = await loadHDRITexture(rawBuffer);
    } catch {
      // Fall back to no environment
    }
  }

  await downloadHDRI(scene, {
    width: resolution as 512 | 1024 | 2048 | 4096,
    height: height as 256 | 512 | 1024 | 2048,
    format: 'exr',
    includeEnvironment: !!envTexture,
    environmentTexture: envTexture,
    environmentIntensity: 1.0,
    environmentRotation: 0,
    filename: options?.filename,
  });
}