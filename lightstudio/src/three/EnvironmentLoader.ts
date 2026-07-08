import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { HDRIPreset, EnvPanel } from '../types/Environment';

export class EnvironmentLoader {
  private rgbeLoader: RGBELoader;
  private currentEnvTexture: THREE.Texture | null = null;
  private cache = new Map<string, THREE.Texture>();

  constructor() {
    this.rgbeLoader = new RGBELoader();
  }

  /**
   * Generate an environment map from an HDRIPreset's panel configuration.
   * Creates a small procedural scene with emissive panels, then bakes it
   * through PMREMGenerator for PBR reflections.
   */
  generateFromPreset(
    preset: HDRIPreset,
    pmremGenerator: THREE.PMREMGenerator,
    rotationDeg: number = 0,
  ): THREE.Texture {
    // Check cache
    const cacheKey = `${preset.id}_${rotationDeg}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // "None" preset — return null-like behavior
    if (preset.id === 'none') {
      this.setEnvironmentTextureDirect(null);
      return this._createNullTexture();
    }

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(preset.backgroundHint);

    // Create emissive panels
    for (const panel of preset.panels) {
      this._addPanel(envScene, panel);
    }

    // Ground reflector
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshBasicMaterial({
      color: preset.groundColor ?? 0x333344,
      side: THREE.DoubleSide,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -2, 0);
    ground.rotation.x = -Math.PI / 2;
    envScene.add(ground);

    // Ambient fill
    if (preset.ambient) {
      const ambient = new THREE.AmbientLight(preset.ambient.color, preset.ambient.intensity);
      envScene.add(ambient);
    }

    // Apply rotation to the entire environment scene
    if (rotationDeg !== 0) {
      envScene.rotation.y = (rotationDeg * Math.PI) / 180;
    }

    // Bake through PMREMGenerator
    const renderTarget = pmremGenerator.fromScene(envScene, 0, 0.1, 100);
    const envTexture = renderTarget.texture;

    // Dispose helper geometries
    groundGeo.dispose();
    groundMat.dispose();
    envScene.traverse((child) => {
      if (child instanceof THREE.Mesh && child !== ground) {
        child.geometry?.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });

    // Cache
    this.cache.set(cacheKey, envTexture);
    this.setEnvironmentTextureDirect(envTexture);
    return envTexture;
  }

  /** Load a real .hdr/.hdri file from a URL or File object */
  loadHDRI(
    source: string | File,
    pmremGenerator: THREE.PMREMGenerator,
  ): Promise<THREE.Texture> {
    return new Promise<THREE.Texture>((resolve, reject) => {
      const url = typeof source === 'string' ? source : URL.createObjectURL(source);

      this.rgbeLoader.load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          const envMap = pmremGenerator.fromEquirectangular(texture).texture;
          texture.dispose();

          if (typeof source === 'object') {
            URL.revokeObjectURL(url);
          }

          this.setEnvironmentTextureDirect(envMap);
          resolve(envMap);
        },
        undefined,
        (error) => {
          if (typeof source === 'object') {
            URL.revokeObjectURL(url);
          }
          reject(error);
        },
      );
    });
  }

  /**
   * Apply the environment map to the scene and set intensity on all PBR materials.
   */
  setEnvironmentTexture(
    scene: THREE.Scene,
    texture: THREE.Texture | null,
    intensity: number = 1.0,
  ): void {
    if (texture) {
      scene.environment = texture;
    } else {
      scene.environment = null;
    }

    // Set envMapIntensity on all PBR materials
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const mat of materials) {
          if ('envMapIntensity' in mat) {
            (mat as THREE.MeshStandardMaterial).envMapIntensity = intensity;
          }
        }
      }
    });
  }

  getCurrentEnvTexture(): THREE.Texture | null {
    return this.currentEnvTexture;
  }

  clearCache(): void {
    for (const texture of this.cache.values()) {
      texture.dispose();
    }
    this.cache.clear();
  }

  dispose(): void {
    this.clearCache();
    if (this.currentEnvTexture) {
      this.currentEnvTexture.dispose();
      this.currentEnvTexture = null;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private setEnvironmentTextureDirect(texture: THREE.Texture | null): void {
    if (this.currentEnvTexture && this.currentEnvTexture !== texture) {
      // Only dispose if it's NOT in the cache
      let inCache = false;
      for (const cached of this.cache.values()) {
        if (cached === this.currentEnvTexture) {
          inCache = true;
          break;
        }
      }
      if (!inCache) {
        this.currentEnvTexture.dispose();
      }
    }
    this.currentEnvTexture = texture;
  }

  /** Create a 1x1 placeholder texture (used for "None" preset) */
  private _createNullTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1, 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private _addPanel(envScene: THREE.Scene, panel: EnvPanel): void {
    const geo = new THREE.PlaneGeometry(panel.size[0], panel.size[1]);
    const mat = new THREE.MeshBasicMaterial({
      color: panel.color,
      side: THREE.DoubleSide,
    });
    // Scale brightness via color intensity — multiply by intensity
    const color = new THREE.Color(panel.color);
    color.multiplyScalar(panel.intensity);
    mat.color = color;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);

    if (panel.rotationX !== undefined) {
      mesh.rotation.x = panel.rotationX;
    }
    if (panel.rotationY !== undefined) {
      mesh.rotation.y = panel.rotationY;
    }

    envScene.add(mesh);
  }
}