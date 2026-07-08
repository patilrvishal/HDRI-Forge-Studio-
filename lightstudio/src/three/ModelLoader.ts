import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export interface LoadResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export class ModelLoader {
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private currentModel: THREE.Group | null = null;

  constructor() {
    // DRACO decoder
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(
      'https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/',
    );

    // GLTF loader
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  loadModel(
    file: File,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<LoadResult> {
    return new Promise<LoadResult>((resolve, reject) => {
      const url = URL.createObjectURL(file);

      this.gltfLoader.load(
        url,
        (gltf) => {
          URL.revokeObjectURL(url);
          const scene = gltf.scene;
          const animations = gltf.animations ?? [];
          resolve({ scene, animations });
        },
        (progress) => {
          if (onProgress) {
            onProgress(progress as ProgressEvent);
          }
        },
        (error) => {
          URL.revokeObjectURL(url);
          reject(error);
        },
      );
    });
  }

  loadModelFromURL(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<LoadResult> {
    return new Promise<LoadResult>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const scene = gltf.scene;
          const animations = gltf.animations ?? [];
          resolve({ scene, animations });
        },
        (progress) => {
          if (onProgress) {
            onProgress(progress as ProgressEvent);
          }
        },
        (error) => {
          reject(error);
        },
      );
    });
  }

  addToScene(loadedScene: THREE.Group, mainScene: THREE.Scene): THREE.Group {
    // Remove existing model if any
    this.removeModel(mainScene);

    // Center and scale
    this.centerAndScaleModel(loadedScene);

    // Enable shadows on all meshes
    this.enableShadows(loadedScene);

    // Add to scene
    mainScene.add(loadedScene);
    this.currentModel = loadedScene;

    return loadedScene;
  }

  removeModel(scene?: THREE.Scene): void {
    if (!this.currentModel) return;

    const targetScene = scene ?? (this.currentModel.parent as THREE.Scene);
    if (targetScene) {
      targetScene.remove(this.currentModel);
    }

    this.disposeObject(this.currentModel);
    this.currentModel = null;
  }

  centerAndScaleModel(model: THREE.Group): void {
    // Compute bounding box
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());

    // Center at origin
    model.position.sub(center);

    // Recalculate bounding box after centering
    const newBox = new THREE.Box3().setFromObject(model);
    const newSize = newBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(newSize.x, newSize.y, newSize.z);

    // Scale to fit within ~4 unit radius
    const targetSize = 4;
    if (maxDim > 0) {
      const scaleFactor = targetSize / maxDim;
      model.scale.multiplyScalar(scaleFactor);
    }

    // After scaling, ensure the model sits on the ground (y=0)
    const finalBox = new THREE.Box3().setFromObject(model);
    const minY = finalBox.min.y;
    if (minY < 0) {
      model.position.y -= minY;
    }
  }

  getCurrentModel(): THREE.Group | null {
    return this.currentModel;
  }

  private enableShadows(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const mat of materials) {
            this.disposeMaterial(mat);
          }
        }
      }
    });
  }

  private disposeMaterial(material: THREE.Material): void {
    material.dispose();

    // Dispose textures
    const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap'] as const;
    for (const key of textureKeys) {
      const tex = (material as unknown as Record<string, unknown>)[key] as THREE.Texture | undefined;
      if (tex) {
        tex.dispose();
      }
    }
  }

  dispose(): void {
    this.removeModel();
    this.dracoLoader.dispose();
    // GLTFLoader doesn't have a dispose method in three@0.165.0
  }
}