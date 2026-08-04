/**
 * PBR Material Editor types.
 * Mirrors Three.js MeshStandardMaterial + MeshPhysicalMaterial properties for UI editing.
 */

export interface MaterialTextureSlot {
  /** Whether a texture is assigned */
  enabled: boolean;
  /** Base64 data URL of the texture image, or null */
  dataUrl: string | null;
  /** Original file name */
  fileName: string;
}

export interface PBRMaterialState {
  /** Unique ID (auto-generated from material index) */
  id: string;
  /** Original material name from the 3D model */
  name: string;
  /** Names of meshes that use this material */
  meshNames: string[];

  // ── PBR Properties (MeshStandardMaterial) ──────────────────────────
  /** Base color (hex string) */
  color: string;
  /** Emissive color (hex string) */
  emissive: string;
  /** Emissive intensity */
  emissiveIntensity: number;
  /** Roughness (0 = mirror, 1 = fully rough) */
  roughness: number;
  /** Metalness (0 = dielectric, 1 = metal) */
  metalness: number;
  /** Opacity (0 = invisible, 1 = opaque) */
  opacity: number;
  /** Whether the material is transparent */
  transparent: boolean;
  /** Whether the material is double-sided */
  doubleSided: boolean;
  /** Flat shading */
  flatShading: boolean;

  // ── Texture Slots ──────────────────────────────────────────────────
  /** Base color / Albedo map */
  map: MaterialTextureSlot;
  /** Normal map */
  normalMap: MaterialTextureSlot;
  /** Roughness map */
  roughnessMap: MaterialTextureSlot;
  /** Metalness map */
  metalnessMap: MaterialTextureSlot;
  /** Emissive map */
  emissiveMap: MaterialTextureSlot;
  /** Ambient Occlusion map */
  aoMap: MaterialTextureSlot;
  /** Baked lightmap - requires the mesh to have a second UV channel (uv2) */
  lightMap: MaterialTextureSlot;
  /** Bump map */
  bumpMap: MaterialTextureSlot;
  /** Alpha map (for cutout transparency) */
  alphaMap: MaterialTextureSlot;

  // ── Advanced (MeshStandardMaterial) ────────────────────────────────
  /** Normal map intensity (0-2, default 1) */
  normalScale: number;
  /** Bump map intensity */
  bumpScale: number;
  /** AO map intensity */
  aoMapIntensity: number;
  /** Lightmap intensity */
  lightMapIntensity: number;

  // ── Physical Material Properties (MeshPhysicalMaterial) ────────────
  /** Whether this material uses physical (extended PBR) properties */
  isPhysical: boolean;
  /** Clearcoat: thin reflective coating (0 = none, 1 = full) */
  clearcoat: number;
  /** Clearcoat roughness (0 = mirror, 1 = rough) */
  clearcoatRoughness: number;
  /** Transmission: light transmission for glass-like materials (0 = opaque, 1 = fully transparent) */
  transmission: number;
  /** Transmission roughness: blurs the view through the material (0 = clear, 1 = frosted) */
  transmissionRoughness: number;
  /** Thickness: volume thickness for transmission (default 0) */
  thickness: number;
  /** Index of refraction (default 1.5) */
  ior: number;
  /** Sheen: fabric-like scattering (0 = none, 1 = full) */
  sheen: number;
  /** Sheen roughness (0 = silk, 1 = cotton) */
  sheenRoughness: number;
  /** Sheen color (hex string) */
  sheenColor: string;
  /** Iridescence: rainbow-like effect (0 = none, 1 = full) */
  iridescence: number;
  /** Iridescence IOR (default 1.3) */
  iridescenceIOR: number;
  /** Iridescence thickness range [min, max] in nm */
  iridescenceThicknessRange: [number, number];
  /** Attenuation color for transmission volume (hex string) */
  attenuationColor: string;
  /** Attenuation distance for transmission volume (default Infinity) */
  attenuationDistance: number;
  /** Specular intensity (0 = no reflection, 1 = full) */
  specularIntensity: number;
  /** Specular color (hex string) */
  specularColor: string;

  // ── Displacement / Carpet / Fabric Properties ─────────────────────
  /** Displacement map for surface detail (carpet pile, fabric weave) */
  displacementMap: MaterialTextureSlot;
  /** Displacement map intensity (0-5, default 0) */
  displacementScale: number;
  /** Displacement bias (default 0) */
  displacementBias: number;
  /** Environment map intensity (0-5, default 1). Key for carpet: reduces env reflections */
  envMapIntensity: number;
  /** Alpha test threshold (0-1, default 0). For cutout transparency */
  alphaTest: number;
  /** Depth write (default true). Disable for transparent carpets */
  depthWrite: boolean;
  /** Color write (default true) */
  colorWrite: boolean;
}

export type TextureSlotKey = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'emissiveMap' | 'aoMap' | 'lightMap' | 'bumpMap' | 'alphaMap' | 'displacementMap';

export const TEXTURE_SLOT_LABELS: Record<TextureSlotKey, string> = {
  map: 'Albedo',
  normalMap: 'Normal',
  roughnessMap: 'Roughness',
  metalnessMap: 'Metalness',
  emissiveMap: 'Emissive',
  aoMap: 'AO',
  lightMap: 'Lightmap',
  bumpMap: 'Bump',
  alphaMap: 'Alpha',
  displacementMap: 'Displacement',
};

/** Texture slots that sample the mesh's second UV channel (uv2) instead of the primary UVs. */
export const UV2_TEXTURE_SLOTS: ReadonlySet<TextureSlotKey> = new Set(['aoMap', 'lightMap']);

export function createEmptyTextureSlot(): MaterialTextureSlot {
  return { enabled: false, dataUrl: null, fileName: '' };
}

export function createPBRMaterialState(
  index: number,
  name: string,
  meshNames: string[],
): PBRMaterialState {
  return {
    id: `mat_${index}_${Date.now()}`,
    name: name || `Material ${index + 1}`,
    meshNames,
    color: '#cccccc',
    emissive: '#000000',
    emissiveIntensity: 1,
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    doubleSided: false,
    flatShading: false,
    map: createEmptyTextureSlot(),
    normalMap: createEmptyTextureSlot(),
    roughnessMap: createEmptyTextureSlot(),
    metalnessMap: createEmptyTextureSlot(),
    emissiveMap: createEmptyTextureSlot(),
    aoMap: createEmptyTextureSlot(),
    lightMap: createEmptyTextureSlot(),
    bumpMap: createEmptyTextureSlot(),
    alphaMap: createEmptyTextureSlot(),
    normalScale: 1,
    bumpScale: 1,
    aoMapIntensity: 1,
    lightMapIntensity: 1,
    // Physical material defaults
    isPhysical: false,
    clearcoat: 0,
    clearcoatRoughness: 0,
    transmission: 0,
    transmissionRoughness: 0,
    thickness: 0,
    ior: 1.5,
    sheen: 0,
    sheenRoughness: 0,
    sheenColor: '#000000',
    iridescence: 0,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    attenuationColor: '#ffffff',
    attenuationDistance: Infinity,
    specularIntensity: 1,
    specularColor: '#ffffff',
    // Displacement / Carpet / Fabric defaults
    displacementMap: createEmptyTextureSlot(),
    displacementScale: 0,
    displacementBias: 0,
    envMapIntensity: 1,
    alphaTest: 0,
    depthWrite: true,
    colorWrite: true,
  };
}