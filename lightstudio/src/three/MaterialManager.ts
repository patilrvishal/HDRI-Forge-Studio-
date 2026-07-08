import * as THREE from 'three';
import type { PBRMaterialState, TextureSlotKey } from '../types/MaterialEditor';
import { createPBRMaterialState } from '../types/MaterialEditor';

/**
 * Manages PBR material state synchronization between the Zustand store
 * and the Three.js scene materials.
 */
export class MaterialManager {
  private textureLoader = new THREE.TextureLoader();
  /** Cache of loaded textures: dataUrl → THREE.Texture */
  private textureCache = new Map<string, THREE.Texture>();
  /** Map from material ID to the Three.js material(s) in the scene */
  private materialMap = new Map<string, THREE.MeshStandardMaterial[]>();

  /**
   * Extract all unique MeshStandardMaterial instances from a model.
   * Returns PBRMaterialState[] for the store.
   */
  extractMaterials(model: THREE.Object3D): PBRMaterialState[] {
    this.materialMap.clear();

    const materialGroups = new Map<THREE.Material, { material: THREE.MeshStandardMaterial; meshNames: string[] }>();
    let index = 0;

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        if (!materialGroups.has(mat)) {
          materialGroups.set(mat, { material: mat, meshNames: [] });
        }
        materialGroups.get(mat)!.meshNames.push(child.name || `Mesh_${index++}`);
      }
    });

    const states: PBRMaterialState[] = [];
    let matIndex = 0;

    for (const [, group] of materialGroups) {
      const mat = group.material;
      const state = createPBRMaterialState(matIndex, mat.name, group.meshNames);

      // Read current material properties
      state.color = '#' + mat.color.getHexString();
      state.emissive = '#' + mat.emissive.getHexString();
      state.emissiveIntensity = mat.emissiveIntensity;
      state.roughness = mat.roughness;
      state.metalness = mat.metalness;
      state.opacity = mat.opacity;
      state.transparent = mat.transparent;
      state.doubleSided = mat.side === THREE.DoubleSide;
      state.flatShading = mat.flatShading;
      state.normalScale = mat.normalScale?.x ?? 1;
      state.bumpScale = mat.bumpScale;
      state.aoMapIntensity = mat.aoMapIntensity;

      // Note texture slots (textures are in GPU memory, not serializable as-is)
      // Textures from the model are referenced but not stored as dataUrl
      if (mat.map) {
        state.map = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.normalMap) {
        state.normalMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.roughnessMap) {
        state.roughnessMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.metalnessMap) {
        state.metalnessMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.emissiveMap) {
        state.emissiveMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.aoMap) {
        state.aoMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.bumpMap) {
        state.bumpMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }
      if (mat.alphaMap) {
        state.alphaMap = { enabled: true, dataUrl: null, fileName: '(embedded)' };
      }

      // Store mapping: state.id → [actual Three.js materials]
      this.materialMap.set(state.id, [mat]);

      states.push(state);
      matIndex++;
    }

    return states;
  }

  /**
   * Apply a single material state change to the corresponding Three.js materials.
   */
  applyMaterialState(
    state: PBRMaterialState,
    scene: THREE.Scene,
  ): void {
    const threeMats = this.materialMap.get(state.id);
    if (!threeMats || threeMats.length === 0) {
      // Try to find materials by name in the scene
      const found = this.findMaterialsByName(state.name, scene);
      if (found.length > 0) {
        this.materialMap.set(state.id, found);
      } else {
        return;
      }
    }

    const mats = this.materialMap.get(state.id)!;
    for (const mat of mats) {
      // Properties
      mat.color.set(state.color);
      mat.emissive.set(state.emissive);
      mat.emissiveIntensity = state.emissiveIntensity;
      mat.roughness = state.roughness;
      mat.metalness = state.metalness;
      mat.opacity = state.opacity;
      mat.transparent = state.transparent;
      mat.side = state.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      mat.flatShading = state.flatShading;
      mat.normalScale = new THREE.Vector2(state.normalScale, state.normalScale);
      mat.bumpScale = state.bumpScale;
      mat.aoMapIntensity = state.aoMapIntensity;
      mat.needsUpdate = true;

      // Textures (only apply user-uploaded textures, don't override embedded ones)
      const slotKeys: TextureSlotKey[] = [
        'map', 'normalMap', 'roughnessMap', 'metalnessMap',
        'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap',
      ];
      for (const slotKey of slotKeys) {
        const slot = state[slotKey];
        if (slot.enabled && slot.dataUrl) {
          this.loadTextureAsync(slot.dataUrl).then((texture) => {
            if (!texture) return;
            // Assign texture wrap and color space
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = slotKey === 'map' || slotKey === 'emissiveMap'
              ? THREE.SRGBColorSpace
              : THREE.LinearSRGBColorSpace;
            texture.needsUpdate = true;
            // Re-read mat from map in case it changed
            const currentMats = this.materialMap.get(state.id);
            if (currentMats) {
              for (const m of currentMats) {
                m[slotKey] = texture;
                m.needsUpdate = true;
              }
            }
          });
        }
      }
    }
  }

  /**
   * Find materials in the scene by name.
   */
  private findMaterialsByName(name: string, scene: THREE.Scene): THREE.MeshStandardMaterial[] {
    const found: THREE.MeshStandardMaterial[] = [];
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial && mat.name === name) {
          found.push(mat);
        }
      }
    });
    return found;
  }

  /**
   * Load a texture from a data URL asynchronously.
   * Returns a cached texture if available.
   */
  private loadTextureAsync(dataUrl: string): Promise<THREE.Texture | null> {
    if (this.textureCache.has(dataUrl)) {
      return Promise.resolve(this.textureCache.get(dataUrl)!);
    }

    return new Promise((resolve) => {
      this.textureLoader.load(
        dataUrl,
        (tex) => {
          this.textureCache.set(dataUrl, tex);
          resolve(tex);
        },
        undefined,
        () => {
          resolve(null);
        },
      );
    });
  }

  /**
   * Rebuild the material map after a model is loaded.
   * Call this after the model is added to the scene.
   */
  rebuildMaterialMap(scene: THREE.Scene, materialStates: PBRMaterialState[]): void {
    this.materialMap.clear();

    // Collect all MeshStandardMaterials from the scene
    const sceneMaterials: THREE.MeshStandardMaterial[] = [];
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          sceneMaterials.push(mat);
        }
      }
    });

    // Match by name
    for (const state of materialStates) {
      const matches = sceneMaterials.filter((m) => m.name === state.name);
      if (matches.length > 0) {
        this.materialMap.set(state.id, matches);
      }
    }
  }

  dispose(): void {
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
    this.materialMap.clear();
  }
}