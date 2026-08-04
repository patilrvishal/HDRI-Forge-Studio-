/**
 * Loader for the proprietary .erik format (exported by the Erik texture/mesh
 * converter tool). The format is undocumented, so this parser was built by
 * reverse-engineering the binary layout and verifying every decoded attribute
 * against ground-truth bounding boxes embedded in the file's own metadata:
 *
 *  [8-byte header: u32 texIndexJsonLen, u32 unused]
 *  [texIndexJsonLen bytes: small JSON manifest of 4 texture layers packed
 *   into the following section, each as its own standalone KTX2 file]
 *  [KTX2 texture layers: albedo_base, normal_base, rmcccr_base, light_map]
 *  [gzip-compressed blob containing:
 *     - a JSON metadata object (self-terminating - found via brace matching)
 *     - immediately followed by a raw binary buffer holding per-mesh
 *       geometry, encoded with meshoptimizer (the same scheme used by
 *       glTF's EXT_meshopt_compression)]
 *
 * Geometry attribute encoding (verified against declared bounding boxes):
 *  - position: meshopt vertex buffer, stride 8 bytes/vertex (4x uint16 LE,
 *    only the first 3 used), dequantized as min + (raw / (2^bits-1)) * (max-min)
 *  - uv1/uv2: meshopt vertex buffer, stride 4 bytes/vertex (2x uint16 LE),
 *    same dequantization formula
 *  - normal: meshopt vertex buffer with the OCTAHEDRAL filter, stride 4
 *    bytes/vertex (4x int8, first 3 used), each axis is byte/127
 *  - index: meshopt index buffer (TRIANGLES mode), 4 bytes/index
 *
 * Skinning (skin_index/skin_weight), bones, and animations are present in
 * the format but intentionally NOT decoded here - this is a static
 * mesh+texture importer only.
 */
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as fflate from 'fflate';

interface ErikAtlasEntry {
  x: number;
  y: number;
  scale: number;
  repeatX: number;
  repeatY: number;
}

interface ErikQuantizeVertex {
  min: number[];
  max: number[];
  bits: number;
  count_per_vertex: number;
  meshopt_bit_size: number;
}

interface ErikAttr {
  byte_start: number;
  byte_end: number;
  byte_length: number;
  attr_type: string;
  quantize_vertex: ErikQuantizeVertex | null;
  quantize_normal: { bits: number } | null;
}

interface ErikMeshInfo {
  mesh_name: string;
  vertex_count: number;
  index_count: number;
  got_data: boolean;
  got_uv2: boolean;
  bounding_box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  position: ErikAttr;
  normal: ErikAttr;
  uv1: ErikAttr;
  uv2: ErikAttr;
  mma: ErikAttr;
  skin_index: ErikAttr;
  skin_weight: ErikAttr;
  index: ErikAttr;
}

interface ErikMaterialEntry {
  name: string;
  /** Names of the texture layers this material samples from, not a UV transform. */
  atlas: string[];
}

interface ErikMetadata {
  data: {
    org_materials: string[];
    org_meshes: string[];
    binary_info: ErikMeshInfo[];
    erik_materials: ErikMaterialEntry[];
    mesh_groups: Record<string, string[]>;
    atlas_base: ErikAtlasEntry[];
    atlas_ao: Array<{ x: number; y: number; width: number; height: number }>;
    version: string;
  };
}

interface TexIndexEntry {
  name: string;
  start: number;
  end: number;
  length: number;
  size: number;
}

/** Find the byte offset of the first gzip magic (0x1f 0x8b) at or after `from`. */
function findGzipStart(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === 0x1f && buf[i + 1] === 0x8b) return i;
  }
  throw new Error('No gzip-compressed metadata block found in .erik file');
}

/**
 * Find where the NEXT gzip member starts after `from`, tolerant of false
 * 0x1f8b matches inside a preceding member's own compressed bytes (which are
 * high-entropy and frequently contain that 2-byte sequence by coincidence).
 * The compressed length of the preceding member isn't recorded anywhere in
 * the format, so each magic-byte candidate is verified by actually attempting
 * to decompress from there - a false match will fail fflate's gzip/deflate
 * validation almost immediately, while the real boundary decodes cleanly.
 */
function findNextGzipMemberStart(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] !== 0x1f || buf[i + 1] !== 0x8b) continue;
    try {
      fflate.gunzipSync(buf.subarray(i));
      return i;
    } catch {
      // Not a real member boundary - keep searching.
    }
  }
  throw new Error('No second gzip member found in .erik file');
}

/**
 * Decompress a gzip member, tolerating trailing bytes after it (the .erik
 * file's gzip section is followed by no further data in principle, but the
 * browser's native DecompressionStream is strict about trailing bytes and
 * throws "Junk found after end of compressed data" here - fflate's decoder
 * matches Node zlib's leniency, which is what the format actually needs).
 */
function gunzip(data: Uint8Array): Uint8Array {
  return fflate.gunzipSync(data);
}

/** Dequantize a meshopt-decoded vertex buffer of uint16 lanes into float components. */
function dequantizeUint16(
  decoded: Uint8Array,
  count: number,
  stride: number,
  numComponents: number,
  bits: number,
  min: number[],
  max: number[],
): Float32Array {
  const dv = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const divisor = (1 << bits) - 1;
  const out = new Float32Array(count * numComponents);
  for (let v = 0; v < count; v++) {
    for (let c = 0; c < numComponents; c++) {
      const raw = dv.getUint16(v * stride + c * 2, true);
      const t = raw / divisor;
      out[v * numComponents + c] = min[c] + t * (max[c] - min[c]);
    }
  }
  return out;
}

/** Decode an octahedral-filtered meshopt normal buffer (stride 4, int8 x,y,z,_) into unit normals. */
function decodeOctNormals(decoded: Uint8Array, count: number): Float32Array {
  const view = new Int8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const out = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    out[v * 3 + 0] = view[v * 4 + 0] / 127;
    out[v * 3 + 1] = view[v * 4 + 1] / 127;
    out[v * 3 + 2] = view[v * 4 + 2] / 127;
  }
  return out;
}

export interface ErikLoadResult {
  group: THREE.Group;
  materialNames: string[];
}

export class ErikLoader {
  private _scene: THREE.Scene;
  private _renderer: THREE.WebGLRenderer;
  private _ktx2Loader: KTX2Loader | null = null;
  private _currentModel: THREE.Group | null = null;

  private _onProgress: ((progress: number) => void) | null = null;
  private _onLoaded: ((name: string) => void) | null = null;
  private _onError: ((error: string) => void) | null = null;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this._scene = scene;
    this._renderer = renderer;
  }

  setCallbacks(callbacks: {
    onProgress?: (progress: number) => void;
    onLoaded?: (name: string) => void;
    onError?: (error: string) => void;
  }): void {
    this._onProgress = callbacks.onProgress ?? null;
    this._onLoaded = callbacks.onLoaded ?? null;
    this._onError = callbacks.onError ?? null;
  }

  getCurrentModel(): THREE.Group | null {
    return this._currentModel;
  }

  private _getKTX2Loader(): KTX2Loader {
    if (!this._ktx2Loader) {
      const loader = new KTX2Loader();
      loader.setTranscoderPath('/basis/');
      loader.detectSupport(this._renderer);
      this._ktx2Loader = loader;
    }
    return this._ktx2Loader;
  }

  private _removeCurrentModel(): void {
    if (this._currentModel) {
      this._scene.remove(this._currentModel);
      this._currentModel.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m?.dispose();
        }
      });
      this._currentModel = null;
    }
  }

  async loadFromFile(file: File): Promise<void> {
    this._onProgress?.(0);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const result = await this._parse(buf);
      this._onProgress?.(90);

      this._removeCurrentModel();
      this._currentModel = result.group;
      this._scene.add(result.group);

      result.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Center and scale to match the GLB import pipeline's convention.
      const box = new THREE.Box3().setFromObject(result.group);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        result.group.scale.multiplyScalar(4 / maxDim);
      }
      const box2 = new THREE.Box3().setFromObject(result.group);
      const center2 = box2.getCenter(new THREE.Vector3());
      result.group.position.sub(center2);
      result.group.position.y += box2.getSize(new THREE.Vector3()).y / 2;

      this._onProgress?.(100);
      this._onLoaded?.(file.name.replace(/\.erik$/i, ''));
    } catch (err) {
      console.error('[ErikLoader] load failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to load .erik file';
      this._onError?.(msg);
    }
  }

  private async _parse(buf: Uint8Array): Promise<ErikLoadResult> {
    if (buf.length < 8) throw new Error('File too small to be a valid .erik file');

    const headerView = new DataView(buf.buffer, buf.byteOffset, 8);
    const texIndexLen = headerView.getUint32(0, true);

    const texIndexJson = new TextDecoder().decode(buf.subarray(8, 8 + texIndexLen));
    const texIndex: { data: TexIndexEntry[] } = JSON.parse(texIndexJson);

    const texturesSectionStart = 8 + texIndexLen;

    // Slice out each texture layer as its own standalone KTX2 file and decode.
    const ktx2Loader = this._getKTX2Loader();
    const textures: Record<string, THREE.Texture | null> = {};
    let lastTexEnd = 0;
    for (const entry of texIndex.data) {
      lastTexEnd = Math.max(lastTexEnd, entry.end);
      const layerBytes = buf.subarray(texturesSectionStart + entry.start, texturesSectionStart + entry.end);
      try {
        textures[entry.name] = await this._decodeKTX2Layer(ktx2Loader, layerBytes);
      } catch (e) {
        console.warn(`[ErikLoader] Failed to decode texture layer "${entry.name}":`, e);
        textures[entry.name] = null;
      }
    }
    this._onProgress?.(50);

    // Metadata JSON and the geometry buffer are two SEPARATE, back-to-back
    // gzip members (not one stream) - fflate/DecompressionStream both only
    // decode the first member of a concatenated stream, which is how this
    // split was discovered (member 1 decompressed to exactly the JSON's
    // length, with a second 0x1f 0x8b magic immediately following it).
    const member1Start = findGzipStart(buf, texturesSectionStart + lastTexEnd);
    const meta: ErikMetadata = JSON.parse(new TextDecoder().decode(gunzip(buf.subarray(member1Start))));

    const member2Start = findNextGzipMemberStart(buf, member1Start + 2);
    const geomBuf = gunzip(buf.subarray(member2Start));
    this._onProgress?.(65);

    // Shared PBR material sampling from the atlas textures. UVs are remapped
    // per-mesh into atlas space below, so one material can serve every mesh.
    const sharedMaterial = new THREE.MeshStandardMaterial({
      name: 'erik_atlas_material',
      map: textures.albedo_base ?? null,
      normalMap: textures.normal_base ?? null,
      roughnessMap: textures.rmcccr_base ?? null,
      metalnessMap: textures.rmcccr_base ?? null,
      aoMap: textures.rmcccr_base ?? null,
      roughness: 1,
      metalness: 1,
    });
    if (textures.light_map) {
      sharedMaterial.lightMap = textures.light_map;
      sharedMaterial.lightMapIntensity = 1;
    }

    const group = new THREE.Group();
    group.name = 'erik_model';
    // Source geometry is Z-up (per-mesh bounding boxes show Z spanning the
    // car's height, X spanning its length) - three.js is Y-up.
    group.rotation.x = -Math.PI / 2;

    for (const meshInfo of meta.data.binary_info) {
      if (!meshInfo.got_data) continue;
      const mesh = this._buildMesh(meshInfo, geomBuf, sharedMaterial.clone());
      if (mesh) group.add(mesh);
    }

    return { group, materialNames: meta.data.org_materials };
  }

  private async _decodeKTX2Layer(loader: KTX2Loader, bytes: Uint8Array): Promise<THREE.Texture> {
    // KTX2Loader has no parse(buffer) API in this three.js version - it only
    // has parse()'s empty base-class stub (silently does nothing, never
    // settles) plus load(url, ...). Route the slice through a blob URL.
    const owned = bytes.slice();
    const url = URL.createObjectURL(new Blob([owned], { type: 'image/ktx2' }));
    try {
      return await new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private _buildMesh(
    info: ErikMeshInfo,
    geomBuf: Uint8Array,
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh | null {
    const n = info.vertex_count;
    if (n === 0) return null;

    const geometry = new THREE.BufferGeometry();

    // --- position (stride 8, 3 of 4 uint16 lanes used) ---
    {
      const attr = info.position;
      const q = attr.quantize_vertex!;
      const source = geomBuf.subarray(attr.byte_start, attr.byte_end);
      const decoded = new Uint8Array(n * 8);
      MeshoptDecoder.decodeVertexBuffer(decoded, n, 8, source, 'NONE');
      const positions = dequantizeUint16(decoded, n, 8, 3, q.bits, q.min, q.max);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }

    // --- normal (stride 4, octahedral-filtered int8) ---
    if (info.normal.byte_length > 0) {
      const attr = info.normal;
      const source = geomBuf.subarray(attr.byte_start, attr.byte_end);
      const decoded = new Uint8Array(n * 4);
      MeshoptDecoder.decodeVertexBuffer(decoded, n, 4, source, 'OCTAHEDRAL');
      const normals = decodeOctNormals(decoded, n);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    }

    // --- uv1 (stride 4, 2x uint16) ---
    let uv1: Float32Array | null = null;
    if (info.uv1.byte_length > 0) {
      const attr = info.uv1;
      const q = attr.quantize_vertex!;
      const source = geomBuf.subarray(attr.byte_start, attr.byte_end);
      const decoded = new Uint8Array(n * 4);
      MeshoptDecoder.decodeVertexBuffer(decoded, n, 4, source, 'NONE');
      uv1 = dequantizeUint16(decoded, n, 4, 2, q.bits, q.min, q.max);
    }

    // --- uv2 (stride 4, 2x uint16) - used for lightmap/AO sampling ---
    if (info.got_uv2 && info.uv2.byte_length > 0) {
      const attr = info.uv2;
      const q = attr.quantize_vertex!;
      const source = geomBuf.subarray(attr.byte_start, attr.byte_end);
      const decoded = new Uint8Array(n * 4);
      MeshoptDecoder.decodeVertexBuffer(decoded, n, 4, source, 'NONE');
      const uv2 = dequantizeUint16(decoded, n, 4, 2, q.bits, q.min, q.max);
      geometry.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));
    }

    // uv1 is already authored in the shared atlas's texture space - each
    // material's "atlas" field is just the list of texture layers it reads
    // from (e.g. ["light_map","albedo_base",...]), not a per-mesh UV
    // transform, so uv1 is used directly as the primary UV set.
    if (uv1) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv1, 2));
    }

    // --- index (meshopt index buffer, 4 bytes/index) ---
    if (info.index.byte_length > 0) {
      const attr = info.index;
      const source = geomBuf.subarray(attr.byte_start, attr.byte_end);
      const indices = new Uint32Array(info.index_count);
      MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), info.index_count, 4, source);
      // Defensive: meshopt's format for the index stream wasn't verified as
      // rigorously as position/uv/normal - guard against out-of-range values
      // rather than letting Three.js throw deep inside the renderer.
      let valid = true;
      for (let i = 0; i < indices.length; i++) {
        if (indices[i] >= n) { valid = false; break; }
      }
      if (valid) {
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      } else {
        console.warn(`[ErikLoader] Mesh "${info.mesh_name}" has out-of-range indices - rendering unindexed`);
      }
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = info.mesh_name;
    material.name = info.mesh_name;
    return mesh;
  }

  dispose(): void {
    this._removeCurrentModel();
    this._ktx2Loader?.dispose();
    this._ktx2Loader = null;
  }
}
