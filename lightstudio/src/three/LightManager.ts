import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { Light, LightType, LightTransform } from '../types/Light';

interface LightEntry {
  light: THREE.Light;
  helper: THREE.Mesh | null;
  target?: THREE.Object3D;
}

// Initialize RectAreaLight uniforms once
let rectAreaLibInitialized = false;
function ensureRectAreaLib(): void {
  if (!rectAreaLibInitialized) {
    RectAreaLightUniformsLib.init();
    rectAreaLibInitialized = true;
  }
}

export class LightManager {
  private lights = new Map<string, LightEntry>();
  private disposed = false;

  constructor() {
    ensureRectAreaLib();
  }

  syncLights(lights: Light[], scene: THREE.Scene): void {
    if (this.disposed) return;

    // Determine if any light is in solo mode
    const hasSolo = lights.some((l) => l.solo);
    const soloIds = new Set(
      lights.filter((l) => l.solo).map((l) => l.id),
    );

    const currentIds = new Set(this.lights.keys());
    const targetIds = new Set(lights.map((l) => l.id));

    // Remove lights that are no longer in the target list
    for (const id of currentIds) {
      if (!targetIds.has(id)) {
        this.removeLightFromScene(id, scene);
      }
    }

    // Create or update each light
    for (const lightData of lights) {
      // Determine effective visibility
      let effectiveVisible = lightData.visible;
      if (hasSolo) {
        effectiveVisible = soloIds.has(lightData.id);
      }

      if (this.lights.has(lightData.id)) {
        // Update existing light
        this.updateExistingLight(lightData, effectiveVisible);
      } else {
        // Create new light
        this.createAndAddLight(lightData, scene, effectiveVisible);
      }
    }
  }

  private createAndAddLight(
    lightData: Light,
    scene: THREE.Scene,
    visible: boolean,
  ): void {
    const light = this.createLightFromType(lightData.type);
    light.visible = visible;

    // Set color and intensity
    this.applyLightProperties(light, lightData);

    // Set position from spherical coordinates
    this.updateLightPosition(light, lightData.transform);

    // Add target for directional/spot lights
    let target: THREE.Object3D | undefined;
    if (
      light instanceof THREE.DirectionalLight ||
      light instanceof THREE.SpotLight
    ) {
      target = new THREE.Object3D();
      target.position.set(0, 0, 0);
      scene.add(target);

      if (light instanceof THREE.SpotLight) {
        light.target = target;
      } else {
        light.target = target;
      }
    }

    // Configure shadows for applicable light types
    this.configureShadows(light, lightData.type);

    // Create helper mesh
    const helper = this.createHelperMesh(lightData.type, lightData.color);

    // Add to scene
    scene.add(light);
    if (helper) {
      helper.visible = lightData.gearVisible;
      scene.add(helper);
    }

    // Store entry
    this.lights.set(lightData.id, { light, helper, target });
  }

  private updateExistingLight(
    lightData: Light,
    visible: boolean,
  ): void {
    const entry = this.lights.get(lightData.id);
    if (!entry) return;

    const { light, helper } = entry;

    // Check if type changed — if so, we need to recreate
    const currentType = this.getLightType(light);
    if (currentType !== lightData.type) {
      // Type changed: mark for recreation by removing and re-adding
      // We can't easily recreate here since we need the scene reference,
      // so we set a flag and let the next sync handle it
      // For now, we'll just update what we can
      // The caller should handle type changes by calling syncLights with the new type
    }

    // Update visibility
    light.visible = visible;

    // Update color and intensity
    this.applyLightProperties(light, lightData);

    // Update position
    this.updateLightPosition(light, lightData.transform);

    // Update shadow properties
    this.configureShadows(light, lightData.type);

    // Update helper visibility and color
    if (helper) {
      helper.visible = lightData.gearVisible;
      const helperMat = helper.material as THREE.MeshBasicMaterial;
      if (helperMat) {
        helperMat.color.set(lightData.color);
      }
      // Keep helper in sync with light position
      helper.position.copy(light.position);
    }
  }

  private applyLightProperties(light: THREE.Light, lightData: Light): void {
    light.color.set(lightData.color);

    // Map brightness 0-1000 to intensity 0-10
    const intensity = (lightData.brightness / 1000) * 10;
    light.intensity = intensity;
  }

  createLightFromType(type: LightType): THREE.Light {
    ensureRectAreaLib();

    switch (type) {
      case 'point':
        return new THREE.PointLight(0xffffff, 1, 50, 2);

      case 'spot': {
        const spot = new THREE.SpotLight(0xffffff, 1, 50, 0.5, 0.5, 2);
        return spot;
      }

      case 'area':
        return new THREE.RectAreaLight(0xffffff, 1, 2, 2);

      case 'directional':
        return new THREE.DirectionalLight(0xffffff, 1);

      case 'overhead': {
        ensureRectAreaLib();
        return new THREE.RectAreaLight(0xffffff, 1, 4, 4);
      }

      case 'underlight': {
        const pl = new THREE.PointLight(0xffffff, 1, 50, 2);
        return pl;
      }

      case 'rim': {
        const rimSpot = new THREE.SpotLight(0xffffff, 1, 50, 0.5, 0.5, 2);
        return rimSpot;
      }

      case 'ies':
        return new THREE.PointLight(0xffffff, 1, 50, 2);

      default:
        return new THREE.PointLight(0xffffff, 1, 50, 2);
    }
  }

  updateLightPosition(light: THREE.Light, transform: LightTransform): void {
    const { spherical } = transform;

    // Convert degrees to radians
    const latRad = (spherical.lat * Math.PI) / 180;
    const lngRad = (spherical.lng * Math.PI) / 180;

    // Convert spherical to cartesian
    // x = radius * cos(lat) * cos(lng)
    // y = height
    // z = radius * cos(lat) * sin(lng)
    const cosLat = Math.cos(latRad);
    const x = spherical.radius * cosLat * Math.cos(lngRad);
    const y = spherical.height;
    const z = spherical.radius * cosLat * Math.sin(lngRad);

    light.position.set(x, y, z);

    // For directional and spot lights, make them look at origin
    if (
      light instanceof THREE.DirectionalLight ||
      light instanceof THREE.SpotLight
    ) {
      light.target?.position.set(0, 0, 0);
    }

    // For overhead light, point it downward
    if (light instanceof THREE.RectAreaLight) {
      const lightType = this.getLightType(light);
      if (lightType === 'overhead') {
        light.lookAt(x, y - 1, z);
      }
    }
  }

  private configureShadows(light: THREE.Light, _type: LightType): void {
    const shadowCapable =
      light instanceof THREE.SpotLight ||
      light instanceof THREE.DirectionalLight ||
      light instanceof THREE.PointLight;

    if (shadowCapable) {
      light.castShadow = true;

      if (light.shadow) {
        light.shadow.mapSize.set(2048, 2048);
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 50;
        light.shadow.bias = -0.001;

        if (light instanceof THREE.SpotLight) {
          light.shadow.mapSize.set(2048, 2048);
        } else if (light instanceof THREE.DirectionalLight) {
          light.shadow.camera.left = -10;
          light.shadow.camera.right = 10;
          light.shadow.camera.top = 10;
          light.shadow.camera.bottom = -10;
        } else if (light instanceof THREE.PointLight) {
          light.shadow.mapSize.set(1024, 1024);
        }
      }
    }
  }

  private createHelperMesh(
    type: LightType,
    color: string,
  ): THREE.Mesh | null {
    const helperMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    let geometry: THREE.BufferGeometry;

    switch (type) {
      case 'point':
      case 'underlight':
      case 'ies':
        // Sphere helper for point-like lights
        geometry = new THREE.SphereGeometry(0.08, 8, 8);
        break;

      case 'area':
      case 'overhead':
        // Plane helper for area lights
        geometry = new THREE.PlaneGeometry(0.3, 0.3);
        break;

      case 'spot':
      case 'rim':
        // Cone-like indicator using a small sphere
        geometry = new THREE.SphereGeometry(0.06, 8, 8);
        break;

      case 'directional':
        // Arrow-like indicator using a small sphere
        geometry = new THREE.SphereGeometry(0.1, 8, 8);
        break;

      default:
        return null;
    }

    const helper = new THREE.Mesh(geometry, helperMaterial);
    helper.renderOrder = 999;

    return helper;
  }

  private getLightType(light: THREE.Light): LightType | null {
    if (light instanceof THREE.RectAreaLight) {
      // We can't easily distinguish area vs overhead without storing metadata
      // Check the light's width/height as a heuristic
      if (
        (light as THREE.RectAreaLight).width === 4 &&
        (light as THREE.RectAreaLight).height === 4
      ) {
        return 'overhead';
      }
      return 'area';
    }
    if (light instanceof THREE.SpotLight) return 'spot';
    if (light instanceof THREE.DirectionalLight) return 'directional';
    if (light instanceof THREE.PointLight) return 'point';
    return null;
  }

  private removeLightFromScene(id: string, scene: THREE.Scene): void {
    const entry = this.lights.get(id);
    if (!entry) return;

    const { light, helper, target } = entry;

    scene.remove(light);
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    if (target) {
      scene.remove(target);
    }

    // Dispose light resources
    const sl = light as THREE.SpotLight | THREE.DirectionalLight | THREE.PointLight;
    if (sl.shadow && sl.shadow.map) {
      sl.shadow.map.dispose();
    }

    this.lights.delete(id);
  }

  removeAllLights(scene: THREE.Scene): void {
    if (this.disposed) return;

    const ids = Array.from(this.lights.keys());
    for (const id of ids) {
      this.removeLightFromScene(id, scene);
    }
  }

  getLight(id: string): THREE.Light | undefined {
    return this.lights.get(id)?.light;
  }

  getLightEntry(id: string): LightEntry | undefined {
    return this.lights.get(id);
  }

  getLightCount(): number {
    return this.lights.size;
  }

  updateHelperPositions(): void {
    for (const [, entry] of this.lights) {
      if (entry.helper) {
        entry.helper.position.copy(entry.light.position);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    // Lights will be cleaned up by removeAllLights when the scene is disposed
    this.lights.clear();
  }
}