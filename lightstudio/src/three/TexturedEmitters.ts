import * as THREE from 'three';
import type { LightTexture } from '../appearance/textures';
import type { ViewFrame } from '../appearance/types';

interface Emitter {
  group: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  color: THREE.DataTexture;
  alpha: THREE.DataTexture;
  signature: string;
  /** The metal frame + studs drawn around the picture (viewport only). */
  frameGroup: THREE.Group;
  frameKey: string;
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
  /** True when the emitter is the real light (Area Light mode); false = a viewport-only picture of the light. */
  pathTraced: boolean;
  camVisible: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  width: number;
  height: number;
  tint: THREE.Color;
  intensity: number;
  texture: LightTexture;
  frame?: ViewFrame | null;
}

/**
 * The 3D side of HDR Textured Area Lights: a real rectangle in the scene that
 * carries the light's appearance as an emissive RGB map plus an alpha shape.
 * It is visible to the viewport camera and to the path tracer (where it lights the
 * scene through its texture, so reflections show the true shape).
 */
const FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa1ad, metalness: 0.85, roughness: 0.35, emissive: 0x23262d });
const DOT_MAT = new THREE.MeshStandardMaterial({ color: 0xdde2ea, metalness: 0.9, roughness: 0.3, emissive: 0x4a4f5a });

/** Rebuilds the frame: a thin metal bar along each edge and a stud on each corner, like the light's icon. */
function buildFrame(group: THREE.Group, frame: ViewFrame | null | undefined, w: number, h: number): void {
  for (const c of [...group.children]) { group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
  if (!frame) return;
  const pts: THREE.Vector2[] = [];
  if (frame.kind === 'rect') {
    const k = 1 - (frame.inset ?? 0.03);
    const hx = (w / 2) * k, hy = (h / 2) * k;
    pts.push(new THREE.Vector2(-hx, -hy), new THREE.Vector2(hx, -hy), new THREE.Vector2(hx, hy), new THREE.Vector2(-hx, hy));
  } else {
    const n = Math.max(3, Math.round(frame.sides ?? 6));
    const R = (frame.scale ?? 1) * Math.min(w, h) / 2;
    const rot = ((frame.rotation ?? 0) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = R * Math.sin(a), py = R * Math.cos(a);          // one corner points up
      pts.push(new THREE.Vector2(px * Math.cos(rot) - py * Math.sin(rot), px * Math.sin(rot) + py * Math.cos(rot)));
    }
  }
  const t = Math.min(0.05, Math.max(0.012, Math.min(w, h) * 0.018));
  const mark = (m: THREE.Mesh) => { m.userData.isProxy = true; m.castShadow = false; m.receiveShadow = false; m.raycast = () => {}; group.add(m); };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = a.distanceTo(b);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len + t, t, t * 0.8), FRAME_MAT);
    bar.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    bar.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
    mark(bar);
  }
  // a stud on every corner (a round light only gets four)
  const step = pts.length > 10 ? Math.round(pts.length / 4) : 1;
  for (let i = 0; i < pts.length; i += step) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(t * 1.25, 12, 8), DOT_MAT);
    dot.position.set(pts[i].x, pts[i].y, 0);
    mark(dot);
  }
}

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
      side: THREE.DoubleSide,          // visible from behind too, so the viewport always shows the light's shape
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
    const frameGroup = new THREE.Group();
    frameGroup.name = 'Light Frame';
    group.add(frameGroup);
    group.userData.isProxy = true;
    group.userData.keepInPathTracer = true;
    group.name = 'Light Emitter Group';
    this.scene.add(group);
    return { group, mesh, mat, color, alpha, signature: tex.signature, frameGroup, frameKey: '' };
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
    e.group.userData.keepInPathTracer = u.pathTraced;
    e.mesh.userData.keepInPathTracer = u.pathTraced;
    e.group.position.copy(u.position);
    e.group.quaternion.copy(u.quaternion);
    e.mesh.scale.set(Math.max(0.01, u.width), Math.max(0.01, u.height), 1);
    const fk = JSON.stringify(u.frame ?? null) + '|' + u.width.toFixed(3) + '|' + u.height.toFixed(3);
    if (fk !== e.frameKey) { e.frameKey = fk; buildFrame(e.frameGroup, u.frame, Math.max(0.01, u.width), Math.max(0.01, u.height)); }
    e.mat.emissive.copy(u.tint);
    e.mat.emissiveIntensity = Math.min(u.intensity, u.pathTraced ? 1.2 : 1.0);      // keeps the picture readable in the viewport instead of burning out to flat white
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  remove(id: string): void {
    const e = this.items.get(id);
    if (!e) return;
    this.scene.remove(e.group);
    e.mesh.geometry.dispose();
    for (const c of [...e.frameGroup.children]) (c as THREE.Mesh).geometry?.dispose();
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
