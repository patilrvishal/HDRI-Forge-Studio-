/**
 * HDRIExporter — Captures the full 360° scene lighting as a standard equirectangular
 * HDRI (.hdr) or EXR (.exr) file suitable for IBL in Blender, Photoshop, HDRView,
 * or any HDR-capable application.
 *
 * The export combines:
 *   - The scene's current environment (built-in presets re-created as emissive panels,
 *     or custom .hdr files re-loaded from stored binary data)
 *   - ALL physical lights (PointLight, SpotLight, RectAreaLight, DirectionalLight)
 *     represented as bright emissive proxy meshes with HDR color values
 *
 * Process:
 *   1. Build a dedicated capture scene with environment panels + light proxies
 *   2. Render 6 cube faces via CubeCamera (HalfFloatType for Windows/Chrome compat)
 *   3. Project cubemap → equirectangular via custom ShaderMaterial
 *   4. Read back Uint16Array (half-float), convert to Float32Array with Y-flip
 *   5. Encode as Radiance RGBE (.hdr) or OpenEXR (.exr)
 *
 * No external libraries — pure Three.js r165 + TypeScript.
 */
import * as THREE from 'three';
import { getHDRIPresetById } from '../types/Environment';
import type { HDRIPreset, EnvPanel } from '../types/Environment';
import { getRawHDRIData } from '../store/hdriDataStore';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ─── IEEE 754 half-float ↔ float32 ──────────────────────────────────────────────

/**
 * Convert a 16-bit IEEE 754 half-float to a 32-bit JavaScript number.
 * Handles signed zero, denormalized, normal, infinity, and NaN.
 */
export function halfToFloat(half: number): number {
  const sign = (half >>> 15) & 0x1;
  const exponent = (half >>> 10) & 0x1f;
  const mantissa = half & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) return sign === 0 ? 0 : -0;
    const result = Math.pow(2, -14) * (mantissa / 1024);
    return sign === 0 ? result : -result;
  }
  if (exponent === 31) {
    if (mantissa === 0) return sign === 0 ? Infinity : -Infinity;
    return NaN;
  }
  const result = Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
  return sign === 0 ? result : -result;
}

/** Convert a 32-bit float to 16-bit half-float (for EXR HALF encoding). */
function floatToHalf(value: number): number {
  const buf = new ArrayBuffer(4);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const absX = x & 0x7fffffff;
  if (absX > 0x477fe000) return sign | 0x7c00;
  if (absX < 0x33000000) return sign;
  if (absX < 0x38800000) {
    const shift = 125 - ((absX >>> 23) & 0xff);
    return sign | (((absX & 0x7fffff) | 0x800000) >>> shift);
  }
  const exponent = ((absX >>> 23) & 0xff) - 127 + 15;
  const mantissa = (absX >>> 13) & 0x3ff;
  return sign | (exponent << 10) | mantissa;
}

// ─── Scene capture ─────────────────────────────────────────────────────────────

/**
 * Captures the full 360° scene lighting (environment + all physical lights)
 * into an equirectangular Float32Array (RGB, linear, top-to-bottom).
 *
 * Environment capture strategy:
 *   - Built-in presets: Re-creates the original emissive panels from preset data.
 *     These ARE the light sources that produce the environment lighting, so
 *     capturing them directly gives the most accurate HDRI representation.
 *   - Custom .hdr files: Re-loads the raw HDR binary data (stored in hdriDataStore),
 *     creates an equirect DataTexture, and sets it as scene.background so the
 *     CubeCamera renders it as the visible sky dome.
 *
 * Light proxy strategy:
 *   Each THREE.Light (Point, Spot, Area, Directional) gets an emissive proxy mesh
 *   with HDR-bright color values. The proxy brightness is scaled so that even
 *   default-intensity lights (intensity≈1) produce values well above 1.0 in the
 *   HDRI, ensuring the exposure slider in Photoshop/Blender reveals the light sources.
 */
export async function captureSceneToHDRI(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  resolution: number,
): Promise<Float32Array> {
  // ── Save renderer state ──────────────────────────────────────────────────
  const savedToneMapping = renderer.toneMapping;
  const savedToneMappingExposure = renderer.toneMappingExposure;
  const savedOutputColorSpace = renderer.outputColorSpace;

  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // ── Build a dedicated capture scene ──────────────────────────────────────
  const captureScene = new THREE.Scene();
  const disposables: { geometry?: THREE.BufferGeometry; material?: THREE.Material; texture?: THREE.Texture }[] = [];

  // Track any Object URL created for custom HDRI (for cleanup)
  let customHDRIObjURL: string | null = null;

  try {
    // ── 1) Environment: re-create the light sources that produce it ────────
    await addEnvironmentToCaptureScene(captureScene, renderer, disposables);

    // ── 2) Emissive proxies for every physical light in the scene ─────────
    addLightProxies(scene, captureScene, disposables);

    // ── 3) Capture cubemap at scene center (0, 0, 0) ────────────────────
    const cubeSize = Math.max(512, resolution);
    const cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const cubeCamera = new THREE.CubeCamera(0.01, 200, cubeRT);
    cubeCamera.position.set(0, 0, 0);
    cubeCamera.update(renderer, captureScene);

    // ── 4) Cubemap → Equirectangular projection ────────────────────────────
    const eqWidth = resolution;
    const eqHeight = Math.floor(resolution / 2);

    const eqRT = new THREE.WebGLRenderTarget(eqWidth, eqHeight, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });

    const equirectMaterial = new THREE.ShaderMaterial({
      uniforms: {
        envMap: { value: cubeRT.texture },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform samplerCube envMap;
        varying vec2 vUv;
        #define PI 3.14159265359
        #define TWO_PI 6.28318530718
        void main() {
          float phi = (1.0 - vUv.y) * PI;
          float theta = vUv.x * TWO_PI;
          vec3 dir = vec3(
            sin(phi) * cos(theta),
            cos(phi),
            sin(phi) * sin(theta)
          );
          gl_FragColor = textureCube(envMap, dir);
        }
      `,
      depthWrite: false,
      depthTest: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), equirectMaterial);
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderScene = new THREE.Scene();
    renderScene.add(quad);

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(eqRT);
    renderer.render(renderScene, orthoCamera);
    renderer.setRenderTarget(prevRT);

    // ── 5) Read pixels as Uint16Array (half-float) ────────────────────────
    const halfPixels = new Uint16Array(eqWidth * eqHeight * 4);
    renderer.readRenderTargetPixels(eqRT, 0, 0, eqWidth, eqHeight, halfPixels);

    // ── 6) Convert half → float32 with Y-axis flip ────────────────────────
    const floatPixels = new Float32Array(eqWidth * eqHeight * 3);
    for (let row = 0; row < eqHeight; row++) {
      const srcRow = eqHeight - 1 - row;
      for (let col = 0; col < eqWidth; col++) {
        const srcIdx = (srcRow * eqWidth + col) * 4;
        const dstIdx = (row * eqWidth + col) * 3;
        floatPixels[dstIdx]     = halfToFloat(halfPixels[srcIdx]);
        floatPixels[dstIdx + 1] = halfToFloat(halfPixels[srcIdx + 1]);
        floatPixels[dstIdx + 2] = halfToFloat(halfPixels[srcIdx + 2]);
      }
    }

    // ── Cleanup GPU resources ──────────────────────────────────────────────
    quad.geometry.dispose();
    equirectMaterial.dispose();
    eqRT.dispose();
    cubeRT.dispose();

    return floatPixels;

  } finally {
    // ── Restore renderer state ─────────────────────────────────────────────
    renderer.toneMapping = savedToneMapping;
    renderer.toneMappingExposure = savedToneMappingExposure;
    renderer.outputColorSpace = savedOutputColorSpace;

    // ── Dispose all temporary resources ────────────────────────────────────
    for (const item of disposables) {
      item.geometry?.dispose();
      item.material?.dispose();
      item.texture?.dispose();
    }
    if (customHDRIObjURL) {
      URL.revokeObjectURL(customHDRIObjURL);
    }
  }
}

// ─── Environment capture helpers ────────────────────────────────────────────────

/**
 * Adds the environment light sources to the capture scene.
 *
 * For built-in presets: Re-creates the emissive panels that define the environment.
 * For custom .hdr: Re-loads the raw file and sets it as scene.background.
 * For 'none': No environment added.
 */
async function addEnvironmentToCaptureScene(
  captureScene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  disposables: { geometry?: THREE.BufferGeometry; material?: THREE.Material; texture?: THREE.Texture }[],
): Promise<void> {
  // Lazy imports to avoid circular dependencies at module level
  const { useSceneStore } = await import('../store/sceneStore');
  const envState = useSceneStore.getState().environment;

  // Handle environment rotation
  const rotationDeg = envState.rotation ?? 0;

  if (envState.presetId === 'none') {
    // No environment — dark background only
    captureScene.background = new THREE.Color(0x000000);
    return;
  }

  if (envState.presetId === '__custom__') {
    // Custom .hdr file: re-load from stored binary data
    const rawBuffer = getRawHDRIData();
    if (rawBuffer) {
      try {
        const texture = await loadHDRITexture(rawBuffer);
        if (texture) {
          // Use as scene.background — the CubeCamera renders this as the sky dome
          texture.mapping = THREE.EquirectangularReflectionMapping;
          captureScene.background = texture;
          disposables.push({ texture });
        }
      } catch {
        // Fallback: dark background if custom HDR can't be re-loaded
        captureScene.background = new THREE.Color(0x000000);
      }
    } else {
      captureScene.background = new THREE.Color(0x000000);
    }
    return;
  }

  // Built-in preset: re-create the emissive panels
  const preset = getHDRIPresetById(envState.presetId);
  if (!preset) {
    captureScene.background = new THREE.Color(0x000000);
    return;
  }

  // Add each emissive panel from the preset
  // HDR_BOOST: environment panel intensities (0.3–1.2) are designed for PMREM PBR rendering,
  // not for direct HDRI export. Multiply by 30 so panels produce values of 9–36 in linear
  // HDR space — bright enough that exposure adjustment in Photoshop/Blender reveals them
  // as distinct light sources while the black (0.0) background stays black.
  const HDR_BOOST = 30;
  for (const panel of preset.panels) {
    const color = new THREE.Color(panel.color);
    color.multiplyScalar(panel.intensity * HDR_BOOST);
    const geo = new THREE.PlaneGeometry(panel.size[0], panel.size[1]);
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
    if (panel.rotationX !== undefined) mesh.rotation.x = panel.rotationX;
    if (panel.rotationY !== undefined) mesh.rotation.y = panel.rotationY;
    captureScene.add(mesh);
    disposables.push({ geometry: geo, material: mat });
  }

  // Apply rotation to the entire environment (same as EnvironmentLoader does)
  if (rotationDeg !== 0) {
    captureScene.rotation.y = (rotationDeg * Math.PI) / 180;
  }

  // Pure black background — critical for proper HDRI dynamic range.
  // backgroundHint is only for the viewport UI, NOT for HDRI data.
  // Any non-zero floor (e.g. '#2a2a3e' ≈ 0.16) would cause the entire image
  // to shift when adjusting exposure in Photoshop/Blender, instead of only
  // the light source pixels responding. With 0.0 background, 0×exposure = 0
  // (dark stays dark) while light panels (values 9–36) respond to exposure.
  captureScene.background = new THREE.Color(0x000000);
}

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

// ─── Light proxy creation ───────────────────────────────────────────────────────

/**
 * Traverses the main scene, finds all physical lights, and creates bright
 * emissive proxy meshes in the capture scene for each one.
 *
 * Proxy brightness strategy:
 *   Light intensity in Three.js r165 (physically correct) is in real-world units
 *   (candela, lux, nits). For HDRI purposes, we need the proxy to produce values
 *   well above 1.0 so the light source is clearly visible as an HDR hotspot.
 *
 *   Mapping: proxyColor = baseColor * max(20, intensity * 50)
 *   - intensity 0.1  → color value ~20.0  (minimum HDR)
 *   - intensity 1.0  → color value ~50.0  (clearly HDR, responds to exposure)
 *   - intensity 5.0  → color value ~250.0 (very bright)
 *   - intensity 50.0 → color value ~1000.0 (capped)
 *
 *   Cap at 1000 to avoid numerical issues in the HalfFloat render target.
 *   With a pure black (0.0) background, these values create proper dynamic range
 *   so exposure adjustment in Photoshop/Blender only affects light source pixels.
 */
function addLightProxies(
  mainScene: THREE.Scene,
  captureScene: THREE.Scene,
  disposables: { geometry?: THREE.BufferGeometry; material?: THREE.Material; texture?: THREE.Texture }[],
): void {
  mainScene.traverse((child) => {
    if (!(child instanceof THREE.Light)) return;

    // Skip ambient/hemisphere — they are omnidirectional with no clear position
    if (child instanceof THREE.AmbientLight || child instanceof THREE.HemisphereLight) {
      return;
    }

    const light = child;
    const intensity = light.intensity ?? 1;
    if (intensity <= 0) return;

    const baseColor = light.color ? light.color.clone() : new THREE.Color(1, 1, 1);

    // Scale to HDR range: ensure even dim lights produce values well above 1.0
    const hdrBrightness = Math.min(1000, Math.max(20, intensity * 50));
    const emissiveColor = baseColor.clone().multiplyScalar(hdrBrightness);

    let proxy: THREE.Mesh | null = null;

    if (light instanceof THREE.DirectionalLight) {
      // DirectionalLight → large emissive plane far away in the light's direction
      const dir = new THREE.Vector3();
      light.getWorldDirection(dir);
      const planeSize = 40;
      const geo = new THREE.PlaneGeometry(planeSize, planeSize);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        side: THREE.DoubleSide,
      });
      proxy = new THREE.Mesh(geo, mat);
      const pos = dir.clone().multiplyScalar(48);
      proxy.position.copy(pos);
      proxy.lookAt(0, 0, 0);

    } else if (light instanceof THREE.SpotLight) {
      // SpotLight → emissive disc at the light's position, facing its direction
      const pos = new THREE.Vector3();
      light.getWorldPosition(pos);
      const dir = new THREE.Vector3();
      light.getWorldDirection(dir);
      const angle = light.angle ?? Math.PI / 6;
      const discRadius = Math.max(0.5, Math.tan(angle) * 4);
      const geo = new THREE.CircleGeometry(discRadius, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        side: THREE.DoubleSide,
      });
      proxy = new THREE.Mesh(geo, mat);
      proxy.position.copy(pos);
      proxy.lookAt(pos.clone().add(dir));

    } else if (light instanceof THREE.RectAreaLight) {
      // RectAreaLight → emissive rectangle matching the light's dimensions
      const pos = new THREE.Vector3();
      light.getWorldPosition(pos);
      const w = light.width ?? 2;
      const h = light.height ?? 2;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        side: THREE.DoubleSide,
      });
      proxy = new THREE.Mesh(geo, mat);
      proxy.position.copy(pos);
      proxy.quaternion.copy(light.quaternion);

    } else {
      // PointLight (and IES, which is mapped to PointLight)
      // → bright emissive sphere at the light's world position
      const pos = new THREE.Vector3();
      light.getWorldPosition(pos);
      const radius = Math.max(0.3, Math.min(2.0, hdrBrightness * 0.003));
      const geo = new THREE.SphereGeometry(radius, 16, 12);
      const mat = new THREE.MeshBasicMaterial({ color: emissiveColor });
      proxy = new THREE.Mesh(geo, mat);
      proxy.position.copy(pos);
    }

    if (proxy) {
      captureScene.add(proxy);
      disposables.push({ geometry: proxy.geometry, material: proxy.material as THREE.Material });
    }
  });
}

// ─── Radiance HDR (RGBE) Encoding ──────────────────────────────────────────────

/**
 * Encode HDR pixel data into a Radiance RGBE .hdr file (ArrayBuffer).
 *
 * Uses uncompressed (flat) RGBE encoding for maximum compatibility.
 *
 * @param pixels - Float32Array of RGB (3 floats/pixel, top-to-bottom, linear).
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
    'FORMAT=32-bit_rle_rgbe\n' +
    'EXPOSURE=1.0\n' +
    `\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(headerText);

  const pixelDataSize = width * height * 4;
  const pixelData = new Uint8Array(pixelDataSize);

  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 3];
    const g = pixels[i * 3 + 1];
    const b = pixels[i * 3 + 2];
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
 *     exp = ceil(log2(maxVal))
 *     if 2^exp <= maxVal: exp++
 *     scale = 2^(-exp) * 256
 *     R = clamp(floor(r * scale), 0, 255)
 *     G = clamp(floor(g * scale), 0, 255)
 *     B = clamp(floor(b * scale), 0, 255)
 *     E = exp + 128
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

  let exp = Math.ceil(Math.log2(maxVal));
  if (Math.pow(2, exp) < maxVal) exp++;
  if (Math.pow(2, exp) < maxVal) exp++;

  const scale = Math.pow(2, -exp) * 256.0;
  out[off]     = Math.max(0, Math.min(255, Math.floor(r * scale)));
  out[off + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
  out[off + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
  out[off + 3] = Math.max(0, Math.min(255, exp + 128));
}

// ─── OpenEXR Encoding ──────────────────────────────────────────────────────────

/**
 * Encode HDR pixel data into an OpenEXR .exr file (ArrayBuffer).
 *
 * Channels: A, B, G, R as FLOAT (32-bit) — matches standard HDRI EXR convention
 * (alphabetical channel order with alpha). Compression: NONE.
 * Alpha is set to 1.0 (fully opaque) for all pixels.
 *
 * OpenEXR header format per attribute:
 *   name\0  type\0  size(u32LE)  value(size bytes, padded to 4-byte boundary)
 *
 * @param pixels - Float32Array of RGB (3 floats/pixel, top-to-bottom, linear).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .exr file as ArrayBuffer.
 */
export function encodeEXR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  const CHANNEL_NAMES = ['A', 'B', 'G', 'R'] as const;
  const PIXEL_TYPE_FLOAT = 2;
  const CHANNEL_BYTES = 4;
  const NUM_CHANNELS = 4; // A, B, G, R
  const BYTES_PER_PIXEL = NUM_CHANNELS * CHANNEL_BYTES;
  const SCANLINE_DATA_SIZE = width * BYTES_PER_PIXEL;

  // ── Low-level write helpers ──────────────────────────────────────────────
  const writeU32LE = (arr: number[], val: number): void => {
    arr.push(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff);
  };
  const writeI32LE = (arr: number[], val: number): void => writeU32LE(arr, val >>> 0);
  const writeF32LE = (arr: number[], val: number): void => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    const bytes = new Uint8Array(buf);
    arr.push(bytes[0], bytes[1], bytes[2], bytes[3]);
  };

  /** Convert a 32-bit integer to 4 bytes (little-endian). */
  const intToBytes = (val: number): number[] => [
    val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff,
  ];

  /** Convert a 32-bit float to 4 bytes (little-endian). */
  const floatToBytes = (val: number): number[] => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    return [...new Uint8Array(buf)];
  };

  /** Write a null-terminated string (for attribute names and type names). */
  const writeName = (arr: number[], str: string): void => {
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) arr.push(b);
    arr.push(0);
  };

  /**
   * Write a channel-list entry: name\0 + padding to 4-byte boundary,
   * then pixel_type(i32) + pLinear(u32) + x_sampling(u32) + y_sampling(u32).
   * Each entry is exactly 4 + 16 = 20 bytes.
   */
  const writeChannelEntry = (arr: number[], name: string): void => {
    const bytes = new TextEncoder().encode(name);
    for (const b of bytes) arr.push(b);
    arr.push(0); // null terminator
    // Pad name to 4-byte boundary (including null)
    const nameLen = bytes.length + 1;
    const pad = (4 - (nameLen % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
    // Channel properties (16 bytes)
    writeI32LE(arr, PIXEL_TYPE_FLOAT); // pixel type
    writeU32LE(arr, 0);                // pLinear = false
    writeU32LE(arr, 1);                // x sampling
    writeU32LE(arr, 1);                // y sampling
  };

  /**
   * Write an attribute value with proper size field and 4-byte padding.
   * Format: size(u32LE) + value_bytes + padding_to_4_byte_boundary
   */
  const writeAttrValue = (arr: number[], valueBytes: number[]): void => {
    writeU32LE(arr, valueBytes.length); // size field
    for (const b of valueBytes) arr.push(b);
    // Pad value to 4-byte boundary
    const pad = (4 - (valueBytes.length % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
  };

  // ── Build header attributes ──────────────────────────────────────────────
  const hdr: number[] = [];

  // 1) channels (chlist): 4 entries × 20 bytes + 1 terminator byte = 81 bytes
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
    ...intToBytes(0), ...intToBytes(0),
    ...intToBytes(width - 1), ...intToBytes(height - 1),
  ]);

  // 4) displayWindow (box2i): 4 × int32 = 16 bytes
  writeName(hdr, 'displayWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0), ...intToBytes(0),
    ...intToBytes(width - 1), ...intToBytes(height - 1),
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

  const headerSize = hdr.length;
  const fileHeaderSize = 8;
  const offsetTableSize = height * 8;
  const scanlineDataStart = fileHeaderSize + headerSize + offsetTableSize;
  const scanlineBlockSize = 4 + 4 + SCANLINE_DATA_SIZE;

  // ── Offset table ────────────────────────────────────────────────────────
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(scanlineDataStart + y * scanlineBlockSize);
  }

  // ── Scanline pixel data ─────────────────────────────────────────────────
  // Each scanline: [y_coord (u32)] [data_size (u32)] [A(u32) B(u32) G(u32) R(u32) per pixel]
  const scanlines: number[] = [];
  for (let y = 0; y < height; y++) {
    writeU32LE(scanlines, y);
    writeU32LE(scanlines, SCANLINE_DATA_SIZE);
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      writeF32LE(scanlines, 1.0);              // A = 1.0 (fully opaque)
      writeF32LE(scanlines, pixels[srcIdx + 2]); // B
      writeF32LE(scanlines, pixels[srcIdx + 1]); // G
      writeF32LE(scanlines, pixels[srcIdx]);     // R
    }
  }

  // ── Assemble file ───────────────────────────────────────────────────────
  const totalSize = fileHeaderSize + headerSize + offsetTableSize + scanlines.length;
  const file = new Uint8Array(totalSize);
  const dv = new DataView(file.buffer);

  dv.setUint32(0, 20000630, true);
  dv.setUint32(4, 2, true);

  file.set(new Uint8Array(hdr), 8);

  const offsetBase = 8 + headerSize;
  for (let y = 0; y < height; y++) {
    const off = offsets[y];
    dv.setUint32(offsetBase + y * 8, off & 0xffffffff, true);
    dv.setUint32(offsetBase + y * 8 + 4, Math.floor(off / 0x100000000) & 0xffffffff, true);
  }

  file.set(new Uint8Array(scanlines), scanlineDataStart);

  return file.buffer;
}

// ─── Download helper ───────────────────────────────────────────────────────────

/**
 * Download HDR pixel data as a .hdr or .exr file.
 */
export function downloadHDRI(
  pixels: Float32Array,
  width: number,
  height: number,
  format: 'hdr' | 'exr',
  filename?: string,
): void {
  const baseName = filename ?? `hdri_export_${Date.now()}`;
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
}

// ─── Convenience wrappers (backward-compatible) ────────────────────────────────

/** @deprecated Use captureSceneToHDRI() + downloadHDRI() for more control. */
export async function exportSceneAsHDR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const height = Math.floor(resolution / 2);
  const pixels = await captureSceneToHDRI(renderer, scene, resolution);
  downloadHDRI(pixels, resolution, height, 'hdr', options?.filename);
}

/** @deprecated Use captureSceneToHDRI() + downloadHDRI() for more control. */
export async function exportSceneAsEXR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const height = Math.floor(resolution / 2);
  const pixels = await captureSceneToHDRI(renderer, scene, resolution);
  downloadHDRI(pixels, resolution, height, 'exr', options?.filename);
}