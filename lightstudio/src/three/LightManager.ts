import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { Light, LightType, LightTransform } from '../types/Light';

interface LightEntry {
  light: THREE.Light;
  helper: THREE.Mesh | null;
  target?: THREE.Object3D;
  /** Cached helper dimensions so geometry is only rebuilt when the size actually changes. */
  helperW?: number;
  helperH?: number;
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

      const entry = this.lights.get(lightData.id);

      if (entry) {
        // If the TYPE changed, the underlying THREE object is the wrong class.
        // Tear it down and rebuild — this is the B1 fix.
        const currentType = this.getLightType(entry.light);
        if (currentType !== lightData.type) {
          this.removeLightFromScene(lightData.id, scene);
          this.createAndAddLight(lightData, scene, effectiveVisible);
        } else {
          this.updateExistingLight(lightData, effectiveVisible);
        }
      } else {
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

    // Bridge: store lightId so hierarchy selection can find the lightsStore entry
    light.userData.lightId = lightData.id;
    // Store the logical type so getLightType() never has to guess
    light.userData.lightType = lightData.type;

    // Set color, intensity, and (for area lights) width/height
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
      light.target = target;
    }

    // Configure shadows for applicable light types
    this.configureShadows(light, lightData.type);

    // Create helper mesh sized to the actual light
    const helper = this.createHelperMesh(lightData);

    // Add to scene
    scene.add(light);
    if (helper) {
      helper.visible = lightData.gearVisible;
      scene.add(helper);
    }

    // Store entry with cached helper dimensions
    this.lights.set(lightData.id, {
      light,
      helper,
      target,
      helperW: lightData.areaWidth ?? 2,
      helperH: lightData.areaHeight ?? 2,
    });

    // Sync helper transform to the light
    this.syncHelperTransform(lightData.id, lightData);
  }

  private updateExistingLight(
    lightData: Light,
    visible: boolean,
  ): void {
    const entry = this.lights.get(lightData.id);
    if (!entry) return;

    const { light } = entry;

    // Update visibility
    light.visible = visible;

    // Update color, intensity, and area dimensions
    this.applyLightProperties(light, lightData);

    // Update position
    this.updateLightPosition(light, lightData.transform);

    // Update shadow properties
    this.configureShadows(light, lightData.type);

    // Rebuild helper geometry if the area dimensions changed, then re-sync
    this.refreshHelperGeometry(lightData);
    this.syncHelperTransform(lightData.id, lightData);
  }

  /**
   * Apply colour, intensity, and — critically — the RectAreaLight width/height.
   * Without the width/height assignment, area lights never resize in the viewport
   * even though the store value changes.
   */
  private applyLightProperties(light: THREE.Light, lightData: Light): void {
    light.color.set(lightData.color);

    // Map brightness 0-1000 to intensity 0-10
    const intensity = (lightData.brightness / 1000) * 10;
    light.intensity = intensity;

    // Area / overhead lights: push the dimensions onto the actual THREE light
    if (light instanceof THREE.RectAreaLight) {
      const w = lightData.areaWidth ?? 2;
      const h = lightData.areaHeight ?? 2;
      light.width = Math.max(0.01, w);
      light.height = Math.max(0.01, h);
    }

    // Spot / rim: cone angle and penumbra
    if (light instanceof THREE.SpotLight) {
      if (lightData.spotAngle !== undefined) {
        light.angle = (lightData.spotAngle * Math.PI) / 180;
      }
      if (lightData.spotPenumbra !== undefined) {
        light.penumbra = lightData.spotPenumbra;
      }
    }
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
    const { spherical, rotation } = transform;

    // Convert degrees to radians
    const latRad = (spherical.lat * Math.PI) / 180;
    const lngRad = (spherical.lng * Math.PI) / 180;

    // Convert spherical to cartesian
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

    // Area lights: aim at the origin by default, then apply the manual
    // rotation override if the user has enabled it.
    if (light instanceof THREE.RectAreaLight) {
      if (rotation?.enabled) {
        light.rotation.set(
          (rotation.x * Math.PI) / 180,
          (rotation.y * Math.PI) / 180,
          (rotation.z * Math.PI) / 180,
        );
      } else {
        light.lookAt(0, 0, 0);
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

  /**
   * Build the helper mesh. Area lights get a plane matching their REAL
   * dimensions (the old code hard-coded 0.3 x 0.3, so the helper never
   * reflected the light's size).
   */
  private createHelperMesh(lightData: Light): THREE.Mesh | null {
    // Softbox/emitter look: additive blending makes the panel read as a
    // glowing light source that crosses the bloom threshold — matching the
    // studio softboxes in the reference — instead of a flat translucent card.
    const helperMaterial = new THREE.MeshBasicMaterial({
      color: lightData.color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const geometry = this.buildHelperGeometry(lightData);
    if (!geometry) return null;

    const helper = new THREE.Mesh(geometry, helperMaterial);
    helper.renderOrder = 999;
    helper.userData.lightId = lightData.id;

    return helper;
  }

  /** Geometry factory — kept separate so it can be re-run on resize. */
  private buildHelperGeometry(lightData: Light): THREE.BufferGeometry | null {
    switch (lightData.type) {
      case 'point':
      case 'underlight':
      case 'ies':
        return new THREE.SphereGeometry(0.08, 12, 12);

      case 'area':
      case 'overhead': {
        const w = Math.max(0.01, lightData.areaWidth ?? 2);
        const h = Math.max(0.01, lightData.areaHeight ?? 2);
        return new THREE.PlaneGeometry(w, h);
      }

      case 'spot':
      case 'rim':
        return new THREE.SphereGeometry(0.06, 12, 12);

      case 'directional':
        return new THREE.SphereGeometry(0.1, 12, 12);

      default:
        return null;
    }
  }

  /**
   * Rebuild the helper's geometry when the area dimensions change.
   * BufferGeometry is immutable — mutating PlaneGeometry.parameters does
   * nothing, so the old geometry must be disposed and replaced.
   */
  private refreshHelperGeometry(lightData: Light): void {
    const entry = this.lights.get(lightData.id);
    if (!entry?.helper) return;

    const isArea = lightData.type === 'area' || lightData.type === 'overhead';
    if (!isArea) return;

    const w = Math.max(0.01, lightData.areaWidth ?? 2);
    const h = Math.max(0.01, lightData.areaHeight ?? 2);

    // Only rebuild when the size actually changed — this runs on every sync
    if (entry.helperW === w && entry.helperH === h) return;

    const newGeo = this.buildHelperGeometry(lightData);
    if (!newGeo) return;

    entry.helper.geometry.dispose();
    entry.helper.geometry = newGeo;
    entry.helperW = w;
    entry.helperH = h;
  }

  /** Keep the helper glued to its light: position, orientation, and colour. */
  private syncHelperTransform(id: string, lightData: Light): void {
    const entry = this.lights.get(id);
    if (!entry?.helper) return;

    const { light, helper } = entry;

    helper.visible = lightData.gearVisible;
    helper.position.copy(light.position);
    helper.quaternion.copy(light.quaternion);

    const mat = helper.material as THREE.MeshBasicMaterial;
    if (mat) mat.color.set(lightData.color);
  }

  private getLightType(light: THREE.Light): LightType | null {
    // Prefer the stored logical type — the old width===4 heuristic broke as
    // soon as the user resized an area light to 4x4.
    const stored = light.userData?.lightType as LightType | undefined;
    if (stored) return stored;

    if (light instanceof THREE.RectAreaLight) return 'area';
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
        entry.helper.quaternion.copy(entry.light.quaternion);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    // Lights will be cleaned up by removeAllLights when the scene is disposed
    this.lights.clear();
  }
}