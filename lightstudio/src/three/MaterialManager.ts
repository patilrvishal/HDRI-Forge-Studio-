import * as THREE from 'three';
import type { PBRMaterialState, TextureSlotKey } from '../types/MaterialEditor';
import { createPBRMaterialState } from '../types/MaterialEditor';

/**
 * Manages PBR material state synchronization between the Zustand store
 * and the Three.js scene materials.
 * Supports both MeshStandardMaterial and MeshPhysicalMaterial.
 */
export class MaterialManager {
  private textureLoader = new THREE.TextureLoader();
  /** Cache of loaded textures: dataUrl → THREE.Texture */
  private textureCache = new Map<string, THREE.Texture>();
  /** Map from material ID to the Three.js material(s) in the scene */
  private materialMap = new Map<string, THREE.MeshStandardMaterial[]>();

  /**
   * Extract all unique MeshStandard/MeshPhysical materials from a model.
   * Returns PBRMaterialState[] for the store.
   */
  extractMaterials(model: THREE.Object3D): PBRMaterialState[] {
    this.materialMap.clear();

    const materialGroups = new Map<THREE.Material, { material: THREE.MeshStandardMaterial; meshNames: string[]; isPhysical: boolean }>();
    let index = 0;

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        const isPhysical = mat instanceof THREE.MeshPhysicalMaterial;
        const isStandard = mat instanceof THREE.MeshStandardMaterial;
        if (!isStandard && !isPhysical) continue;

        const stdMat = mat as THREE.MeshStandardMaterial;
        if (!materialGroups.has(mat)) {
          materialGroups.set(mat, { material: stdMat, meshNames: [], isPhysical });
        }
        materialGroups.get(mat)!.meshNames.push(child.name || `Mesh_${index++}`);
      }
    });

    const states: PBRMaterialState[] = [];
    let matIndex = 0;

    for (const [, group] of materialGroups) {
      const mat = group.material;
      const isPhys = mat instanceof THREE.MeshPhysicalMaterial;
      const state = createPBRMaterialState(matIndex, mat.name, group.meshNames);

      // Read standard material properties
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

      // Read physical material properties if applicable
      if (isPhys) {
        const pm = mat as THREE.MeshPhysicalMaterial;
        state.isPhysical = true;
        state.clearcoat = pm.clearcoat;
        state.clearcoatRoughness = pm.clearcoatRoughness;
        state.transmission = pm.transmission;
        state.transmissionRoughness = pm.transmissionRoughness;
        state.thickness = pm.thickness;
        state.ior = pm.ior;
        state.sheen = pm.sheen;
        state.sheenRoughness = pm.sheenRoughness;
        state.sheenColor = '#' + pm.sheenColor.getHexString();
        state.iridescence = pm.iridescence;
        state.iridescenceIOR = pm.iridescenceIOR;
        state.iridescenceThicknessRange = [pm.iridescenceThicknessRange[0], pm.iridescenceThicknessRange[1]];
        state.attenuationColor = '#' + pm.attenuationColor.getHexString();
        state.attenuationDistance = pm.attenuationDistance === Infinity ? Infinity : pm.attenuationDistance;
        state.specularIntensity = pm.specularIntensity;
        state.specularColor = '#' + pm.specularColor.getHexString();
      }

      // Note texture slots
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
   * Check if a material state has any non-default physical properties.
   */
  private hasPhysicalProperties(state: PBRMaterialState): boolean {
    return (
      state.clearcoat > 0 ||
      state.clearcoatRoughness > 0 ||
      state.transmission > 0 ||
      state.transmissionRoughness > 0 ||
      state.thickness > 0 ||
      state.ior !== 1.5 ||
      state.sheen > 0 ||
      state.sheenRoughness > 0 ||
      state.sheenColor !== '#000000' ||
      state.iridescence > 0 ||
      state.iridescenceIOR !== 1.3 ||
      (state.iridescenceThicknessRange[0] !== 100 || state.iridescenceThicknessRange[1] !== 400) ||
      state.attenuationColor !== '#ffffff' ||
      state.attenuationDistance !== Infinity ||
      state.specularIntensity !== 1 ||
      state.specularColor !== '#ffffff' ||
      state.isPhysical
    );
  }

  /**
   * Upgrade a MeshStandardMaterial to MeshPhysicalMaterial, preserving all properties.
   */
  private upgradeToPhysical(mat: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const phys = new THREE.MeshPhysicalMaterial();

    // Copy all standard properties
    phys.name = mat.name;
    phys.color.copy(mat.color);
    phys.emissive.copy(mat.emissive);
    phys.emissiveIntensity = mat.emissiveIntensity;
    phys.roughness = mat.roughness;
    phys.metalness = mat.metalness;
    phys.opacity = mat.opacity;
    phys.transparent = mat.transparent;
    phys.side = mat.side;
    phys.flatShading = mat.flatShading;
    phys.normalScale.copy(mat.normalScale);
    phys.bumpScale = mat.bumpScale;
    phys.aoMapIntensity = mat.aoMapIntensity;

    // Copy textures
    phys.map = mat.map;
    phys.normalMap = mat.normalMap;
    phys.roughnessMap = mat.roughnessMap;
    phys.metalnessMap = mat.metalnessMap;
    phys.emissiveMap = mat.emissiveMap;
    phys.aoMap = mat.aoMap;
    phys.bumpMap = mat.bumpMap;
    phys.alphaMap = mat.alphaMap;

    // Copy other common properties
    phys.alphaTest = mat.alphaTest;
    phys.alphaHash = (mat as any).alphaHash ?? false;
    phys.blendDst = mat.blendDst;
    phys.blendDstAlpha = mat.blendDstAlpha;
    phys.blendEquation = mat.blendEquation;
    phys.blendEquationAlpha = mat.blendEquationAlpha;
    phys.blendSrc = mat.blendSrc;
    phys.blendSrcAlpha = mat.blendSrcAlpha;
    phys.blending = mat.blending;
    phys.clipShadows = mat.clipShadows;
    phys.clippingPlanes = mat.clippingPlanes;
    phys.clipIntersection = mat.clipIntersection;
    phys.colorWrite = mat.colorWrite;
    phys.depthWrite = mat.depthWrite;
    phys.forceSinglePass = (mat as any).forceSinglePass ?? true;
    phys.stencilWrite = mat.stencilWrite;
    phys.stencilWriteMask = mat.stencilWriteMask;
    phys.stencilFunc = mat.stencilFunc;
    phys.stencilRef = mat.stencilRef;
    phys.stencilFuncMask = mat.stencilFuncMask;
    phys.stencilFail = mat.stencilFail;
    phys.stencilZFail = mat.stencilZFail;
    phys.stencilZPass = mat.stencilZPass;
    phys.visible = mat.visible;
    phys.toneMapped = mat.toneMapped;
    phys.userData = mat.userData;
    phys.envMap = mat.envMap;
    phys.envMapIntensity = mat.envMapIntensity;

    // If the old material had an envMapIntensity set, preserve it
    if ('envMapIntensity' in mat) {
      phys.envMapIntensity = (mat as any).envMapIntensity;
    }

    phys.needsUpdate = true;

    // Replace the material on all meshes in the scene
    this.replaceMaterialInMap(mat, phys);

    return phys;
  }

  /**
   * Replace all references to oldMat with newMat in the materialMap.
   */
  private replaceMaterialInMap(oldMat: THREE.MeshStandardMaterial, newMat: THREE.MeshPhysicalMaterial): void {
    for (const [id, mats] of this.materialMap.entries()) {
      const idx = mats.indexOf(oldMat);
      if (idx !== -1) {
        mats[idx] = newMat;
        // Also swap the actual material on all scene meshes
        this.swapMaterialOnMeshes(oldMat, newMat);
      }
    }
  }

  /**
   * Swap a material reference on all meshes in the scene that use oldMat.
   */
  private swapMaterialOnMeshes(oldMat: THREE.Material, newMat: THREE.Material): void {
    // This is called via scene traversal in applyMaterialState
    // We store the swap intent and execute it there
    this._pendingSwap = { old: oldMat, new: newMat };
  }

  private _pendingSwap: { old: THREE.Material; new: THREE.Material } | null = null;

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

    // Check if we need to upgrade any material to Physical
    const needsPhysical = this.hasPhysicalProperties(state);
    const mats = this.materialMap.get(state.id)!;

    for (let i = 0; i < mats.length; i++) {
      let mat = mats[i];

      // Upgrade standard → physical if needed
      if (needsPhysical && !(mat instanceof THREE.MeshPhysicalMaterial)) {
        const physMat = this.upgradeToPhysical(mat);
        // Swap on scene meshes
        this.swapMaterialOnScene(scene, mat, physMat);
        mats[i] = physMat;
        mat = physMat;
      }
      // Downgrade physical → standard if no physical props remain
      // (We keep it as physical to avoid data loss — user might re-enable)

      // Apply standard properties
      mat.color.set(state.color);
      mat.emissive.set(state.emissive);
      mat.emissiveIntensity = state.emissiveIntensity;
      mat.roughness = state.roughness;
      mat.metalness = state.metalness;
      mat.opacity = state.opacity;
      mat.transparent = state.transparent || state.transmission > 0;
      mat.side = state.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      mat.flatShading = state.flatShading;
      mat.normalScale = new THREE.Vector2(state.normalScale, state.normalScale);
      mat.bumpScale = state.bumpScale;
      mat.aoMapIntensity = state.aoMapIntensity;

      // Apply physical properties if material is MeshPhysicalMaterial
      if (mat instanceof THREE.MeshPhysicalMaterial) {
        mat.clearcoat = state.clearcoat;
        mat.clearcoatRoughness = state.clearcoatRoughness;
        mat.transmission = state.transmission;
        mat.transmissionRoughness = state.transmissionRoughness;
        mat.thickness = state.thickness;
        mat.ior = state.ior;
        mat.sheen = state.sheen;
        mat.sheenRoughness = state.sheenRoughness;
        mat.sheenColor.set(state.sheenColor);
        mat.iridescence = state.iridescence;
        mat.iridescenceIOR = state.iridescenceIOR;
        mat.iridescenceThicknessRange = new THREE.Vector2(state.iridescenceThicknessRange[0], state.iridescenceThicknessRange[1]);
        mat.attenuationColor.set(state.attenuationColor);
        mat.attenuationDistance = state.attenuationDistance === Infinity ? Infinity : state.attenuationDistance;
        mat.specularIntensity = state.specularIntensity;
        mat.specularColor.set(state.specularColor);
      }

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
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = slotKey === 'map' || slotKey === 'emissiveMap'
              ? THREE.SRGBColorSpace
              : THREE.LinearSRGBColorSpace;
            texture.needsUpdate = true;
            const currentMats = this.materialMap.get(state.id);
            if (currentMats) {
              for (const m of currentMats) {
                (m as any)[slotKey] = texture;
                m.needsUpdate = true;
              }
            }
          });
        }
      }
    }
  }

  /**
   * Swap material on all scene meshes that reference oldMat.
   */
  private swapMaterialOnScene(scene: THREE.Scene, oldMat: THREE.Material, newMat: THREE.Material): void {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      let changed = false;
      const newMats = mats.map((m) => {
        if (m === oldMat) {
          changed = true;
          return newMat;
        }
        return m;
      });
      if (changed) {
        child.material = newMats.length === 1 ? newMats[0] : newMats;
      }
    });
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
        if ((mat instanceof THREE.MeshStandardMaterial) && mat.name === name) {
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