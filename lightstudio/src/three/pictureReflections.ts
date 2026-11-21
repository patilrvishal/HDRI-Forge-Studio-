import * as THREE from 'three';
import type { SceneManager } from './engine';
import { generateAnalyticalHDRI } from './HDRIExporter';
import { buildCompositeLayers } from '../erikLive/ErikLiveSync';
import { useSceneStore } from '../store/sceneStore';

/**
 * Reflections of lights that show a picture.
 *
 * The viewport lights glossy surfaces with a plain rectangular area light, so the reflection of a Lumi-Curve (or a ring, an
 * umbrella...) on the car was always a small rectangle, not the light's shape. Here the shape is put into the environment
 * instead: the same composite the HDRI Preview and the Erik live link make (HDRI layers, shapes, gradient and the picture
 * lights) is baked at a modest size and used as the scene environment, and the rectangle light of each picture light is
 * muted so it is not counted twice. The reflection then has the picture's shape, and the HDRI Preview, Erik and the viewport
 * agree. Plain lights are untouched, and the real environment returns as soon as no picture light is left.
 */
const W = 512;
const H = 256;

export class PictureReflections {
  private timer: number | null = null;
  private gen = 0;
  private sig = '';
  private active = false;
  private env: THREE.WebGLRenderTarget | null = null;
  private savedRotation: THREE.Euler | null = null;
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  private disposed = false;

  constructor(
    private sm: SceneManager,
    /** Called when the picture reflections turn off, so the viewport puts its own environment back. */
    private onRestore: () => void,
    /** True while the path tracer is on: it traces the real lights, so nothing is changed then. */
    private isPathTracing: () => boolean,
  ) {}

  private pictureLights(): THREE.RectAreaLight[] {
    const out: THREE.RectAreaLight[] = [];
    this.sm.scene.traverse((o) => {
      const l = o as THREE.RectAreaLight;
      if (l.isRectAreaLight && l.visible && l.userData.hasPicture === true && !l.userData.hideInPathTracer) out.push(l);
    });
    return out;
  }

  private signature(pics: THREE.RectAreaLight[]): string {
    const env = useSceneStore.getState().environment;
    const idOf = (o: object | undefined) => (o ? (this.ids.get(o) ?? (this.ids.set(o, this.nextId), this.nextId++)) : 0);
    return JSON.stringify([
      pics.map((l) => [l.uuid, l.position.toArray(), l.quaternion.toArray(), l.width, l.height, l.userData.baseIntensity, l.color.getHex(), idOf(l.userData.appearanceTex as object | undefined)]),
      env.intensity, env.gradientBackground, env.presetId, env.hdri,
      this.sm.scene.environmentRotation.y, this.active ? idOf(this.sm.scene.environment ?? undefined) : 0,
    ]);
  }

  schedule(): void {
    if (this.disposed) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; void this.refresh(); }, 160);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const pics = this.isPathTracing() ? [] : this.pictureLights();
    if (pics.length === 0) { this.deactivate(); return; }
    // our own environment being (re)assigned is not a change; anything else the viewport did to the environment is
    const ours = this.env?.texture ?? null;
    const sig = this.signature(pics) + (this.active && this.sm.scene.environment !== ours ? '|foreign' : '');
    if (sig === this.sig) return;
    this.sig = sig;
    const my = ++this.gen;

    const layers = await buildCompositeLayers(W, 1.0);
    if (my !== this.gen || this.disposed) return;

    // Two bakes added together: the environment (HDRI layers, shapes, gradient) as it is, and the picture lights on their own.
    // (A muted light carries its real intensity in userData.baseIntensity, which the exporter reads.)
    const origin = new THREE.Vector3(0, 0, 0);
    let pixels: Float32Array;
    try {
      const lightsOnly = await generateAnalyticalHDRI(this.sm.scene, W, H, origin, [], {
        includeAreaModeLights: true,
        lightFilter: (l) => l.userData.hasPicture === true,
        yieldEveryRows: 64,
        isCancelled: () => my !== this.gen,
      });
      pixels = lightsOnly;
      if (layers.length) {
        const base = await generateAnalyticalHDRI(this.sm.scene, W, H, origin, layers, {
          includeAreaModeLights: true,
          lightFilter: () => false,
          yieldEveryRows: 64,
          isCancelled: () => my !== this.gen,
        });
        const k = this.lightScale(pics, lightsOnly);
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = base[i] + lightsOnly[i] * k;
          pixels[i + 1] = base[i + 1] + lightsOnly[i + 1] * k;
          pixels[i + 2] = base[i + 2] + lightsOnly[i + 2] * k;
          pixels[i + 3] = 1;
        }
      } else {
        const k = this.lightScale(pics, lightsOnly);
        for (let i = 0; i < pixels.length; i += 4) { pixels[i] *= k; pixels[i + 1] *= k; pixels[i + 2] *= k; pixels[i + 3] = 1; }
      }
    } catch { return; }                                   // superseded by a newer bake, or it failed: keep what is showing
    if (my !== this.gen || this.disposed) return;

    const tex = new THREE.DataTexture(pixels, W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.flipY = false;
    tex.needsUpdate = true;
    const rt = this.sm.pmremGenerator.fromEquirectangular(tex);
    tex.dispose();

    const prev = this.env;
    this.env = rt;
    if (!this.active) this.savedRotation = this.sm.scene.environmentRotation.clone();
    this.active = true;
    this.sm.scene.environment = rt.texture;
    this.sm.scene.environmentRotation = new THREE.Euler(0, 0, 0);         // the layers carry their own rotation
    this.sm.scene.environmentIntensity = useSceneStore.getState().environment.intensity;
    prev?.dispose();
    for (const l of pics) l.userData.envReflected = true;                  // mute the rectangle light: the environment reflects it now
    for (const l of pics) l.intensity = 0;
    this.sig = this.signature(this.pictureLights());
  }

  /**
   * The HDRI is in real HDR units (a light's peak is in the thousands), while the viewport's rectangle light was a few units.
   * So the picture lights are scaled to give the model the same overall light as that rectangle did (its intensity x the
   * picture's mean x the solid angle it covers); only the SHAPE of the reflection changes, not how bright the model is.
   */
  private lightScale(pics: THREE.RectAreaLight[], baked: Float32Array): number {
    let target = 0;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), n = new THREE.Vector3();
    for (const l of pics) {
      const tex = l.userData.appearanceTex as { data: Float32Array; width: number; height: number } | undefined;
      let mean = 1;
      if (tex) {
        let sum = 0;
        const px = tex.width * tex.height;
        for (let i = 0; i < px; i++) {
          const a = tex.data[i * 4 + 3];
          sum += (0.2126 * tex.data[i * 4] + 0.7152 * tex.data[i * 4 + 1] + 0.0722 * tex.data[i * 4 + 2]) * a;
        }
        mean = sum / Math.max(1, px);
      }
      l.getWorldPosition(pos);
      l.getWorldQuaternion(q);
      n.set(0, 0, -1).applyQuaternion(q);
      const d2 = Math.max(0.25, pos.lengthSq());
      const cos = Math.max(0.05, n.dot(pos.clone().multiplyScalar(-1).normalize()));
      const base = typeof l.userData.baseIntensity === 'number' ? (l.userData.baseIntensity as number) : 1;
      const bc = (l.userData.baseColor as THREE.Color | undefined) ?? new THREE.Color(1, 1, 1);
      const col = 0.2126 * bc.r + 0.7152 * bc.g + 0.0722 * bc.b;
      target += base * col * mean * ((l.width * l.height * cos) / d2);
    }
    let actual = 0;
    for (let y = 0; y < H; y++) {
      const sinT = Math.sin(((y + 0.5) / H) * Math.PI);
      const dOmega = sinT * ((2 * Math.PI) / W) * (Math.PI / H);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        actual += (0.2126 * baked[i] + 0.7152 * baked[i + 1] + 0.0722 * baked[i + 2]) * dOmega;
      }
    }
    if (actual <= 1e-9) return 1;
    return Math.min(1, Math.max(1e-5, target / actual));
  }

  private deactivate(): void {
    this.gen++;
    this.sig = '';
    if (!this.active) return;
    this.active = false;
    this.sm.scene.traverse((o) => {
      const l = o as THREE.RectAreaLight;
      if (l.isRectAreaLight && l.userData.envReflected) {
        l.userData.envReflected = false;
        if (typeof l.userData.baseIntensity === 'number') l.intensity = l.userData.baseIntensity as number;
      }
    });
    if (this.savedRotation) this.sm.scene.environmentRotation = this.savedRotation;
    this.savedRotation = null;
    this.env?.dispose();
    this.env = null;
    this.onRestore();                                      // the viewport reassigns its real environment
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.deactivate();
  }
}
