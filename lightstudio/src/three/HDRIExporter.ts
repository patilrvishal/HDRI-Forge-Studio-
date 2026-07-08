/**
 * HDRIExporter — Captures the current 3D scene lighting as an equirectangular
 * HDRI (.hdr) or EXR (.exr) file that can be used as IBL in other software.
 *
 * Uses a CubeCamera to capture the full 360° environment from the scene origin,
 * converts to equirectangular projection, then encodes to Radiance RGBE or OpenEXR format.
 */
import * as THREE from 'three';

// ── Public API ────────────────────────────────────────────────────────────────

export interface HDRIExportOptions {
  /** Equirectangular width (height = width / 2) */
  size?: number;
  /** Hide the model during capture (export lighting only) */
  excludeModel?: boolean;
  /** File name without extension */
  filename?: string;
}

/**
 * Export the scene as a Radiance .HDR file.
 */
export function exportSceneAsHDR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: HDRIExportOptions,
): void {
  const size = options?.size ?? 2048;
  const filename = options?.filename ?? `lightstudio_hdri_${Date.now()}`;

  const { pixels, width, height } = captureEquirectangular(renderer, scene, {
    size,
    excludeModel: options?.excludeModel ?? true,
  });

  const blob = encodeRGBE(pixels, width, height);
  downloadBlob(blob, `${filename}.hdr`);
}

/**
 * Export the scene as an OpenEXR .EXR file (uncompressed, HALF float).
 */
export function exportSceneAsEXR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: HDRIExportOptions,
): void {
  const size = options?.size ?? 2048;
  const filename = options?.filename ?? `lightstudio_hdri_${Date.now()}`;

  const { pixels, width, height } = captureEquirectangular(renderer, scene, {
    size,
    excludeModel: options?.excludeModel ?? true,
  });

  const blob = encodeEXR(pixels, width, height);
  downloadBlob(blob, `${filename}.exr`);
}

// ── Capture ───────────────────────────────────────────────────────────────────

interface CaptureResult {
  pixels: Float32Array; // RGBA float32, row 0 = bottom of equirectangular
  width: number;
  height: number;
}

function captureEquirectangular(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options: { size: number; excludeModel: boolean },
): CaptureResult {
  const cubeSize = Math.max(256, options.size);
  const eqWidth = options.size;
  const eqHeight = Math.floor(eqWidth / 2);

  // ── Step 1: Capture cube map ────────────────────────────────────────────
  const cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    generateMipmaps: false,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRT);

  // Optionally hide model meshes
  const hidden: THREE.Mesh[] = [];
  if (options.excludeModel) {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && !child.userData.isHelper && !child.userData.isGround) {
        if (child.visible) {
          child.visible = false;
          hidden.push(child);
        }
      }
    });
  }

  // Position camera at scene center (model ground level)
  const originalPos = cubeCamera.position.clone();
  cubeCamera.position.set(0, 0.5, 0);
  cubeCamera.update(renderer, scene);
  cubeCamera.position.copy(originalPos);

  // Restore visibility
  for (const mesh of hidden) {
    mesh.visible = true;
  }

  // ── Step 2: Convert cube map to equirectangular ────────────────────────
  const eqRT = new THREE.WebGLRenderTarget(eqWidth, eqHeight, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const equirectMaterial = new THREE.ShaderMaterial({
    uniforms: {
      envMap: { value: cubeRT.texture },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform samplerCube envMap;
      varying vec2 vUv;

      const float PI = 3.14159265359;

      void main() {
        // UV (0,0) = bottom-left, (1,1) = top-right
        // theta = 0 at bottom (south pole), PI at top (north pole)
        float phi = vUv.x * 2.0 * PI;
        float theta = vUv.y * PI;

        vec3 dir;
        dir.x = sin(theta) * cos(phi);
        dir.y = cos(theta);
        dir.z = sin(theta) * sin(phi);

        gl_FragColor = texture(envMap, dir);
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

  // ── Step 3: Read back pixels ────────────────────────────────────────────
  const pixels = new Float32Array(eqWidth * eqHeight * 4);
  renderer.readRenderTargetPixels(eqRT, 0, 0, eqWidth, eqHeight, pixels);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  quad.geometry.dispose();
  equirectMaterial.dispose();
  eqRT.dispose();
  cubeRT.dispose();
  tempScene.remove(quad);

  return { pixels, width: eqWidth, height: eqHeight };
}

// ── Radiance HDR (RGBE) Encoding ──────────────────────────────────────────────

function encodeRGBE(pixels: Float32Array, width: number, height: number): Blob {
  // Radiance HDR format:
  // - Header (text, newline-terminated)
  // - Empty line
  // - Resolution: `-Y {height} +X {width}\n`
  // - Pixel data: new-style RLE per scanline (4 channels: R, G, B, E)
  //
  // Note: readRenderTargetPixels gives row 0 = bottom of render.
  // HDR -Y orientation: first scanline = top of image.
  // We need to flip rows vertically.

  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(header);

  // Encode pixels into RGBE scanlines (flipped vertically)
  const scanlineData: Uint8Array[] = [];
  for (let row = 0; row < height; row++) {
    // Flip: HDR row 0 = top of image = WebGL row (height - 1)
    const glRow = height - 1 - row;
    const rgbe = new Uint8Array(width * 4);

    for (let col = 0; col < width; col++) {
      const srcIdx = (glRow * width + col) * 4;
      const r = pixels[srcIdx];
      const g = pixels[srcIdx + 1];
      const b = pixels[srcIdx + 2];
      const dstIdx = col * 4;
      floatToRGBE(r, g, b, rgbe, dstIdx);
    }

    scanlineData.push(encodeRGBEScanline(rgbe, width));
  }

  // Calculate total size
  let totalScanlineBytes = 0;
  for (const s of scanlineData) totalScanlineBytes += s.length;

  const buffer = new Uint8Array(headerBytes.length + totalScanlineBytes);
  buffer.set(headerBytes, 0);

  let offset = headerBytes.length;
  for (const s of scanlineData) {
    buffer.set(s, offset);
    offset += s.length;
  }

  return new Blob([buffer], { type: 'image/vnd.radiance' });
}

/**
 * Convert a float RGB triplet to RGBE (Red, Green, Blue, Exponent).
 */
function floatToRGBE(
  r: number,
  g: number,
  b: number,
  out: Uint8Array,
  offset: number,
): void {
  const maxVal = Math.max(r, g, b);

  if (maxVal <= 1e-7) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }

  // Normalize
  const scale = 255.999 / maxVal;
  const rc = Math.min(255, Math.floor(r * scale));
  const gc = Math.min(255, Math.floor(g * scale));
  const bc = Math.min(255, Math.floor(b * scale));

  // Compute shared exponent
  let exponent: number;
  if (maxVal >= 1.0) {
    exponent = Math.ceil(Math.log2(maxVal)) + 128;
  } else {
    exponent = Math.floor(Math.log2(maxVal)) + 128;
  }
  exponent = Math.max(0, Math.min(255, exponent));

  out[offset] = rc;
  out[offset + 1] = gc;
  out[offset + 2] = bc;
  out[offset + 3] = exponent;
}

/**
 * Encode a single scanline (width * 4 bytes of RGBE) using new-style RLE.
 * Format: [2, 2, width_lo, width_hi, channel_data_R, channel_data_G, channel_data_B, channel_data_E]
 */
function encodeRGBEScanline(rgbe: Uint8Array, width: number): Uint8Array {
  // Each channel separately: extract, RLE encode
  const channels: Uint8Array[] = [];
  for (let c = 0; c < 4; c++) {
    const chan = new Uint8Array(width);
    for (let i = 0; i < width; i++) {
      chan[i] = rgbe[i * 4 + c];
    }
    channels.push(rleEncodeChannel(chan));
  }

  // Total size: 4 (header) + sum of channel sizes
  let totalSize = 4;
  for (const ch of channels) totalSize += ch.length;

  const result = new Uint8Array(totalSize);
  // New RLE header
  result[0] = 2;
  result[1] = 2;
  result[2] = width & 0xff;
  result[3] = (width >> 8) & 0xff;

  let offset = 4;
  for (const ch of channels) {
    result.set(ch, offset);
    offset += ch.length;
  }

  return result;
}

/**
 * RLE-encode a single channel (width bytes).
 * Run-length: if count >= 4 identical bytes, write (0x80 | count, value).
 * Literal:   if count < 4 unique bytes, write (count, byte1, byte2, ...).
 */
function rleEncodeChannel(data: Uint8Array): Uint8Array {
  // Worst case: 2x input size (every byte is a literal run of 1)
  const buf: number[] = [];
  let pos = 0;

  while (pos < data.length) {
    // Try to find a run of identical bytes
    let runLen = 1;
    while (
      pos + runLen < data.length &&
      data[pos + runLen] === data[pos] &&
      runLen < 127
    ) {
      runLen++;
    }

    if (runLen >= 4) {
      // Encode as run
      buf.push(0x80 | runLen, data[pos]);
      pos += runLen;
    } else {
      // Encode as literal (non-run)
      const start = pos;
      let litLen = 0;
      while (pos < data.length && litLen < 128) {
        // Check if a run of 4+ starts here
        let r = 1;
        while (
          pos + r < data.length &&
          data[pos + r] === data[pos] &&
          r < 127
        ) {
          r++;
        }
        if (r >= 4) break; // Start a run instead
        pos++;
        litLen++;
      }
      buf.push(litLen);
      for (let i = start; i < start + litLen; i++) {
        buf.push(data[i]);
      }
    }
  }

  return new Uint8Array(buf);
}

// ── OpenEXR Encoding (uncompressed, HALF float, 3 channels) ──────────────────

function encodeEXR(pixels: Float32Array, width: number, height: number): Blob {
  // Build EXR file in a Uint8Array
  // Format: magic(4) + version(4) + header + offset_table + scanline_data

  const channels = ['B', 'G', 'R']; // EXR stores BGR order
  const pixelType = 1; // HALF (16-bit float)
  const bytesPerPixel = 3 * 2; // 3 channels * 2 bytes each

  // ── Header ──────────────────────────────────────────────────────────────
  const headerParts: Uint8Array[] = [];

  // Channels attribute (chlist)
  const channelEntries: Uint8Array[] = [];
  for (const chName of channels) {
    const entry = new Uint8Array(16);
    const nameBytes = new TextEncoder().encode(chName);
    entry.set(nameBytes, 0);
    // Null-terminated name (already zeroed)
    const nameLen = Math.min(nameBytes.length, 15);
    entry[nameLen] = 0; // ensure null terminator
    // pixel type (int32) = 1 (HALF)
    const view = new DataView(entry.buffer, entry.byteOffset);
    view.setInt32(8, pixelType, true);
    // pLinear (4 bytes, must be 0)
    view.setInt32(12, 0, true);
    // xSampling (int32) — but wait, we only have 16 bytes and need xSampling(4) + ySampling(4)
    // Actually the entry is: name\0 + pixelType(4) + pLinear(4) + xSampling(4) + ySampling(4) = variable
    // Let me recalculate. Each entry is: name (null-terminated, padded to 4-byte boundary) + pixelType(4) + pLinear(4) + xSampling(4) + ySampling(4)

    // Rebuild properly
    channelEntries.push(entry);
  }

  // Actually, let me build the header more carefully
  const headerBytes: number[] = [];

  // Helper to write null-terminated string
  const writeString = (str: string) => {
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) headerBytes.push(b);
    headerBytes.push(0); // null terminator
  };

  // Helper to write int32 LE
  const writeInt32 = (val: number) => {
    headerBytes.push(val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff);
  };

  // Helper to write float32 LE
  const writeFloat32 = (val: number) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    const bytes = new Uint8Array(buf);
    for (const b of bytes) headerBytes.push(b);
  };

  // --- channels attribute ---
  writeString('channels');
  writeString('chlist');

  for (const chName of channels) {
    const nameBytes = new TextEncoder().encode(chName);
    for (const b of nameBytes) headerBytes.push(b);
    headerBytes.push(0); // null-terminated name
    // Pad name to 4-byte boundary (including null)
    const nameTotalLen = nameBytes.length + 1;
    const paddedLen = Math.ceil(nameTotalLen / 4) * 4;
    for (let i = nameTotalLen; i < paddedLen; i++) headerBytes.push(0);

    writeInt32(pixelType); // pixel type = HALF
    writeInt32(0);          // pLinear (reserved, must be 0)
    writeInt32(1);          // xSampling
    writeInt32(1);          // ySampling
  }

  // End of channel list: single null byte
  headerBytes.push(0);

  // --- compression attribute ---
  writeString('compression');
  writeString('compression');
  headerBytes.push(0); // no compression (0 = NO_COMPRESSION)
  // Pad to 4-byte boundary (size is 1, pad to 4)
  for (let i = 1; i < 4; i++) headerBytes.push(0);

  // --- dataWindow attribute ---
  writeString('dataWindow');
  writeString('box2i');
  writeInt32(0);        // xMin
  writeInt32(0);        // yMin
  writeInt32(width - 1); // xMax
  writeInt32(height - 1); // yMax

  // --- displayWindow attribute ---
  writeString('displayWindow');
  writeString('box2i');
  writeInt32(0);
  writeInt32(0);
  writeInt32(width - 1);
  writeInt32(height - 1);

  // --- lineOrder attribute ---
  writeString('lineOrder');
  writeString('lineOrder');
  headerBytes.push(0); // INCREASING_Y
  for (let i = 1; i < 4; i++) headerBytes.push(0);

  // --- pixelAspectRatio attribute ---
  writeString('pixelAspectRatio');
  writeString('float');
  writeFloat32(1.0);

  // --- screenWindowCenter attribute ---
  writeString('screenWindowCenter');
  writeString('v2f');
  writeFloat32(0.0);
  writeFloat32(0.0);

  // --- screenWindowWidth attribute ---
  writeString('screenWindowWidth');
  writeString('float');
  writeFloat32(1.0);

  // --- End of header ---
  headerBytes.push(0);

  // Pad header to 8-byte boundary
  while (headerBytes.length % 8 !== 0) {
    headerBytes.push(0);
  }

  const headerSize = headerBytes.length;

  // ── Offset table ────────────────────────────────────────────────────────
  // Each scanline is a separate block (uncompressed)
  const offsetTableSize = height * 8; // uint64 per scanline
  const scanlineDataStart = 8 + headerSize + offsetTableSize; // magic + version + header + offsets

  let currentOffset = scanlineDataStart;
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(currentOffset);
    // Each scanline block: y(4) + data_size(4) + pixel_data(width * 3 * 2)
    currentOffset += 4 + 4 + width * bytesPerPixel;
  }

  // ── Scanline data ───────────────────────────────────────────────────────
  const scanlineBytes: number[] = [];
  for (let y = 0; y < height; y++) {
    // Flip Y: EXR row 0 = bottom of image = WebGL row (height - 1)
    const glRow = height - 1 - y;

    // Y coordinate (int32 LE)
    scanlineBytes.push(y & 0xff, (y >> 8) & 0xff, (y >> 16) & 0xff, (y >> 24) & 0xff);

    // Data size (int32 LE)
    const dataSize = width * bytesPerPixel;
    scanlineBytes.push(dataSize & 0xff, (dataSize >> 8) & 0xff, (dataSize >> 16) & 0xff, (dataSize >> 24) & 0xff);

    // Pixel data: B, G, R as HALF float
    for (let x = 0; x < width; x++) {
      const srcIdx = (glRow * width + x) * 4;
      // B, G, R order for EXR
      const b = pixels[srcIdx + 2];
      const g = pixels[srcIdx + 1];
      const r = pixels[srcIdx];

      const bHalf = float32ToHalf(b);
      const gHalf = float32ToHalf(g);
      const rHalf = float32ToHalf(r);

      scanlineBytes.push(bHalf & 0xff, (bHalf >> 8) & 0xff);
      scanlineBytes.push(gHalf & 0xff, (gHalf >> 8) & 0xff);
      scanlineBytes.push(rHalf & 0xff, (rHalf >> 8) & 0xff);
    }
  }

  // ── Assemble file ───────────────────────────────────────────────────────
  const totalSize = 8 + headerSize + offsetTableSize + scanlineBytes.length;
  const file = new Uint8Array(totalSize);
  const view = new DataView(file.buffer);

  // Magic number: 20000630
  view.setUint32(0, 20000630, true);
  // Version: 2, no flags
  view.setUint32(4, 2, true);

  // Header
  file.set(new Uint8Array(headerBytes), 8);

  // Offset table
  for (let i = 0; i < height; i++) {
    // uint64 LE (stored as two uint32)
    view.setUint32(8 + headerSize + i * 8, offsets[i] & 0xffffffff, true);
    view.setUint32(8 + headerSize + i * 8 + 4, Math.floor(offsets[i] / 0x100000000), true);
  }

  // Scanline data
  file.set(new Uint8Array(scanlineBytes), scanlineDataStart);

  return new Blob([file], { type: 'image/x-exr' });
}

/**
 * Convert a 32-bit IEEE 754 float to 16-bit half-float.
 */
function float32ToHalf(value: number): number {
  const buffer = new ArrayBuffer(4);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  f32[0] = value;
  let x = u32[0];

  const sign = (x >> 16) & 0x8000;
  x = x & 0x7fffffff;

  if (x > 0x477fe000) {
    // Too large → Infinity
    return sign | 0x7c00;
  }
  if (x < 0x33000000) {
    // Too small → Zero
    return sign;
  }
  if (x < 0x38800000) {
    // Denormalized
    const shift = 125 - ((x >> 23) & 0xff);
    x = (x & 0x7fffff) | 0x800000;
    const mantissa = x >> shift;
    return sign | mantissa;
  }

  // Normalized
  let exponent = ((x >> 23) & 0xff) - 127 + 15;
  const mantissa = (x >> 13) & 0x3ff;

  return sign | (exponent << 10) | mantissa;
}

// ── Download helper ──────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
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
  }, 200);
}