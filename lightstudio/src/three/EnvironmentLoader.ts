import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { SceneManager } from './SceneManager';

export class EnvironmentLoader {
  private rgbeLoader: RGBELoader;
  private currentEnvTexture: THREE.Texture | null = null;

  constructor() {
    this.rgbeLoader = new RGBELoader();
  }

  loadHDRI(
    url: string,
    pmremGenerator: THREE.PMREMGenerator,
  ): Promise<THREE.Texture> {
    return new Promise<THREE.Texture>((resolve, reject) => {
      this.rgbeLoader.load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;

          // Process through PMREMGenerator for PBR
          const envMap = pmremGenerator.fromEquirectangular(texture).texture;
          texture.dispose();

          this.currentEnvTexture = envMap;
          resolve(envMap);
        },
        undefined,
        (error) => {
          reject(error);
        },
      );
    });
  }

  createStudioEnvironment(
    scene: THREE.Scene,
    pmremGenerator: THREE.PMREMGenerator,
  ): THREE.Texture {
    // Create a small procedural scene to act as the environment
    const envScene = new THREE.Scene();

    // Neutral background
    envScene.background = new THREE.Color(0x222233);

    // Top soft area light (key light from above)
    const topLightGeo = new THREE.PlaneGeometry(6, 6);
    const topLightMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const topLight = new THREE.Mesh(topLightGeo, topLightMat);
    topLight.position.set(0, 5, 0);
    topLight.rotation.x = Math.PI / 2;
    envScene.add(topLight);

    // Right panel (warm fill)
    const rightPanelGeo = new THREE.PlaneGeometry(4, 4);
    const rightPanelMat = new THREE.MeshBasicMaterial({
      color: 0xffeedd,
      side: THREE.DoubleSide,
    });
    const rightPanel = new THREE.Mesh(rightPanelGeo, rightPanelMat);
    rightPanel.position.set(5, 2, 0);
    rightPanel.rotation.y = -Math.PI / 2;
    envScene.add(rightPanel);

    // Left panel (cool fill)
    const leftPanelGeo = new THREE.PlaneGeometry(4, 4);
    const leftPanelMat = new THREE.MeshBasicMaterial({
      color: 0xddeeff,
      side: THREE.DoubleSide,
    });
    const leftPanel = new THREE.Mesh(leftPanelGeo, leftPanelMat);
    leftPanel.position.set(-5, 2, 0);
    leftPanel.rotation.y = Math.PI / 2;
    envScene.add(leftPanel);

    // Back panel (subtle rim)
    const backPanelGeo = new THREE.PlaneGeometry(6, 4);
    const backPanelMat = new THREE.MeshBasicMaterial({
      color: 0xccccdd,
      side: THREE.DoubleSide,
    });
    const backPanel = new THREE.Mesh(backPanelGeo, backPanelMat);
    backPanel.position.set(0, 2, -5);
    envScene.add(backPanel);

    // Ground reflector (subtle)
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x333344,
      side: THREE.DoubleSide,
    });
    const groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.position.set(0, -2, 0);
    groundPlane.rotation.x = -Math.PI / 2;
    envScene.add(groundPlane);

    // Add a dim ambient light so the scene isn't fully black
    const ambientEnv = new THREE.AmbientLight(0x888899, 0.5);
    envScene.add(ambientEnv);

    // Render to PMREMGenerator
    const renderTarget = pmremGenerator.fromScene(envScene, 0, 0.1, 100);
    const envTexture = renderTarget.texture;

    // Dispose the helper scene geometries and materials
    topLightGeo.dispose();
    topLightMat.dispose();
    rightPanelGeo.dispose();
    rightPanelMat.dispose();
    leftPanelGeo.dispose();
    leftPanelMat.dispose();
    backPanelGeo.dispose();
    backPanelMat.dispose();
    groundGeo.dispose();
    groundMat.dispose();

    this.currentEnvTexture = envTexture;
    return envTexture;
  }

  setEnvironmentTexture(
    sceneManager: SceneManager,
    texture: THREE.Texture | null,
    intensity: number = 1.0,
  ): void {
    if (texture) {
      sceneManager.scene.environment = texture;

      // Dispose previous env texture if it's different
      if (this.currentEnvTexture && this.currentEnvTexture !== texture) {
        this.currentEnvTexture.dispose();
      }
      this.currentEnvTexture = texture;

      // Set environment intensity on all PBR materials in the scene
      sceneManager.scene.traverse((child) => {
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
    } else {
      sceneManager.scene.environment = null;
      if (this.currentEnvTexture) {
        this.currentEnvTexture.dispose();
        this.currentEnvTexture = null;
      }
    }
  }

  getCurrentEnvTexture(): THREE.Texture | null {
    return this.currentEnvTexture;
  }

  dispose(): void {
    if (this.currentEnvTexture) {
      this.currentEnvTexture.dispose();
      this.currentEnvTexture = null;
    }
  }
}