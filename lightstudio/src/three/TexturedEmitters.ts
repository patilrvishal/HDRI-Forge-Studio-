import * as THREE from 'three';
import type { LightTexture } from '../appearance/textures';

interface Emitter {
  group: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  color: THREE.DataTexture;
  alpha: THREE.DataTexture;
  signature: string;
}

const HALF_MAX = 65000;

/** Upload a top-down float RGBA image as a bottom-up half-float DataTexture. */
function makeTexture(data: Float32Array, w: number, h: number, alphaOnly: boolean): THREE.DataTexture {
  const out = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * 4;
      const o = (y * w + x) * 4;
      if (alphaOnly) {
        const a = THREE.DataUtils.toHalfFloat(data[s + 3]);
        out[o] = a; out[o + 1] = a; out[o + 2] = a; out[o + 3] = THREE.DataUtils.toHalfFloat(1);
      } else {
        out[o] = THREE.DataUtils.toHalfFloat(Math.min(HALF_MAX, data[s]));
        out[o + 1] = THREE.DataUtils.toHalfFloat(Math.min(HALF_MAX, data[s + 1]));
        out[o + 2] = THREE.DataUtils.toHalfFloat(Math.min(HALF_MAX, data[s + 2]));
        out[o + 3] = THREE.DataUtils.toHalfFloat(1);
      }
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export interface EmitterUpdate {
  show: boolean;
  camVisible: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  width: number;
  height: number;
  tint: THREE.Color;
  intensity: number;
  texture: LightTexture;
}

/**
 * The 3D side of HDR Textured Area Lights: a real rectangle in the scene that
 * carries the light's appearance as an emissive RGB map plus an alpha shape.
 * It is visible to the viewport camera and to the path tracer (where it lights the
 * scene through its texture, so reflections show the true shape).
 */
export class TexturedEmitters {
  private items = new Map<string, Emitter>();

  constructor(private scene: THREE.Scene) {}

  private create(id: string, tex: LightTexture): Emitter {
    const color = makeTexture(tex.data, tex.width, tex.height, false);
    const alpha = makeTexture(tex.data, tex.width, tex.height, true);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: color,
      emissiveIntensity: 1,
      alphaMap: alpha,
      transparent: true,
      roughness: 1,
      metalness: 0,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    // Plane's front faces +Z; the light emits toward local -Z, so spin it round.
    mesh.rotation.y = Math.PI;
    mesh.userData.isProxy = true;
    mesh.userData.keepInPathTracer = true;
    mesh.userData.lightEmitterFor = id;
    mesh.name = 'Light Emitter';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.isProxy = true;
    group.userData.keepInPathTracer = true;
    group.name = 'Light Emitter Group';
    this.scene.add(group);
    return { group, mesh, mat, color, alpha, signature: tex.signature };
  }

  update(id: string, u: EmitterUpdate): void {
    let e = this.items.get(id);
    if (!e) {
      e = this.create(id, u.texture);
      this.items.set(id, e);
    } else if (e.signature !== u.texture.signature || !u.texture.signature) {
      e.color.dispose();
      e.alpha.dispose();
      e.color = makeTexture(u.texture.data, u.texture.width, u.texture.height, false);
      e.alpha = makeTexture(u.texture.data, u.texture.width, u.texture.height, true);
      e.mat.emissiveMap = e.color;
      e.mat.alphaMap = e.alpha;
      e.mat.needsUpdate = true;
      e.signature = u.texture.signature;
    }
    e.group.visible = u.show && u.camVisible;
    e.group.position.copy(u.position);
    e.group.quaternion.copy(u.quaternion);
    e.mesh.scale.set(Math.max(0.01, u.width), Math.max(0.01, u.height), 1);
    e.mat.emissive.copy(u.tint);
    e.mat.emissiveIntensity = u.intensity;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  remove(id: string): void {
    const e = this.items.get(id);
    if (!e) return;
    this.scene.remove(e.group);
    e.mesh.geometry.dispose();
    e.mat.dispose();
    e.color.dispose();
    e.alpha.dispose();
    this.items.delete(id);
  }

  keepOnly(ids: Set<string>): void {
    for (const id of Array.from(this.items.keys())) if (!ids.has(id)) this.remove(id);
  }

  /** True when this light currently has a visible emitter (the path tracer then skips its analytic RectAreaLight). */
  isVisible(id: string): boolean {
    return !!this.items.get(id)?.group.visible;
  }

  dispose(): void {
    for (const id of Array.from(this.items.keys())) this.remove(id);
  }
}
