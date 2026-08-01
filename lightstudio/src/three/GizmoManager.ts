import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type GizmoMode = 'translate' | 'rotate' | 'scale' | null;

interface GizmoCallbacks {
  onTransform: (
    lightId: string,
    data: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      scale: { x: number; y: number; z: number };
    },
  ) => void;
}

/**
 * Owns the TransformControls gizmo and keeps it attached to the selected light.
 * Rolling our own drag math would mean re-implementing screen-space projection,
 * axis snapping, and hit testing - TransformControls already does all of it.
 */
export class GizmoManager {
  private controls: TransformControls;
  private scene: THREE.Scene;
  private orbit: OrbitControls;
  private attachedId: string | null = null;
  private mode: GizmoMode = null;
  private callbacks: GizmoCallbacks;
  private disposed = false;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    orbit: OrbitControls,
    callbacks: GizmoCallbacks,
  ) {
    this.scene = scene;
    this.orbit = orbit;
    this.callbacks = callbacks;

    this.controls = new TransformControls(camera, domElement);
    this.controls.setSize(0.8);
    this.controls.visible = false;

    // Orbit and gizmo both want the mouse - hand it to the gizmo mid-drag.
    this.controls.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
    });

    this.controls.addEventListener('objectChange', () => {
      const obj = this.controls.object;
      if (!obj || !this.attachedId) return;

      this.callbacks.onTransform(this.attachedId, {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: {
          x: (obj.rotation.x * 180) / Math.PI,
          y: (obj.rotation.y * 180) / Math.PI,
          z: (obj.rotation.z * 180) / Math.PI,
        },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
      });
    });

    // In three r16x+ TransformControls is a helper, not a scene object - its
    // gizmo is exposed separately and must be added on its own.
    const helper = (this.controls as unknown as { getHelper?: () => THREE.Object3D }).getHelper?.();
    scene.add(helper ?? (this.controls as unknown as THREE.Object3D));
  }

  setMode(mode: GizmoMode): void {
    if (this.disposed) return;
    this.mode = mode;

    if (!mode) {
      this.controls.visible = false;
      this.controls.detach();
      this.attachedId = null;
      return;
    }

    this.controls.setMode(mode);
    if (this.controls.object) this.controls.visible = true;
  }

  getMode(): GizmoMode {
    return this.mode;
  }

  /**
   * Find the THREE object by the lightId stamped into userData, so this works
   * without reaching into LightManager internals.
   */
  attachToLight(lightId: string | null): void {
    if (this.disposed) return;

    if (!lightId || !this.mode) {
      this.controls.detach();
      this.controls.visible = false;
      this.attachedId = null;
      return;
    }

    let target: THREE.Object3D | null = null;
    this.scene.traverse((obj) => {
      if (target) return;
      if (obj.userData?.lightId === lightId && obj instanceof THREE.Light) {
        target = obj;
      }
    });

    if (!target) {
      this.controls.detach();
      this.controls.visible = false;
      this.attachedId = null;
      return;
    }

    this.controls.attach(target);
    this.controls.visible = true;
    this.attachedId = lightId;
  }

  /** Scale only means something for area lights - hide it for point/spot. */
  setScaleAllowed(allowed: boolean): void {
    if (this.mode === 'scale' && !allowed) {
      this.setMode('translate');
    }
  }

  dispose(): void {
    this.disposed = true;
    this.controls.detach();
    const helper = (this.controls as unknown as { getHelper?: () => THREE.Object3D }).getHelper?.();
    this.scene.remove(helper ?? (this.controls as unknown as THREE.Object3D));
    this.controls.dispose();
  }
}
