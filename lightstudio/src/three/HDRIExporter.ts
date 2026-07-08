/**
 * HDRIExporter — Captures the combined scene lighting (environment + all physical
 * lights) as an equirectangular HDRI (.hdr) or EXR (.exr) file suitable for IBL
 * in Blender, Photoshop, HDRView, or any HDR-capable application.
 *
 * Fixes applied:
 *  - Bug 1: Uses HalfFloatType render targets + Uint16Array readback + manual
 *           halfToFloat() conversion to avoid corrupt FloatType data on
 *           Windows/Chrome.
 *  - Bug 2: Forces ALL THREE.Light instances visible and hides helpers/grid/ground
 *           before CubeCamera capture so physical lights contribute to the HDRI.
 *  - Bug 3: Vertically flips the equirectangular image during the half-to-float
 *           conversion loop so output is top-to-bottom as required by HDR/EXR.
 *
 * No external libraries — pure Three.js r165 + TypeScript only.
 */
import * as THREE from 'three';

// ─── IEEE 754 half-float ↔ float32 conversion ──────────────────────────────────

/**
 * Convert a 16-bit IEEE 754 half-float to a 32-bit JavaScript number.
 * Handles signed zero, denormalized, normal, infinity, and NaN values.
 *
 * @param half - The 16-bit half-float value (as a plain number, 0–65535).
 * @returns The equivalent 32-bit float value.
 */
export function halfToFloat(half: number): number {
  const sign = (half >> 15) & 0x1;
  const exponent = (half >> 10) & 0x1f;
  const mantissa = half & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) {
      // Signed zero
      return sign === 0 ? 0 : -0;
    }
    // Denormalized: convert to normalized float32
    const e = Math.pow(2, -14);
    const m = mantissa / 1024;
    const result = e * m;
    return sign === 0 ? result : -result;
  }

  if (exponent === 31) {
    // Infinity or NaN
    if (mantissa === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }

  // Normalized number
  const e = Math.pow(2, exponent - 15);
  const m = 1 + mantissa / 1024;
  const result = e * m;
  return sign === 0 ? result : -result;
}

/**
 * Convert a 32-bit IEEE 754 float to a 16-bit half-float.
 * Used internally for EXR HALF pixel encoding.
 */
function floatToHalf(value: number): number {
  const buffer = new ArrayBuffer(4);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  f32[0] = value;
  const x = u32[0];

  const sign = (x >> 16) & 0x8000;
  const absX = x & 0x7fffffff;

  if (absX > 0x477fe000) {
    // Too large for half → Infinity
    return sign | 0x7c00;
  }
  if (absX < 0x33000000) {
    // Too small for half → Zero
    return sign;
  }
  if (absX < 0x38800000) {
    // Denormalized half
    const shift = 125 - ((absX >> 23) & 0xff);
    const mantissa = ((absX & 0x7fffff) | 0x800000) >> shift;
    return sign | mantissa;
  }

  // Normalized half
  const exponent = ((absX >> 23) & 0xff) - 127 + 15;
  const mantissa = (absX >> 13) & 0x3ff;
  return sign | (exponent << 10) | mantissa;
}

// ─── Scene capture ─────────────────────────────────────────────────────────────

/** Objects whose visibility was temporarily changed during capture. */
interface VisibilityRecord {
  object: THREE.Object3D;
  wasVisible: boolean;
}

/**
 * Captures the full scene lighting into an equirectangular Float32Array.
 *
 * Process:
 *  1. Saves and overrides renderer/scene state (tone mapping, color space,
 *     background, environment, visibility).
 *  2. Forces all THREE.Light instances visible; hides helpers, grid, ground.
 *  3. Captures a cubemap at (0, 0.5, 0) via CubeCamera with HalfFloatType.
 *  4. Projects the cubemap to equirectangular via a custom ShaderMaterial.
 *  5. Reads pixels as Uint16Array (half-float) and converts to Float32Array
 *     with vertical Y-flip.
 *  6. Restores all state in a finally block.
 *
 * @param renderer  - The active THREE.WebGLRenderer.
 * @param scene     - The THREE.Scene containing lights, helpers, ground, etc.
 * @param resolution - Equirectangular width in pixels (height = resolution / 2).
 * @returns Float32Array of HDR pixel data (RGB, 3 floats per pixel, top-to-bottom).
 */
export async function captureSceneToHDRI(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  resolution: number,
): Promise<Float32Array> {
  // ── Save state ───────────────────────────────────────────────────────────
  const savedToneMapping = renderer.toneMapping;
  const savedToneMappingExposure = renderer.toneMappingExposure;
  const savedOutputColorSpace = renderer.outputColorSpace;
  const savedBackground = scene.background;
  const savedEnvironment = scene.environment;

  const visibilityRecords: VisibilityRecord[] = [];

  // ── Apply capture-friendly state ─────────────────────────────────────────
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // Remove background/environment so CubeCamera captures pure scene lighting
  scene.background = null;
  scene.environment = null;

  // Traverse scene: force lights visible, hide non-light clutter
  scene.traverse((child) => {
    const isLight = child instanceof THREE.Light;
    const isHelperOrClutter =
      child.userData.isHelper === true ||
      child.userData.isGround === true ||
      child.userData.isGrid === true ||
      child instanceof THREE.GridHelper ||
      child instanceof THREE.CameraHelper ||
      child instanceof THREE.DirectionalLightHelper ||
      child instanceof THREE.SpotLightHelper ||
      child instanceof THREE.PointLightHelper ||
      child instanceof THREE.HemisphereLightHelper;

    if (isLight) {
      // Force every light visible during capture
      if (!child.visible) {
        visibilityRecords.push({ object: child, wasVisible: false });
        child.visible = true;
      }
    } else if (isHelperOrClutter) {
      // Hide visual clutter that should not appear in the HDRI
      if (child.visible) {
        visibilityRecords.push({ object: child, wasVisible: true });
        child.visible = false;
      }
    } else if (child instanceof THREE.Mesh && child !== undefined) {
      // Hide model meshes (we want lighting only, not the car itself)
      // But keep any emissive light panels from the environment system
      const mat = child.material;
      if (mat instanceof THREE.MeshBasicMaterial && mat.color) {
        // This could be an environment panel — keep it visible
        return;
      }
      if (child.visible) {
        visibilityRecords.push({ object: child, wasVisible: true });
        child.visible = false;
      }
    }
  });

  // Also hide the ground plane and grid references stored on the scene
  const groundMesh = (scene as unknown as Record<string, THREE.Object3D | null>).ground;
  const gridHelper = (scene as unknown as Record<string, THREE.Object3D | null>).grid;

  let groundWasVisible = false;
  let gridWasVisible = false;

  if (groundMesh && groundMesh.visible) {
    groundWasVisible = true;
    groundMesh.visible = false;
  }
  if (gridHelper && gridHelper.visible) {
    gridWasVisible = true;
    gridHelper.visible = false;
  }

  // Also hide any children named 'ground' or 'grid'
  scene.traverse((child) => {
    if (child.name === 'ground' || child.name === 'grid') {
      if (child.visible) {
        // Check we haven't already recorded this object
        const alreadyRecorded = visibilityRecords.some((r) => r.object === child);
        if (!alreadyRecorded) {
          visibilityRecords.push({ object: child, wasVisible: true });
          child.visible = false;
        }
      }
    }
  });

  try {
    // ── Step 1: Capture cubemap with HalfFloatType ─────────────────────────
    const cubeSize = Math.max(256, resolution);
    const cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRT);
    cubeCamera.position.set(0, 0.5, 0);
    cubeCamera.update(renderer, scene);

    // ── Step 2: Cubemap → Equirectangular projection ───────────────────────
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
          float phi = vUv.y * PI;
          float theta = vUv.x * TWO_PI;
          vec3 dir = vec3(
            -sin(phi) * sin(theta),
            cos(phi),
            -sin(phi) * cos(theta)
          );
          gl_FragColor = textureCube(envMap, dir);
        }
      `,
      depthWrite: false,
      depthTest: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), equirectMaterial);
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tempScene = new THREE.Scene();
    tempScene.add(quad);

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(eqRT);
    renderer.render(tempScene, orthoCamera);
    renderer.setRenderTarget(prevRT);

    // ── Step 3: Read pixels as Uint16Array (HalfFloat) ────────────────────
    const pixelCount = eqWidth * eqHeight * 4; // RGBA
    const halfPixels = new Uint16Array(pixelCount);
    renderer.readRenderTargetPixels(eqRT, 0, 0, eqWidth, eqHeight, halfPixels);

    // ── Step 4: Convert half → float32 with Y-axis flip ───────────────────
    // readRenderTargetPixels returns bottom-to-top rows.
    // HDR/EXR expect top-to-bottom, so we flip during conversion.
    const floatPixels = new Float32Array(eqWidth * eqHeight * 3); // RGB only

    for (let row = 0; row < eqHeight; row++) {
      const srcRow = eqHeight - 1 - row; // flip Y
      for (let col = 0; col < eqWidth; col++) {
        const srcIdx = (srcRow * eqWidth + col) * 4; // RGBA in half pixels
        const dstIdx = (row * eqWidth + col) * 3;    // RGB in output

        floatPixels[dstIdx] = halfToFloat(halfPixels[srcIdx]);
        floatPixels[dstIdx + 1] = halfToFloat(halfPixels[srcIdx + 1]);
        floatPixels[dstIdx + 2] = halfToFloat(halfPixels[srcIdx + 2]);
      }
    }

    // ── Cleanup GPU resources ──────────────────────────────────────────────
    quad.geometry.dispose();
    equirectMaterial.dispose();
    eqRT.dispose();
    cubeRT.dispose();
    tempScene.remove(quad);

    return floatPixels;

  } finally {
    // ── Restore ALL state (guaranteed by finally) ──────────────────────────
    renderer.toneMapping = savedToneMapping;
    renderer.toneMappingExposure = savedToneMappingExposure;
    renderer.outputColorSpace = savedOutputColorSpace;
    scene.background = savedBackground;
    scene.environment = savedEnvironment;

    for (const record of visibilityRecords) {
      record.object.visible = record.wasVisible;
    }

    if (groundMesh) groundMesh.visible = groundWasVisible;
    if (gridHelper) gridHelper.visible = gridWasVisible;
  }
}

// ─── Radiance HDR (RGBE) Encoding ──────────────────────────────────────────────

/**
 * Encode HDR pixel data into a Radiance RGBE .hdr file (ArrayBuffer).
 *
 * Uses flat (uncompressed) RGBE encoding for maximum compatibility across
 * Blender, GIMP, HDRView, and other HDR tools.
 *
 * @param pixels - Float32Array of RGB values (3 floats per pixel, top-to-bottom).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .hdr file as an ArrayBuffer.
 */
export function encodeHDR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  // ── Build header ─────────────────────────────────────────────────────────
  const headerText =
    '#?RADIANCE\n' +
    'FORMAT=32-bit_rle_rgbe\n' +
    'EXPOSURE=1.0\n' +
    `\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(headerText);

  // ── Encode pixel data (flat, no RLE) ────────────────────────────────────
  // Each pixel = 4 bytes (R, G, B, E)
  const pixelDataSize = width * height * 4;
  const pixelData = new Uint8Array(pixelDataSize);

  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * 3;
    const dstIdx = i * 4;

    const r = pixels[srcIdx];
    const g = pixels[srcIdx + 1];
    const b = pixels[srcIdx + 2];

    encodeRGBEPixel(r, g, b, pixelData, dstIdx);
  }

  // ── Assemble file ───────────────────────────────────────────────────────
  const totalSize = headerBytes.length + pixelDataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);
  view.set(headerBytes, 0);
  view.set(pixelData, headerBytes.length);

  return buffer;
}

/**
 * Encode a single RGB float triplet into Radiance RGBE format.
 *
 * Algorithm:
 *  1. Find max(r, g, b). If negligible (< 1e-32), output [0,0,0,0].
 *  2. Compute shared exponent: exp = ceil(log2(maxVal)).
 *     If 2^exp <= maxVal, increment exp (conservative rounding).
 *  3. Scale mantissas: channel = clamp(floor(value * 256 / 2^exp), 0, 255).
 *  4. Biased exponent: E = exp + 128.
 *
 * @param r   - Red channel float value.
 * @param g   - Green channel float value.
 * @param b   - Blue channel float value.
 * @param out - Output Uint8Array to write 4 bytes into.
 * @param off - Byte offset in the output array.
 */
function encodeRGBEPixel(
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
  if (Math.pow(2, exp) <= maxVal) {
    exp++;
  }

  const scale = Math.pow(2, -exp) * 256.0;
  out[off] = Math.max(0, Math.min(255, Math.floor(r * scale)));
  out[off + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
  out[off + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
  out[off + 3] = Math.max(0, Math.min(255, exp + 128));
}

// ─── OpenEXR Encoding ──────────────────────────────────────────────────────────

/**
 * Encode HDR pixel data into an OpenEXR .exr file (ArrayBuffer).
 *
 * Format details:
 *  - Channels: R, G, B as FLOAT (32-bit IEEE 754).
 *  - Compression: NO_COMPRESSION (value 0) for maximum reliability.
 *  - All required attributes present for Blender/Photoshop compatibility.
 *
 * @param pixels - Float32Array of RGB values (3 floats per pixel, top-to-bottom).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .exr file as an ArrayBuffer.
 */
export function encodeEXR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  // ── Channel definitions (stored alphabetically: B, G, R) ────────────────
  const CHANNEL_NAMES = ['B', 'G', 'R'] as const;
  const PIXEL_TYPE_FLOAT = 2; // UINT=0, HALF=1, FLOAT=2
  const CHANNEL_BYTES = 4; // 32-bit float per channel
  const NUM_CHANNELS = 3;
  const BYTES_PER_PIXEL = NUM_CHANNELS * CHANNEL_BYTES;
  const SCANLINE_DATA_SIZE = width * BYTES_PER_PIXEL;

  // ── Build header ─────────────────────────────────────────────────────────
  const headerChunks: Uint8Array[] = [];

  // Helper: null-terminated string, padded to 4-byte boundary
  const attrString = (name: string, typeName: string, value?: string): Uint8Array => {
    const parts: number[] = [];
    const nameBytes = new TextEncoder().encode(name);
    for (const b of nameBytes) parts.push(b);
    parts.push(0); // null-terminate name

    const typeBytes = new TextEncoder().encode(typeName);
    for (const b of typeBytes) parts.push(b);
    parts.push(0); // null-terminate type

    if (value !== undefined) {
      const valBytes = new TextEncoder().encode(value);
      for (const b of valBytes) parts.push(b);
      parts.push(0); // null-terminate value
      // Pad to 4-byte boundary (total for this attribute)
      const totalLen = nameBytes.length + 1 + typeBytes.length + 1 + valBytes.length + 1;
      const pad = (4 - (totalLen % 4)) % 4;
      for (let i = 0; i < pad; i++) parts.push(0);
    }

    return new Uint8Array(parts);
  };

  // Helper: int32 LE bytes
  const int32Bytes = (val: number): Uint8Array => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, val, true);
    return new Uint8Array(buf);
  };

  // Helper: float32 LE bytes
  const float32Bytes = (val: number): Uint8Array => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    return new Uint8Array(buf);
  };

  // Helper: concatenate Uint8Arrays
  const concat = (...arrays: Uint8Array[]): Uint8Array => {
    let totalLen = 0;
    for (const a of arrays) totalLen += a.length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const a of arrays) {
      result.set(a, offset);
      offset += a.length;
    }
    return result;
  };

  // --- channels attribute (chlist) ---
  // Each entry: name\0 (padded to 4-byte boundary) + pixelType(4) + pLinear(4) + xSampling(4) + ySampling(4)
  const channelEntries: Uint8Array[] = [];
  for (const chName of CHANNEL_NAMES) {
    const nameBytes = new TextEncoder().encode(chName);
    const nameWithNull = concat(new Uint8Array([...nameBytes, 0]));
    // Pad name (including null) to 4-byte boundary
    const nameTotalLen = nameBytes.length + 1;
    const padLen = (4 - (nameTotalLen % 4)) % 4;
    const paddedName = concat(nameWithNull, new Uint8Array(padLen));

    const entry = concat(
      paddedName,
      int32Bytes(PIXEL_TYPE_FLOAT), // pixel type
      int32Bytes(0),                // pLinear (reserved, 0)
      int32Bytes(1),                // xSampling
      int32Bytes(1),                // ySampling
    );
    channelEntries.push(entry);
  }

  // Channel list terminated by a single null byte
  const channelListData = concat(...channelEntries, new Uint8Array([0]));
  const channelsAttr = attrString('channels', 'chlist');
  // Build the full channels attribute: name\0 + type\0 + size(int32) + data
  // The chlist data is the value, preceded by its size as int32
  const channelsAttrFull = concat(
    new Uint8Array([...new TextEncoder().encode('channels'), 0]),
    new Uint8Array([...new TextEncoder().encode('chlist'), 0]),
    int32Bytes(channelListData.length),
    channelListData,
  );

  // --- compression attribute ---
  const compressionAttr = concat(
    new Uint8Array([...new TextEncoder().encode('compression'), 0]),
    new Uint8Array([...new TextEncoder().encode('compression'), 0]),
    int32Bytes(1),               // size = 1 byte
    new Uint8Array([0]),         // NO_COMPRESSION
    new Uint8Array([0, 0, 0]),   // pad to 4-byte boundary
  );

  // --- dataWindow attribute (box2i) ---
  const dataWindowAttr = concat(
    new Uint8Array([...new TextEncoder().encode('dataWindow'), 0]),
    new Uint8Array([...new TextEncoder().encode('box2i'), 0]),
    int32Bytes(16),              // size = 16 bytes
    int32Bytes(0),               // xMin
    int32Bytes(0),               // yMin
    int32Bytes(width - 1),       // xMax
    int32Bytes(height - 1),      // yMax
  );

  // --- displayWindow attribute (box2i) ---
  const displayWindowAttr = concat(
    new Uint8Array([...new TextEncoder().encode('displayWindow'), 0]),
    new Uint8Array([...new TextEncoder().encode('box2i'), 0]),
    int32Bytes(16),
    int32Bytes(0),
    int32Bytes(0),
    int32Bytes(width - 1),
    int32Bytes(height - 1),
  );

  // --- lineOrder attribute ---
  const lineOrderAttr = concat(
    new Uint8Array([...new TextEncoder().encode('lineOrder'), 0]),
    new Uint8Array([...new TextEncoder().encode('lineOrder'), 0]),
    int32Bytes(1),               // size = 1 byte
    new Uint8Array([0]),         // INCREASING_Y
    new Uint8Array([0, 0, 0]),   // pad to 4-byte boundary
  );

  // --- pixelAspectRatio attribute (float) ---
  const pixelAspectRatioAttr = concat(
    new Uint8Array([...new TextEncoder().encode('pixelAspectRatio'), 0]),
    new Uint8Array([...new TextEncoder().encode('float'), 0]),
    int32Bytes(4),               // size = 4 bytes
    float32Bytes(1.0),
  );

  // --- screenWindowCenter attribute (v2f) ---
  const screenWindowCenterAttr = concat(
    new Uint8Array([...new TextEncoder().encode('screenWindowCenter'), 0]),
    new Uint8Array([...new TextEncoder().encode('v2f'), 0]),
    int32Bytes(8),               // size = 8 bytes
    float32Bytes(0.0),
    float32Bytes(0.0),
  );

  // --- screenWindowWidth attribute (float) ---
  const screenWindowWidthAttr = concat(
    new Uint8Array([...new TextEncoder().encode('screenWindowWidth'), 0]),
    new Uint8Array([...new TextEncoder().encode('float'), 0]),
    int32Bytes(4),
    float32Bytes(1.0),
  );

  // --- Assemble header ---
  const headerBeforeEnd = concat(
    channelsAttr,
    compressionAttr,
    dataWindowAttr,
    displayWindowAttr,
    lineOrderAttr,
    pixelAspectRatioAttr,
    screenWindowCenterAttr,
    screenWindowWidthAttr,
  );

  // End of header: single null byte, then pad to 8-byte boundary
  const headerEndSize = 1; // null byte
  const rawHeaderSize = headerBeforeEnd.length + headerEndSize;
  const paddedHeaderSize = Math.ceil(rawHeaderSize / 8) * 8;
  const headerPadding = paddedHeaderSize - rawHeaderSize;

  const fullHeader = concat(
    headerBeforeEnd,
    new Uint8Array([0]),                  // end of header
    new Uint8Array(headerPadding),        // pad to 8-byte boundary
  );

  // ── Offset table ────────────────────────────────────────────────────────
  // magic(4) + version(4) + header + offsetTable + scanlines
  const fileHeaderSize = 8; // magic + version
  const offsetTableSize = height * 8; // uint64 per scanline (stored as two uint32)
  const scanlineDataStart = fileHeaderSize + fullHeader.length + offsetTableSize;

  // Each scanline block: y(4) + dataSize(4) + pixelData(width * 3 * 4)
  const scanlineBlockSize = 4 + 4 + SCANLINE_DATA_SIZE;

  const offsetTable = new Uint8Array(offsetTableSize);
  const offsetView = new DataView(offsetTable.buffer);

  for (let y = 0; y < height; y++) {
    const offset = scanlineDataStart + y * scanlineBlockSize;
    // uint64 LE stored as two uint32
    offsetView.setUint32(y * 8, offset & 0xffffffff, true);
    offsetView.setUint32(y * 8 + 4, Math.floor(offset / 0x100000000) & 0xffffffff, true);
  }

  // ── Scanline pixel data ─────────────────────────────────────────────────
  // Each scanline: y(4) + dataSize(4) + B(float32) G(float32) R(float32) per pixel
  const totalScanlineBytes = height * scanlineBlockSize;
  const scanlineBuffer = new Uint8Array(totalScanlineBytes);
  const scanlineView = new DataView(scanlineBuffer.buffer);

  for (let y = 0; y < height; y++) {
    const blockOffset = y * scanlineBlockSize;

    // Y coordinate
    scanlineView.setInt32(blockOffset, y, true);
    // Data size
    scanlineView.setInt32(blockOffset + 4, SCANLINE_DATA_SIZE, true);

    // Pixel data: B, G, R as FLOAT32 (EXR channel order is alphabetical)
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3; // RGB from input
      const dstOffset = blockOffset + 8 + x * BYTES_PER_PIXEL;

      const r = pixels[srcIdx];
      const g = pixels[srcIdx + 1];
      const b = pixels[srcIdx + 2];

      // EXR stores channels alphabetically: B, G, R
      scanlineView.setFloat32(dstOffset, b, true);
      scanlineView.setFloat32(dstOffset + 4, g, true);
      scanlineView.setFloat32(dstOffset + 8, r, true);
    }
  }

  // ── Assemble complete EXR file ──────────────────────────────────────────
  const totalSize = fileHeaderSize + fullHeader.length + offsetTableSize + totalScanlineBytes;
  const file = new ArrayBuffer(totalSize);
  const fileView = new DataView(file);
  const fileBytes = new Uint8Array(file);

  // Magic number: 0x762F3101 = 20000630 decimal
  fileView.setUint32(0, 20000630, true);
  // Version: 2 (no multi-part, no long names, no deep data)
  fileView.setUint32(4, 2, true);

  // Header
  fileBytes.set(fullHeader, 8);

  // Offset table
  fileBytes.set(offsetTable, 8 + fullHeader.length);

  // Scanline data
  fileBytes.set(scanlineBuffer, scanlineDataStart);

  return file;
}

// ─── Download helper ───────────────────────────────────────────────────────────

/**
 * Download HDR pixel data as a .hdr or .exr file.
 *
 * Creates a Blob from the encoded data and triggers a browser download
 * with an auto-generated filename (or the one provided).
 *
 * @param pixels   - Float32Array of RGB values (3 floats per pixel, top-to-bottom).
 * @param width    - Image width in pixels.
 * @param height   - Image height in pixels.
 * @param format   - Export format: 'hdr' for Radiance RGBE, 'exr' for OpenEXR.
 * @param filename - Optional filename without extension. Defaults to `hdri_export_[timestamp]`.
 */
export function downloadHDRI(
  pixels: Float32Array,
  width: number,
  height: number,
  format: 'hdr' | 'exr',
  filename?: string,
): void {
  const timestamp = Date.now();
  const baseName = filename ?? `hdri_export_${timestamp}`;
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
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
  }, 250);
}

// ─── Convenience wrappers (backward-compatible API) ────────────────────────────

/**
 * Capture the scene and export as a Radiance .HDR file.
 * Backward-compatible wrapper around the new async pipeline.
 *
 * @deprecated Use `captureSceneToHDRI()` + `downloadHDRI()` for more control.
 */
export async function exportSceneAsHDR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; excludeModel?: boolean; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const filename = options?.filename;

  const height = Math.floor(resolution / 2);
  const pixels = await captureSceneToHDRI(renderer, scene, resolution);
  downloadHDRI(pixels, resolution, height, 'hdr', filename);
}

/**
 * Capture the scene and export as an OpenEXR .EXR file.
 * Backward-compatible wrapper around the new async pipeline.
 *
 * @deprecated Use `captureSceneToHDRI()` + `downloadHDRI()` for more control.
 */
export async function exportSceneAsEXR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; excludeModel?: boolean; filename?: string },
): Promise<void> {
  const resolution = options?.size ?? 2048;
  const filename = options?.filename;

  const height = Math.floor(resolution / 2);
  const pixels = await captureSceneToHDRI(renderer, scene, resolution);
  downloadHDRI(pixels, resolution, height, 'exr', filename);
}