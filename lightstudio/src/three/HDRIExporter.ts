/**
 * HDRIExporter — Captures the full 360° scene lighting as a standard equirectangular
 * HDRI (.hdr) or EXR (.exr) file suitable for IBL in Blender, Photoshop, HDRView,
 * or any HDR-capable application.
 *
 * The export combines:
 *   - The scene's current environment map (built-in HDRI presets or custom .hdr files)
 *   - ALL physical lights (PointLight, SpotLight, RectAreaLight, DirectionalLight, etc.)
 *
 * Process:
 *   1. Build a clean capture scene: environment sphere + light helpers + emissive proxies
 *   2. Render 6 cube faces via CubeCamera (HalfFloatType for Windows/Chrome compat)
 *   3. Project cubemap → equirectangular via custom ShaderMaterial
 *   4. Read back Uint16Array (half-float), convert to Float32Array with Y-flip
 *   5. Encode as Radiance RGBE (.hdr) or OpenEXR (.exr)
 *
 * No external libraries — pure Three.js r165 + TypeScript.
 */
import * as THREE from 'three';

// ─── IEEE 754 half-float ↔ float32 ──────────────────────────────────────────────

/**
 * Convert a 16-bit IEEE 754 half-float to a 32-bit JavaScript number.
 * Handles signed zero, denormalized, normal, infinity, and NaN.
 *
 * @param half - The 16-bit half-float value (0–65535).
 * @returns The equivalent 32-bit float value.
 */
export function halfToFloat(half: number): number {
  const sign = (half >>> 15) & 0x1;
  const exponent = (half >>> 10) & 0x1f;
  const mantissa = half & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) {
      return sign === 0 ? 0 : -0;
    }
    const result = Math.pow(2, -14) * (mantissa / 1024);
    return sign === 0 ? result : -result;
  }

  if (exponent === 31) {
    if (mantissa === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }

  const result = Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
  return sign === 0 ? result : -result;
}

/**
 * Convert a 32-bit IEEE 754 float to a 16-bit half-float (for EXR HALF encoding).
 */
function floatToHalf(value: number): number {
  const buf = new ArrayBuffer(4);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = value;
  const x = u32[0];

  const sign = (x >>> 16) & 0x8000;
  const absX = x & 0x7fffffff;

  if (absX > 0x477fe000) {
    return sign | 0x7c00; // Infinity
  }
  if (absX < 0x33000000) {
    return sign; // Zero
  }
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
 * into an equirectangular Float32Array.
 *
 * Strategy: Build a dedicated capture scene containing:
 *   - An inverted sphere with the current environment map (captures HDRI/background)
 *   - Emissive proxy meshes for every THREE.Light in the main scene
 *   - A small white sphere at origin as reference for indirect illumination
 *
 * Then capture via CubeCamera at (0, 0, 0) — the exact center of the scene.
 *
 * @param renderer   - The active THREE.WebGLRenderer.
 * @param scene      - The main THREE.Scene containing lights, environment, etc.
 * @param resolution - Equirectangular width (height = resolution / 2).
 * @returns Float32Array of HDR pixel data (RGB, 3 floats/pixel, top-to-bottom).
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

  // ── Set capture-friendly renderer state ──────────────────────────────────
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // ── Build a dedicated capture scene ──────────────────────────────────────
  const captureScene = new THREE.Scene();

  // 1) Environment sphere: renders the current HDRI environment as the sky dome
  if (scene.environment) {
    const envSphereRadius = 50;
    const envSphereGeo = new THREE.SphereGeometry(envSphereRadius, 64, 32);
    const envSphereMat = new THREE.MeshBasicMaterial({
      map: scene.environment,
      side: THREE.BackSide,
      // No tone mapping — linear output
    });
    const envSphere = new THREE.Mesh(envSphereGeo, envSphereMat);
    captureScene.add(envSphere);
  } else if (scene.background instanceof THREE.Color) {
    // Fallback: if background is a solid color, use it as ambient
    captureScene.background = scene.background.clone();
  }

  // 2) Emissive proxy for each light in the scene
  //    This ensures every light (Point, Spot, Area, Directional) contributes
  //    visible light information to the captured HDRI.
  const proxyObjects: THREE.Object3D[] = [];

  scene.traverse((child) => {
    if (!(child instanceof THREE.Light)) return;
    if (child instanceof THREE.AmbientLight || child instanceof THREE.HemisphereLight) {
      // Ambient/hemisphere are omnidirectional — they don't have a clear position
      // for a proxy. They contribute uniform light which is already captured by
      // the environment sphere. Skip explicit proxies for them.
      return;
    }

    const light = child;
    const intensity = (light as THREE.Light).intensity ?? 1;
    if (intensity <= 0) return;

    const color = light.color ? light.color.clone() : new THREE.Color(1, 1, 1);

    // Scale color by intensity for the emissive proxy
    // Use a reasonable proxy brightness (capped to avoid extreme HDR values)
    const proxyIntensity = Math.min(intensity, 50);
    const emissiveColor = color.clone().multiplyScalar(proxyIntensity);

    if (light instanceof THREE.DirectionalLight) {
      // DirectionalLight: place a large emissive plane far away in the light's direction
      const dir = new THREE.Vector3();
      light.getWorldDirection(dir);
      const planeSize = 30;
      const geo = new THREE.PlaneGeometry(planeSize, planeSize);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        side: THREE.DoubleSide,
      });
      const proxy = new THREE.Mesh(geo, mat);
      // Position far in the light direction, facing the origin
      const pos = dir.clone().multiplyScalar(45);
      proxy.position.copy(pos);
      proxy.lookAt(0, 0, 0);
      captureScene.add(proxy);
      proxyObjects.push(proxy);

    } else if (light instanceof THREE.SpotLight) {
      // SpotLight: place a disc at the light's world position, oriented along its direction
      const pos = new THREE.Vector3();
      light.getWorldPosition(pos);
      const dir = new THREE.Vector3();
      light.getWorldDirection(dir);
      const angle = light.angle ?? (Math.PI / 6);
      const discRadius = Math.tan(angle) * 5; // visible proxy size
      const geo = new THREE.CircleGeometry(Math.max(0.1, discRadius), 32);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        side: THREE.DoubleSide,
      });
      const proxy = new THREE.Mesh(geo, mat);
      proxy.position.copy(pos);
      proxy.lookAt(pos.clone().add(dir));
      captureScene.add(proxy);
      proxyObjects.push(proxy);

    } else if (light instanceof THREE.RectAreaLight) {
      // RectAreaLight: place an emissive rectangle at the light's position
      const pos = new THREE.Vector3();
      light.getWorldPosition(pos);
      const width = light.width ?? 2;
      const height = light.height ?? 2;
      const geo = new THREE.PlaneGeometry(width, height);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
        side: THREE.DoubleSide,
      });
      const proxy = new THREE.Mesh(geo, mat);
      proxy.position.copy(pos);
      // Match the light's rotation
      proxy.quaternion.copy(light.quaternion);
      captureScene.add(proxy);
      proxyObjects.push(proxy);

    } else {
      // PointLight, IES (mapped to PointLight), etc.
      // Place a small bright sphere at the light's world position
      const pos = new THREE.Vector3();
      light.getWorldPosition(pos);
      const sphereRadius = Math.max(0.15, Math.min(1.0, proxyIntensity * 0.05));
      const geo = new THREE.SphereGeometry(sphereRadius, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: emissiveColor,
      });
      const proxy = new THREE.Mesh(geo, mat);
      proxy.position.copy(pos);
      captureScene.add(proxy);
      proxyObjects.push(proxy);
    }
  });

  // 3) Small white reference sphere at origin for indirect illumination
  const refGeo = new THREE.SphereGeometry(0.3, 16, 12);
  const refMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.0,
    emissive: 0x000000,
  });
  const refSphere = new THREE.Mesh(refGeo, refMat);
  captureScene.add(refSphere);

  try {
    // ── Step 1: Capture cubemap at scene center (0, 0, 0) ─────────────────
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

    // ── Step 2: Cubemap → Equirectangular ──────────────────────────────────
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
          // vUv.y = 0 → bottom (south pole, phi=PI)
          // vUv.y = 1 → top (north pole, phi=0)
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

    // ── Step 3: Read pixels as Uint16Array (half-float) ────────────────────
    const pixelCount = eqWidth * eqHeight * 4;
    const halfPixels = new Uint16Array(pixelCount);
    renderer.readRenderTargetPixels(eqRT, 0, 0, eqWidth, eqHeight, halfPixels);

    // ── Step 4: Convert half → float32 with Y-axis flip ───────────────────
    // readRenderTargetPixels returns bottom-to-top.
    // HDRI/EXR files are top-to-bottom. Flip during conversion.
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
    renderScene.remove(quad);
    refGeo.dispose();
    refMat.dispose();

    return floatPixels;

  } finally {
    // ── Restore renderer state ─────────────────────────────────────────────
    renderer.toneMapping = savedToneMapping;
    renderer.toneMappingExposure = savedToneMappingExposure;
    renderer.outputColorSpace = savedOutputColorSpace;

    // Dispose capture scene resources
    for (const obj of proxyObjects) {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    }
    // Dispose environment sphere if present
    if (captureScene.children.length > 0) {
      captureScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }
  }
}

// ─── Radiance HDR (RGBE) Encoding ──────────────────────────────────────────────

/**
 * Encode HDR pixel data into a Radiance RGBE .hdr file (ArrayBuffer).
 *
 * Uses uncompressed (flat) RGBE encoding — one 4-byte RGBE value per pixel —
 * for maximum compatibility with Blender, GIMP, HDRView, Photoshop, etc.
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
 * RGBE encoding: shared exponent with 8-bit mantissas.
 * For each pixel (r, g, b):
 *   maxVal = max(r, g, b)
 *   if maxVal < 1e-32: output [0,0,0,0]
 *   else:
 *     exp = ceil(log2(maxVal))
 *     if 2^exp <= maxVal: exp++     (conservative rounding)
 *     scale = 2^(-exp) * 256
 *     R = clamp(floor(r * scale), 0, 255)
 *     G = clamp(floor(g * scale), 0, 255)
 *     B = clamp(floor(b * scale), 0, 255)
 *     E = exp + 128   (biased exponent)
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

  // Use frexp-style approach for better precision
  let exp = Math.ceil(Math.log2(maxVal));
  // Conservative: if 2^exp doesn't fully cover maxVal, bump up
  if (Math.pow(2, exp) < maxVal) {
    exp++;
  }
  // Verify coverage
  if (Math.pow(2, exp) < maxVal) {
    exp++;
  }

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
 * - Channels: B, G, R as FLOAT (32-bit IEEE 754) — alphabetical order per spec.
 * - Compression: NO_COMPRESSION (0) for maximum reliability.
 * - All required attributes for Blender/Photoshop compatibility.
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
  const CHANNEL_NAMES = ['B', 'G', 'R'] as const;
  const PIXEL_TYPE_FLOAT = 2; // 0=UINT, 1=HALF, 2=FLOAT
  const CHANNEL_BYTES = 4;    // 32-bit float
  const BYTES_PER_PIXEL = 3 * CHANNEL_BYTES; // B + G + R
  const SCANLINE_DATA_SIZE = width * BYTES_PER_PIXEL;

  // ── Helper functions ────────────────────────────────────────────────────
  const writeU8 = (arr: number[], val: number): void => { arr.push(val & 0xff); };
  const writeU32LE = (arr: number[], val: number): void => {
    arr.push(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff);
  };
  const writeF32LE = (arr: number[], val: number): void => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    const bytes = new Uint8Array(buf);
    arr.push(bytes[0], bytes[1], bytes[2], bytes[3]);
  };
  const writeStr = (arr: number[], str: string): void => {
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) arr.push(b);
    arr.push(0); // null-terminator
  };

  /** Write a null-terminated string padded to 4-byte alignment. */
  const writePaddedStr = (arr: number[], str: string): void => {
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) arr.push(b);
    const totalLen = bytes.length + 1; // +1 for null
    const pad = (4 - (totalLen % 4)) % 4;
    arr.push(0); // null-terminator
    for (let i = 0; i < pad; i++) arr.push(0);
  };

  // ── Build header ────────────────────────────────────────────────────────
  const hdr: number[] = [];

  // --- channels (chlist) ---
  writeStr(hdr, 'channels');
  writeStr(hdr, 'chlist');
  // Channel entries: name\0(padded to 4) + pixelType(4) + pLinear(4) + xSampling(4) + ySampling(4)
  for (const chName of CHANNEL_NAMES) {
    writePaddedStr(hdr, chName);
    writeU32LE(hdr, PIXEL_TYPE_FLOAT);
    writeU32LE(hdr, 0); // pLinear reserved
    writeU32LE(hdr, 1); // xSampling
    writeU32LE(hdr, 1); // ySampling
  }
  hdr.push(0); // end of channel list

  // --- compression ---
  writeStr(hdr, 'compression');
  writeStr(hdr, 'compression');
  hdr.push(0); // NO_COMPRESSION = 0
  // Pad attribute value to 4-byte boundary (value size = 1, pad to 4)
  hdr.push(0, 0, 0);

  // --- dataWindow (box2i, 16 bytes) ---
  writeStr(hdr, 'dataWindow');
  writeStr(hdr, 'box2i');
  writeU32LE(hdr, 16);       // attribute size
  writeU32LE(hdr, 0);        // xMin
  writeU32LE(hdr, 0);        // yMin
  writeU32LE(hdr, width - 1);
  writeU32LE(hdr, height - 1);

  // --- displayWindow (box2i, 16 bytes) ---
  writeStr(hdr, 'displayWindow');
  writeStr(hdr, 'box2i');
  writeU32LE(hdr, 16);
  writeU32LE(hdr, 0);
  writeU32LE(hdr, 0);
  writeU32LE(hdr, width - 1);
  writeU32LE(hdr, height - 1);

  // --- lineOrder ---
  writeStr(hdr, 'lineOrder');
  writeStr(hdr, 'lineOrder');
  hdr.push(0, 0, 0, 0); // INCREASING_Y, padded to 4

  // --- pixelAspectRatio (float, 4 bytes) ---
  writeStr(hdr, 'pixelAspectRatio');
  writeStr(hdr, 'float');
  writeF32LE(hdr, 1.0);

  // --- screenWindowCenter (v2f, 8 bytes) ---
  writeStr(hdr, 'screenWindowCenter');
  writeStr(hdr, 'v2f');
  writeF32LE(hdr, 0.0);
  writeF32LE(hdr, 0.0);

  // --- screenWindowWidth (float, 4 bytes) ---
  writeStr(hdr, 'screenWindowWidth');
  writeStr(hdr, 'float');
  writeF32LE(hdr, 1.0);

  // --- End of header: single null byte, padded to 8-byte boundary ---
  hdr.push(0);
  while (hdr.length % 8 !== 0) {
    hdr.push(0);
  }

  const headerSize = hdr.length;
  const fileHeaderSize = 8; // magic + version
  const offsetTableSize = height * 8;
  const scanlineDataStart = fileHeaderSize + headerSize + offsetTableSize;
  const scanlineBlockSize = 4 + 4 + SCANLINE_DATA_SIZE;

  // ── Offset table (one uint64 per scanline) ──────────────────────────────
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(scanlineDataStart + y * scanlineBlockSize);
  }

  // ── Scanline pixel data ─────────────────────────────────────────────────
  const scanlines: number[] = [];
  for (let y = 0; y < height; y++) {
    writeU32LE(scanlines, y);              // line number
    writeU32LE(scanlines, SCANLINE_DATA_SIZE); // data size

    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      const b = pixels[srcIdx + 2];
      const g = pixels[srcIdx + 1];
      const r = pixels[srcIdx];

      writeF32LE(scanlines, b);
      writeF32LE(scanlines, g);
      writeF32LE(scanlines, r);
    }
  }

  // ── Assemble file ───────────────────────────────────────────────────────
  const totalSize = fileHeaderSize + headerSize + offsetTableSize + scanlines.length;
  const file = new Uint8Array(totalSize);
  const dv = new DataView(file.buffer);

  // Magic: 20000630 (0x762F3101)
  dv.setUint32(0, 20000630, true);
  // Version: 2 (single-part, no flags)
  dv.setUint32(4, 2, true);

  // Header
  file.set(new Uint8Array(hdr), 8);

  // Offset table (each as uint64 LE = two uint32)
  const offsetBase = 8 + headerSize;
  for (let y = 0; y < height; y++) {
    const off = offsets[y];
    dv.setUint32(offsetBase + y * 8, off & 0xffffffff, true);
    dv.setUint32(offsetBase + y * 8 + 4, Math.floor(off / 0x100000000) & 0xffffffff, true);
  }

  // Scanline data
  file.set(new Uint8Array(scanlines), scanlineDataStart);

  return file.buffer;
}

// ─── Download helper ───────────────────────────────────────────────────────────

/**
 * Download HDR pixel data as a .hdr or .exr file.
 *
 * @param pixels   - Float32Array of RGB (3 floats/pixel, top-to-bottom, linear).
 * @param width    - Image width.
 * @param height   - Image height.
 * @param format   - 'hdr' for Radiance RGBE or 'exr' for OpenEXR.
 * @param filename - Optional filename without extension. Default: `hdri_export_[timestamp]`.
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

/**
 * Capture scene and export as Radiance .HDR.
 *
 * @deprecated Use captureSceneToHDRI() + downloadHDRI() for more control.
 */
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

/**
 * Capture scene and export as OpenEXR .EXR.
 *
 * @deprecated Use captureSceneToHDRI() + downloadHDRI() for more control.
 */
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