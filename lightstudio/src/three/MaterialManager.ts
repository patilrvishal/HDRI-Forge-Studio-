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
   * Per-mesh material clones created when a mesh needs its own AO/Lightmap
   * that differs from the material's shared one (materialId -> meshName ->
   * that mesh's own cloned material instance).
   */
  private perMeshOverrideMap = new Map<string, Map<string, THREE.MeshStandardMaterial>>();

  /**
   * Extract all unique MeshStandard/MeshPhysical materials from a model.
   * Returns PBRMaterialState[] for the store.
   */
  extractMaterials(model: THREE.Object3D): PBRMaterialState[] {
    this.materialMap.clear();
    this.perMeshOverrideMap.clear();

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
      state.lightMapIntensity = mat.lightMapIntensity;
      state.displacementScale = mat.displacementScale;
      state.displacementBias = mat.displacementBias;
      state.envMapIntensity = mat.envMapIntensity;
      state.alphaTest = mat.alphaTest;
      state.depthWrite = mat.depthWrite;
      state.colorWrite = mat.colorWrite;

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

      // Note texture slots - uvChannel picks up the loader-assigned channel
      // (e.g. GLTFLoader sets it from the glTF texCoord index) so an
      // embedded AO/lightmap that was authored against uv1 is respected
      // instead of silently assumed to be on uv2.
      if (mat.map) {
        state.map = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.map.channel };
      }
      if (mat.normalMap) {
        state.normalMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.normalMap.channel };
      }
      if (mat.roughnessMap) {
        state.roughnessMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.roughnessMap.channel };
      }
      if (mat.metalnessMap) {
        state.metalnessMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.metalnessMap.channel };
      }
      if (mat.emissiveMap) {
        state.emissiveMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.emissiveMap.channel };
      }
      if (mat.aoMap) {
        state.aoMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.aoMap.channel };
      }
      if (mat.lightMap) {
        state.lightMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.lightMap.channel };
      }
      if (mat.bumpMap) {
        state.bumpMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.bumpMap.channel };
      }
      if (mat.alphaMap) {
        state.alphaMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.alphaMap.channel };
      }
      if (mat.displacementMap) {
        state.displacementMap = { enabled: true, dataUrl: null, fileName: '(embedded)', uvChannel: mat.displacementMap.channel };
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
    phys.lightMapIntensity = mat.lightMapIntensity;

    // Copy textures
    phys.map = mat.map;
    phys.normalMap = mat.normalMap;
    phys.roughnessMap = mat.roughnessMap;
    phys.metalnessMap = mat.metalnessMap;
    phys.emissiveMap = mat.emissiveMap;
    phys.aoMap = mat.aoMap;
    phys.lightMap = mat.lightMap;
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
    phys.displacementScale = mat.displacementScale;
    phys.displacementBias = mat.displacementBias;
    phys.alphaTest = mat.alphaTest;
    phys.depthWrite = mat.depthWrite;
    phys.colorWrite = mat.colorWrite;

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

      this.applyPropertiesToMaterial(mat, state);
    }

    // Per-mesh AO/Lightmap overrides: make sure a clone exists and carries
    // its own texture for every mesh with one recorded in state (covers the
    // scene-file restore path, where overrides exist in state before any
    // clone has been created yet).
    const meshOverrides = state.meshTextureOverrides ?? {};
    for (const [meshName, overrides] of Object.entries(meshOverrides)) {
      if (overrides.aoMap?.enabled && overrides.aoMap.dataUrl) {
        this.setMeshTextureOverride(scene, state.id, meshName, 'aoMap', overrides.aoMap.dataUrl, overrides.aoMap.uvChannel);
      }
      if (overrides.lightMap?.enabled && overrides.lightMap.dataUrl) {
        this.setMeshTextureOverride(scene, state.id, meshName, 'lightMap', overrides.lightMap.dataUrl, overrides.lightMap.uvChannel);
      }
    }
    const overriddenMeshNames = new Set(
      Object.entries(meshOverrides)
        .filter(([, o]) => o.aoMap || o.lightMap)
        .map(([meshName]) => meshName),
    );
    const slotKeys: TextureSlotKey[] = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap',
      'emissiveMap', 'aoMap', 'lightMap', 'bumpMap', 'alphaMap', 'displacementMap',
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
          texture.channel = slot.uvChannel ?? 0;
          texture.needsUpdate = true;
          for (const m of mats) {
            (m as any)[slotKey] = texture;
            m.needsUpdate = true;
          }
          // Per-mesh clones for OTHER meshes (no override on this slot) still
          // track the shared texture; clones whose owning mesh has its own
          // override for this exact slot keep their own map untouched.
          if (!(slotKey === 'aoMap' || slotKey === 'lightMap')) {
            for (const [meshName, clone] of this.perMeshOverrideMap.get(state.id) ?? []) {
              if (overriddenMeshNames.has(meshName)) continue;
              (clone as any)[slotKey] = texture;
              clone.needsUpdate = true;
            }
          }
        });
      }
    }

    // Per-mesh clones: shared properties always sync; aoMap/lightMap only
    // sync from the shared slot when that specific mesh has no override.
    for (const [meshName, clone] of this.perMeshOverrideMap.get(state.id) ?? []) {
      this.applyPropertiesToMaterial(clone, state);
      clone.needsUpdate = true;
      if (!meshOverrides[meshName]?.aoMap && state.aoMap.enabled && state.aoMap.dataUrl) {
        this.loadTextureAsync(state.aoMap.dataUrl).then((tex) => {
          if (tex) { clone.aoMap = tex; clone.needsUpdate = true; }
        });
      }
      if (!meshOverrides[meshName]?.lightMap && state.lightMap.enabled && state.lightMap.dataUrl) {
        this.loadTextureAsync(state.lightMap.dataUrl).then((tex) => {
          if (tex) { clone.lightMap = tex; clone.needsUpdate = true; }
        });
      }
    }
  }

  /** Apply every non-texture PBR property from a state onto a live material. */
  private applyPropertiesToMaterial(mat: THREE.MeshStandardMaterial, state: PBRMaterialState): void {
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
    mat.lightMapIntensity = state.lightMapIntensity;
    mat.displacementScale = state.displacementScale;
    mat.displacementBias = state.displacementBias;
    mat.envMapIntensity = state.envMapIntensity;
    mat.alphaTest = state.alphaTest;
    mat.depthWrite = state.depthWrite;
    mat.colorWrite = state.colorWrite;

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
  }

  /**
   * Change which UV set an already-assigned texture samples from, without
   * reloading the image. Needed for embedded textures (dataUrl: null) that
   * the full applyMaterialState texture loop skips, and cheaper than a
   * reload for user-uploaded ones too - texture.channel is just an index
   * into the mesh's uv/uv1/uv2/uv3 attributes.
   */
  setTextureUVChannel(materialId: string, slotKey: TextureSlotKey, channel: number): void {
    const mats = this.materialMap.get(materialId);
    if (!mats) return;
    for (const mat of mats) {
      const texture = (mat as any)[slotKey] as THREE.Texture | null;
      if (texture) {
        texture.channel = channel;
        texture.needsUpdate = true;
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * Remove a texture from a material slot on the live scene. removeTextureSlot
   * in the store only resets UI state - it never touched the actual
   * THREE.Material, so a removed texture kept rendering until something else
   * happened to reassign the slot. This clears it directly.
   */
  clearTextureSlot(materialId: string, slotKey: TextureSlotKey): void {
    const mats = this.materialMap.get(materialId);
    if (!mats) return;
    for (const mat of mats) {
      (mat as any)[slotKey] = null;
      mat.needsUpdate = true;
    }
  }

  /** Find a mesh by name anywhere in the scene. */
  private findMeshByName(scene: THREE.Scene, meshName: string): THREE.Mesh | null {
    let found: THREE.Mesh | null = null;
    scene.traverse((obj) => {
      if (found) return;
      if (obj instanceof THREE.Mesh && obj.name === meshName) found = obj;
    });
    return found;
  }

  /**
   * Get (creating if needed) a per-mesh clone of a shared material so one
   * mesh can carry its own AO/Lightmap independent of the material's shared
   * slot. The clone starts as a copy of the shared material (so color,
   * roughness, other maps, etc. all match) and is swapped onto that mesh in
   * place of the shared instance; applyMaterialState keeps it in sync with
   * everything except aoMap/lightMap on meshes with an active override.
   */
  private getOrCreateMeshClone(scene: THREE.Scene, materialId: string, meshName: string): THREE.MeshStandardMaterial | null {
    let perMeshMats = this.perMeshOverrideMap.get(materialId);
    if (!perMeshMats) {
      perMeshMats = new Map();
      this.perMeshOverrideMap.set(materialId, perMeshMats);
    }

    const existing = perMeshMats.get(meshName);
    if (existing) return existing;

    const baseMats = this.materialMap.get(materialId);
    const baseMat = baseMats?.[0];
    const mesh = this.findMeshByName(scene, meshName);
    if (!baseMat || !mesh) return null;

    const clone = baseMat.clone() as THREE.MeshStandardMaterial;
    clone.name = baseMat.name;
    perMeshMats.set(meshName, clone);

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => (m === baseMat ? clone : m));
    } else if (mesh.material === baseMat) {
      mesh.material = clone;
    }

    return clone;
  }

  /**
   * Assign a per-mesh AO/Lightmap override - clones the shared material for
   * this specific mesh (if not already cloned) and loads the texture onto
   * just that clone, leaving every other mesh using this material untouched.
   */
  setMeshTextureOverride(
    scene: THREE.Scene,
    materialId: string,
    meshName: string,
    slotKey: 'aoMap' | 'lightMap',
    dataUrl: string,
    uvChannel: number,
  ): void {
    const clone = this.getOrCreateMeshClone(scene, materialId, meshName);
    if (!clone) return;
    this.loadTextureAsync(dataUrl).then((texture) => {
      if (!texture) return;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      texture.channel = uvChannel;
      texture.needsUpdate = true;
      (clone as any)[slotKey] = texture;
      clone.needsUpdate = true;
    });
  }

  /** Change the UV channel of an already-assigned per-mesh override, without reloading it. */
  setMeshTextureOverrideUVChannel(materialId: string, meshName: string, slotKey: 'aoMap' | 'lightMap', channel: number): void {
    const clone = this.perMeshOverrideMap.get(materialId)?.get(meshName);
    const texture = clone ? ((clone as any)[slotKey] as THREE.Texture | null) : null;
    if (texture && clone) {
      texture.channel = channel;
      texture.needsUpdate = true;
      clone.needsUpdate = true;
    }
  }

  /** Clear a per-mesh override, reverting that slot to the shared material's aoMap/lightMap immediately. */
  clearMeshTextureOverride(materialId: string, meshName: string, slotKey: 'aoMap' | 'lightMap'): void {
    const clone = this.perMeshOverrideMap.get(materialId)?.get(meshName);
    if (!clone) return;
    const sharedTexture = this.materialMap.get(materialId)?.[0]?.[slotKey] ?? null;
    (clone as any)[slotKey] = sharedTexture;
    clone.needsUpdate = true;
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