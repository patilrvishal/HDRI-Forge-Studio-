import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { setRawModelData, clearRawModelData } from '../store/modelDataStore';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { GroundSettings } from '../types/Scene';
import { paintGradientOntoContext } from './HDRIExporter';

let _rectAreaLibInitialized = false;
function ensureRectAreaLib(): void {
  if (!_rectAreaLibInitialized) {
    RectAreaLightUniformsLib.init();
    _rectAreaLibInitialized = true;
  }
}

export interface SceneInstances {
  sceneManager: SceneManager;
  renderPipeline: RenderPipeline;
  lightManager: LightManager;
  modelLoader: ModelLoader;
}

export class SceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** True while the user is orbit-dragging a scripted camera. */
  _cameraDragging = false;
  container: HTMLElement | null = null;
  ground: THREE.Mesh | null = null;
  groundOverlay: THREE.Mesh | null = null;
  grid: THREE.GridHelper | null = null;
  _groundSettings: GroundSettings | null = null;
  pmremGenerator: THREE.PMREMGenerator;
  _animationId: number = 0;
  _clock = new THREE.Clock();
  _onFrame: ((delta: number) => void) | null = null;
  _turntableActive = false;
  _turntableSpeed = 1.0;
  /** CubeCamera for real-time PBR floor reflections */
  _floorCubeCamera: THREE.CubeCamera | null = null;
  _floorCubeRT: THREE.WebGLCubeRenderTarget | null = null;
  _floorMaterial: THREE.MeshStandardMaterial | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    // Limbo background: a vertical fade with a soft radial hotspot behind the
    // subject. This is the standard automotive studio backdrop - a flat colour
    // makes a dark car read as a silhouette with no separation from the void.
    this.scene.background = createLimboBackground();
    // Depth fog: without it every grid line reads at the same brightness
    // regardless of distance, which is what makes a floor grid look flat.
    // Fading distant lines into the background colour is what gives the
    // "spotlight pool" look - grid crisp near the subject, dissolving into
    // the dark at the edges of the frame.
    this.scene.fog = new THREE.Fog(0x05070d, 8, 30);
    // Soft "spotlight pool" on the floor - a wide, dim additive glow centred
    // at the origin so the ground reads as lit from above rather than a flat
    // grid on a flat colour. Independent of any light rig or loaded model.
    this.scene.add(createFloorSpotlightPool());

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(5, 3, 5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();

    // Track drag state so applyActiveCamera() can skip re-applying the stored
    // position mid-drag, and write the manually-adjusted position back into the
    // camera store on release.
    this.controls.addEventListener('start', () => {
      this._cameraDragging = true;
    });
    this.controls.addEventListener('end', () => {
      this._cameraDragging = false;
      const store = (window as unknown as {
        __cameraStore?: {
          getState: () => {
            activeCameraId: string | null;
            updateCamera: (id: string, updates: Record<string, unknown>) => void;
          };
        };
      }).__cameraStore;
      const s = store?.getState();
      if (s?.activeCameraId) {
        s.updateCamera(s.activeCameraId, {
          position: {
            x: this.camera.position.x,
            y: this.camera.position.y,
            z: this.camera.position.z,
          },
          rotation: {
            x: (this.camera.rotation.x * 180) / Math.PI,
            y: (this.camera.rotation.y * 180) / Math.PI,
            z: (this.camera.rotation.z * 180) / Math.PI,
          },
        });
      }
    });

    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // Ambient light
    const ambient = new THREE.AmbientLight(0x404060, 0.15);
    this.scene.add(ambient);
  }

  attach(container: HTMLElement): void {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    // Ground plane (placeholder - will be replaced by updateGround)
    this.ground = null;
    this.groundOverlay = null;
    this._floorCubeCamera = null;
    this._floorCubeRT = null;
    this._floorMaterial = null;

    this.setGrid(true);
    this.resize();
  }

  detach(): void {
    if (this.container && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.container = null;
  }

  resize(): void {
    if (!this.container) return;
    const w = Math.max(2, this.container.clientWidth);
    const h = Math.max(2, this.container.clientHeight);
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  getContainerSize(): { width: number; height: number } {
    if (!this.container) return { width: 0, height: 0 };
    const dpr = this.renderer.getPixelRatio();
    return {
      width: Math.round(this.container.clientWidth * dpr),
      height: Math.round(this.container.clientHeight * dpr),
    };
  }

  /** Remove existing ground objects from the scene and dispose their resources. */
  private _disposeGround(): void {
    if (this.groundOverlay) {
      this.scene.remove(this.groundOverlay);
      this.groundOverlay.geometry.dispose();
      (this.groundOverlay.material as THREE.Material).dispose();
      this.groundOverlay = null;
    }
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      if (Array.isArray(this.ground.material)) {
        this.ground.material.forEach((m) => m.dispose());
      } else {
        this.ground.material.dispose();
      }
      this.ground = null;
    }
    if (this._floorCubeCamera) {
      if (this._floorCubeCamera && typeof this._floorCubeCamera.dispose === 'function') {
  this._floorCubeCamera.dispose();
}
      this._floorCubeCamera = null;
    }
    if (this._floorCubeRT) {
      this._floorCubeRT.dispose();
      this._floorCubeRT = null;
    }
    this._floorMaterial = null;
  }

  /**
   * Rebuild the ground plane according to the given settings.
   * Always uses MeshStandardMaterial (PBR) so roughness/metalness work correctly.
   * - reflections=true  â†’ CubeCamera real-time reflections via envMap
   * - reflections=false â†’ Scene environment only (or none)
   */
  updateGround(settings?: GroundSettings | null): void {
    if (!settings) return;
    // Merge with defaults so old scene files missing new fields don't crash
    const merged: GroundSettings = {
      visible: true,
      reflections: true,
      reflectionSharpness: 0.85,
      color: '#111118',
      roughness: 0.15,
      metalness: 0.95,
      fadeRadius: 8.0,
      ...settings,
    };
    this._groundSettings = merged;
    this._disposeGround();

    if (!merged.visible) return;

    const GROUND_SIZE = merged.size ?? 40;
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    const color = new THREE.Color(merged.color);

    // ------ PBR ground material (always MeshStandardMaterial) ------
    const groundMat = new THREE.MeshStandardMaterial({
      color: color.getHex(),
      metalness: merged.metalness,
      roughness: merged.roughness,
      envMapIntensity: 1.0,
      side: THREE.FrontSide,
    });
    this._floorMaterial = groundMat;

    if (merged.reflections) {
      // ------ CubeCamera for real-time planar reflections ------
      try {
        const dpr = Math.min(window.devicePixelRatio, 2);
        const cubeRTSize = Math.max(128, Math.round(512 * dpr));

        this._floorCubeRT = new THREE.WebGLCubeRenderTarget(cubeRTSize, {
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
          magFilter: THREE.LinearFilter,
        });

        this._floorCubeCamera = new THREE.CubeCamera(0.1, 100, this._floorCubeRT);
        this._floorCubeCamera.position.set(0, 0.01, 0); // slightly above floor
        this._floorCubeCamera.userData.isProxy = true; // hide from SceneHierarchy
        this.scene.add(this._floorCubeCamera);

        // Use CubeCamera texture as envMap; roughness controls blur via mip levels
        groundMat.envMap = this._floorCubeRT.texture;
        groundMat.envMapIntensity = merged.reflectionSharpness;
      } catch (e) {
        console.warn('[LightForge] CubeCamera creation failed, falling back to env-only reflections:', e);
        this._floorCubeCamera = null;
        if (this._floorCubeRT) { this._floorCubeRT.dispose(); this._floorCubeRT = null; }
        if (this.scene.environment) {
          groundMat.envMap = this.scene.environment;
        }
        groundMat.envMapIntensity = 0.5;
      }
    } else {
      // No real-time reflections - use scene environment map if available
      if (this.scene.environment) {
        groundMat.envMap = this.scene.environment;
      }
      groundMat.envMapIntensity = 0.5;
    }

    this.ground = new THREE.Mesh(groundGeo, groundMat);

    // Base orientation: -90deg on X lays the plane flat. User rotation is
    // applied ON TOP of that, so 0/0/0 means "horizontal", not "vertical".
    const gPos = merged.position ?? { x: 0, y: 0, z: 0 };
    const gRot = merged.rotation ?? { x: 0, y: 0, z: 0 };
    const D2R = Math.PI / 180;

    this.ground.rotation.set(
      -Math.PI / 2 + gRot.x * D2R,
      gRot.y * D2R,
      gRot.z * D2R,
    );
    this.ground.position.set(gPos.x, gPos.y - 0.005, gPos.z);
    this.ground.receiveShadow = true;
    this.ground.name = '__floor__';
    this.scene.add(this.ground);

    // ------ Fade overlay: fades ground edges into background ------
    if (merged.fadeRadius > 0) {
      const overlayGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
      const overlayMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uFadeRadius: { value: merged.fadeRadius },
          uGroundSize: { value: GROUND_SIZE / 2 },
          uBgColor: { value: new THREE.Color('#0a0f1c') },
        },
        vertexShader: /* glsl */ `
          varying vec2 vWorldPos;
          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uFadeRadius;
          uniform float uGroundSize;
          uniform vec3 uBgColor;
          varying vec2 vWorldPos;
          void main() {
            float dist = length(vWorldPos);
            float fade = 1.0 - smoothstep(uFadeRadius, uGroundSize, dist);
            gl_FragColor = vec4(uBgColor, 1.0 - fade);
          }
        `,
      });
      this.groundOverlay = new THREE.Mesh(overlayGeo, overlayMat);
      this.groundOverlay.rotation.x = -Math.PI / 2;
      this.groundOverlay.position.y = -0.003;
      this.groundOverlay.userData.isProxy = true; // hide from SceneHierarchy
      this.scene.add(this.groundOverlay);
    }
  }

  setGrid(visible: boolean): void {
    if (visible && !this.grid) {
      this.grid = new THREE.GridHelper(20, 40, 0x3d4a68, 0x212a40);
      this.grid.position.y = 0.005;
      this.grid.userData.isGrid = true; // hide from SceneHierarchy
      this.scene.add(this.grid);
    } else if (!visible && this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
    if (this.grid) this.grid.visible = visible;
  }

  setBackground(color: string, show: boolean): void {
    if (show) {
      this.scene.background = new THREE.Color(color);
    } else {
      // Fall back to the limbo backdrop, not a flat colour. A dark car against
      // flat #0d0d1a is a silhouette in a void - the gradient gives it something
      // to separate against.
      this.scene.background = createLimboBackground();
    }
  }

  setGradientBackground(config: GradientBackgroundConfig): void {
    this.scene.background = createGradientBackground(config);
  }

  setTurntable(active: boolean, speed: number): void {
    this._turntableActive = active;
    this._turntableSpeed = speed;
  }

  animateCameraTo(
    position: [number, number, number],
    target: [number, number, number],
    duration: number = 600
  ): void {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endPos = new THREE.Vector3(...position);
    const endTarget = new THREE.Vector3(...target);
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      this.camera.position.lerpVectors(startPos, endPos, ease);
      this.controls.target.lerpVectors(startTarget, endTarget, ease);
      this.controls.update();

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  setOnFrame(cb: (delta: number) => void): void {
    this._onFrame = cb;
  }

  startRenderLoop(): void {
    const loop = () => {
      this._animationId = requestAnimationFrame(loop);
      const delta = this._clock.getDelta();

      // Turntable rotation
      if (this._turntableActive) {
        const model = this._findModel();
        if (model) {
          model.rotation.y += delta * this._turntableSpeed * 0.5;
        }
      }

      // Update CubeCamera for PBR floor reflections (hide floor to avoid self-reflection)
      if (this._floorCubeCamera && this.ground && this._groundSettings?.reflections) {
        this.ground.visible = false;
        this._floorCubeCamera.update(this.renderer, this.scene);
        this.ground.visible = true;
      }

      if (this._onFrame) this._onFrame(delta);
      const scriptedCam = this.applyActiveCamera();
      if (!scriptedCam) this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  _findModel(): THREE.Object3D | null {
    for (const child of this.scene.children) {
      if (
        child.type === 'Group' &&
        !(child instanceof THREE.GridHelper) &&
        !child.userData.isHelper &&
        child !== this.ground &&
        child !== this._floorCubeCamera
      ) {
        return child;
      }
    }
    return null;
  }

  stopRenderLoop(): void {
    cancelAnimationFrame(this._animationId);
  }

  getCameraState(): { position: [number, number, number]; target: [number, number, number]; fov: number } {
    const target = this.controls.target;
    return {
      position: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ] as [number, number, number],
      target: [target.x, target.y, target.z] as [number, number, number],
      fov: this.camera.fov,
    };
  }

  setCameraState(position: [number, number, number], target: [number, number, number], fov?: number): void {
    this.camera.position.set(...position);
    this.controls.target.set(...target);
    this.controls.update();
    if (fov !== undefined) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  takeScreenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * If a scripted camera is active, drive the real viewport camera from it and,
   * when it has a target, lookAt() the target's live world position every frame.
   * OrbitControls is disabled while a camera is active so the user cannot fight
   * the scripted transform.
   */
  applyActiveCamera(): boolean {
    const store = (window as unknown as {
      __cameraStore?: { getState: () => {
        getActiveCamera: () => null | {
          position: { x: number; y: number; z: number };
          rotation: { x: number; y: number; z: number };
          targetId: string | null;
          fov: number;
        };
      } };
    }).__cameraStore;

    const cam = store?.getState().getActiveCamera() ?? null;

    if (!cam) {
      if (!this.controls.enabled) this.controls.enabled = true;
      return false;
    }

    // A scripted camera owns the view, but orbit-drag is allowed to adjust it.
    // The target must be the ORBIT PIVOT (the model, or origin), never the
    // camera's own position - setting target to the camera position every
    // frame made the pivot degenerate and cancelled out drag input, which is
    // why the viewport never visibly moved even though the stored value did.
    this.controls.enabled = true;

    if (this._cameraDragging) {
      // Mid-drag: OrbitControls already owns camera.position this frame.
      // Do not stomp it, and do not touch target - the user is spinning it.
      return true;
    }

    // When there's no explicit look-at target, the pivot MUST lie on the
    // camera's own view ray (position + its forward direction) - not an
    // unrelated point like the model's bounding-box center. OrbitControls
    // reads its internal spherical state directly off (position - target)
    // for its own pointer-event handling, independent of the render loop's
    // gating below; a mismatched target meant the very first drag snapped
    // the camera toward that unrelated point instead of orbiting around
    // where it actually looks, silently corrupting a pushed camera's
    // position/rotation the moment the user touched the viewport.
    let pivot: { x: number; y: number; z: number };
    if (cam.targetId) {
      pivot = this.resolveTargetWorld(cam.targetId) ?? { x: 0, y: 0, z: 0 };
    } else {
      const rotRad = new THREE.Euler(
        (cam.rotation.x * Math.PI) / 180,
        (cam.rotation.y * Math.PI) / 180,
        (cam.rotation.z * Math.PI) / 180,
      );
      const forward = new THREE.Vector3(0, 0, -1).applyEuler(rotRad);
      pivot = {
        x: cam.position.x + forward.x,
        y: cam.position.y + forward.y,
        z: cam.position.z + forward.z,
      };
    }
    this.controls.target.set(pivot.x, pivot.y, pivot.z);

    this.camera.position.set(cam.position.x, cam.position.y, cam.position.z);

    if (cam.fov !== this.camera.fov) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }

    if (cam.targetId) {
      const t = this.resolveTargetWorld(cam.targetId);
      if (t) this.camera.lookAt(t.x, t.y, t.z);
    } else {
      this.camera.rotation.set(
        (cam.rotation.x * Math.PI) / 180,
        (cam.rotation.y * Math.PI) / 180,
        (cam.rotation.z * Math.PI) / 180,
      );
    }
    return true;
  }

  /** Resolve a camera target id ('model' | 'origin' | 'light:<id>') to a world point. */
  private resolveTargetWorld(targetId: string): { x: number; y: number; z: number } | null {
    if (targetId === 'origin') return { x: 0, y: 0, z: 0 };

    if (targetId === 'model') {
      const box = new THREE.Box3();
      let found = false;
      this.scene.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          !o.userData?.isHelper &&
          !o.userData?.isProxy &&
          o.name !== '__floor__'
        ) {
          const b = new THREE.Box3().setFromObject(o);
          const s = b.getSize(new THREE.Vector3());
          if (Math.max(s.x, s.y, s.z) < 500) { box.expandByObject(o); found = true; }
        }
      });
      if (!found) return { x: 0, y: 0, z: 0 };
      const c = box.getCenter(new THREE.Vector3());
      return { x: c.x, y: c.y, z: c.z };
    }

    if (targetId.startsWith('light:')) {
      const id = targetId.slice(6);
      let pos: { x: number; y: number; z: number } | null = null;
      this.scene.traverse((o) => {
        if (o.userData?.lightId === id) {
          const w = o.getWorldPosition(new THREE.Vector3());
          pos = { x: w.x, y: w.y, z: w.z };
        }
      });
      return pos;
    }

    return null;
  }
  dispose(): void {
    this.stopRenderLoop();
    this.detach();
    this._disposeGround(); // properly clean up CubeCamera + render targets
    this.pmremGenerator.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.controls.dispose();
    this.renderer.dispose();
  }
}

// ------ Vignette shader (custom) ------------------------------------------------------------------------------------------------------------------------------------------------
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    intensity: { value: 0.4 },
    offset: { value: 1.1 },
    darkness: { value: 1.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float intensity;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      float vig = clamp(1.0 - dot(uv, uv), 0.0, 1.0);
      float f = mix(1.0, vig, intensity * darkness);
      gl_FragColor = vec4(texel.rgb * f, texel.a);
    }
  `,
};

// ------ Color Grading shader (brightness / contrast / saturation) ---------------------------------------------
const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    brightness: { value: 0.0 },
    contrast: { value: 0.0 },
    saturation: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Brightness
      c += brightness * 0.5;

      // Contrast
      c = (c - 0.5) * (1.0 + contrast) + 0.5;

      // Saturation
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(lum), c, 1.0 + saturation);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
    }
  `,
};

// ------ Pipeline settings interface ---------------------------------------------------------------------------------------------------------------------------------------
export interface PipelineConfig {
  bloom: { enabled: boolean; intensity: number; threshold: number; radius: number };
  ao: { enabled: boolean; radius: number; intensity: number };
  vignette: { enabled: boolean; intensity: number };
  colorGrading: { enabled: boolean; brightness: number; contrast: number; saturation: number };
  antialiasing: 'none' | 'fxaa' | 'smaa' | 'taa';
  shadowQuality: 'none' | 'low' | 'medium' | 'high';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  tonemapping: 'aces' | 'reinhard' | 'linear';
  exposure: number;
}

export class RenderPipeline {
  private _sm: SceneManager;
  private _composer: EffectComposer | null = null;
  private _renderPass: RenderPass | null = null;
  private _bloomPass: UnrealBloomPass | null = null;
  private _smaaPass: SMAAPass | null = null;
  private _fxaaPass: ShaderPass | null = null;
  private _ssaoPass: SSAOPass | null = null;
  private _vignettePass: ShaderPass | null = null;
  private _colorGradingPass: ShaderPass | null = null;
  private _outputPass: OutputPass | null = null;
  private _config: PipelineConfig;
  private _needsRebuild = false;

  constructor(sceneManager: SceneManager) {
    this._sm = sceneManager;
    this._config = {
      bloom: { enabled: true, intensity: 0.3, threshold: 0.8, radius: 0.5 },
      ao: { enabled: false, radius: 0.5, intensity: 0.5 },
      vignette: { enabled: false, intensity: 0.4 },
      colorGrading: { enabled: false, brightness: 0, contrast: 0, saturation: 0 },
      antialiasing: 'smaa',
      shadowQuality: 'high',
      quality: 'high',
      tonemapping: 'aces',
      exposure: 1.0,
    };
  }

  /** Build (or rebuild) the EffectComposer from scratch. */
  build(): void {
    this.dispose();
    const r = this._sm.renderer;
    const w = r.domElement.width || r.getSize(new THREE.Vector2()).x || 2;
    const h = r.domElement.height || r.getSize(new THREE.Vector2()).y || 2;

    this._composer = new EffectComposer(r);
    this._renderPass = new RenderPass(this._sm.scene, this._sm.camera);
    this._composer.addPass(this._renderPass);

    // Bloom
    if (this._config.bloom.enabled) {
      this._bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w / 2, h / 2),
        this._config.bloom.intensity,
        this._config.bloom.radius,
        this._config.bloom.threshold,
      );
      this._composer.addPass(this._bloomPass);
    }

    // Anti-aliasing
    if (this._config.antialiasing === 'smaa') {
      // @ts-expect-error - SMAAPass types are incomplete in @types/three
      this._smaaPass = new SMAAPass(w, h);
      this._composer.addPass(this._smaaPass);
    } else if (this._config.antialiasing === 'fxaa') {
      const fxaaMat = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: { ...FXAAShader.uniforms, resolution: { value: new THREE.Vector2(1 / w, 1 / h) } } });
      this._fxaaPass = new ShaderPass(fxaaMat);
      this._composer.addPass(this._fxaaPass);
    }
    // 'taa' - handled via renderer settings + jitter; we keep SMAA as fallback
    // 'none' - no AA pass

    // SSAO
    if (this._config.ao.enabled) {
      this._ssaoPass = new SSAOPass(
        this._sm.scene,
        this._sm.camera,
        w,
        h,
      );
      this._applyAOParams(this._config.ao.radius, this._config.ao.intensity);
      this._ssaoPass.output = SSAOPass.OUTPUT.Default;
      this._composer.addPass(this._ssaoPass);
    }

    // Vignette
    if (this._config.vignette.enabled) {
      const vMat = new THREE.ShaderMaterial(VignetteShader);
      vMat.uniforms['intensity'].value = this._config.vignette.intensity;
      this._vignettePass = new ShaderPass(vMat);
      this._composer.addPass(this._vignettePass);
    }

    // Color grading
    if (this._config.colorGrading.enabled) {
      const cgMat = new THREE.ShaderMaterial(ColorGradingShader);
      cgMat.uniforms['brightness'].value = this._config.colorGrading.brightness;
      cgMat.uniforms['contrast'].value = this._config.colorGrading.contrast;
      cgMat.uniforms['saturation'].value = this._config.colorGrading.saturation;
      this._colorGradingPass = new ShaderPass(cgMat);
      this._composer.addPass(this._colorGradingPass);
    }

    // OutputPass applies renderer.toneMapping + toneMappingExposure and the
    // final color space conversion. Without it, EffectComposer's intermediate
    // render targets stay linear and every pass after RenderPass silently
    // ignores exposure/tone mapping - confirmed by direct renderer.render()
    // responding to toneMappingExposure while composer.render() did not.
    this._outputPass = new OutputPass();
    this._composer.addPass(this._outputPass);

    // Apply tone mapping & exposure to the renderer
    this._applyToneMapping(this._config.tonemapping);
    this._sm.renderer.toneMappingExposure = this._config.exposure;

    // Shadow quality
    this._applyShadowQuality(this._config.shadowQuality);
  }

  /** Render one frame through the composer (or fallback direct render). */
  render(): void {
    if (this._composer) {
      this._composer.render();
    } else {
      this._sm.renderer.render(this._sm.scene, this._sm.camera);
    }
  }

  /** Resize the composer and internal passes. */
  resize(): void {
    if (!this._composer) return;
    const r = this._sm.renderer;
    const size = r.getSize(new THREE.Vector2());
    const w = size.x || 2;
    const h = size.y || 2;
    this._composer.setSize(w, h);

    if (this._bloomPass) {
      this._bloomPass.resolution.set(w / 2, h / 2);
    }
    if (this._ssaoPass) {
      this._ssaoPass.setSize(w, h);
    }
    if (this._smaaPass) {
      this._smaaPass.setSize(w, h);
    }
    if (this._fxaaPass) {
      const mat = this._fxaaPass.material as THREE.ShaderMaterial;
      const res = mat.uniforms['resolution'];
      if (res && res.value instanceof THREE.Vector2) {
        res.value.set(1 / w, 1 / h);
      }
    }
  }

  /** Update the full pipeline config. Rebuilds composer if structural changes detected. */
  updateConfig(cfg: Partial<PipelineConfig>): void {
    const prev = { ...this._config };
    this._config = { ...this._config, ...cfg };

    const structuralChange =
      cfg.bloom?.enabled !== undefined && cfg.bloom.enabled !== prev.bloom.enabled ||
      cfg.antialiasing !== undefined && cfg.antialiasing !== prev.antialiasing ||
      cfg.vignette?.enabled !== undefined && cfg.vignette.enabled !== prev.vignette.enabled ||
      cfg.ao?.enabled !== undefined && cfg.ao.enabled !== prev.ao.enabled ||
      cfg.colorGrading?.enabled !== undefined && cfg.colorGrading.enabled !== prev.colorGrading.enabled;

    if (structuralChange) {
      this.build();
      return;
    }

    // In-place parameter updates (no rebuild needed)
    if (this._bloomPass && cfg.bloom) {
      this._bloomPass.strength = cfg.bloom.intensity ?? this._bloomPass.strength;
      this._bloomPass.radius = cfg.bloom.radius ?? this._bloomPass.radius;
      this._bloomPass.threshold = cfg.bloom.threshold ?? this._bloomPass.threshold;
    }

    if (this._ssaoPass && cfg.ao) {
      this._applyAOParams(
        cfg.ao.radius ?? this._config.ao.radius,
        cfg.ao.intensity ?? this._config.ao.intensity,
      );
    }

    if (this._vignettePass && cfg.vignette) {
      const mat = this._vignettePass.material as THREE.ShaderMaterial;
      mat.uniforms['intensity'].value = cfg.vignette.intensity ?? 0.4;
    }

    if (this._colorGradingPass && cfg.colorGrading) {
      const mat = this._colorGradingPass.material as THREE.ShaderMaterial;
      if (cfg.colorGrading.brightness !== undefined) mat.uniforms['brightness'].value = cfg.colorGrading.brightness;
      if (cfg.colorGrading.contrast !== undefined) mat.uniforms['contrast'].value = cfg.colorGrading.contrast;
      if (cfg.colorGrading.saturation !== undefined) mat.uniforms['saturation'].value = cfg.colorGrading.saturation;
    }

    if (cfg.tonemapping !== undefined) {
      this._applyToneMapping(cfg.tonemapping);
    }
    if (cfg.exposure !== undefined) {
      this._sm.renderer.toneMappingExposure = cfg.exposure;
    }
    if (cfg.shadowQuality !== undefined) {
      this._applyShadowQuality(cfg.shadowQuality);
    }
    if (cfg.quality !== undefined) {
      this._applyQuality(cfg.quality);
    }
  }

  // ------ Convenience setters (called from Viewport sync) ---------------------------------------------------------------------

  setEngine(engine: 'pbr' | 'pathtracer'): void {
    if (engine === 'pbr') {
      this._applyToneMapping(this._config.tonemapping);
    } else {
      this._sm.renderer.toneMapping = THREE.NoToneMapping;
    }
  }

  setToneMapping(mapping: 'aces' | 'reinhard' | 'linear'): void {
    this._config.tonemapping = mapping;
    this._applyToneMapping(mapping);
  }

  setBloom(enabled: boolean, intensity: number, threshold: number, radius: number): void {
    this.updateConfig({
      bloom: { enabled, intensity, threshold, radius },
    });
  }

  setAO(enabled: boolean, radius: number, intensity: number): void {
    this.updateConfig({
      ao: { enabled, radius, intensity },
    });
  }

  setAntialiasing(mode: 'none' | 'fxaa' | 'smaa' | 'taa'): void {
    this.updateConfig({ antialiasing: mode });
  }

  setShadowQuality(quality: 'none' | 'low' | 'medium' | 'high'): void {
    this._config.shadowQuality = quality;
    this._applyShadowQuality(quality);
  }

  setQuality(quality: 'low' | 'medium' | 'high' | 'ultra'): void {
    this._config.quality = quality;
    this._applyQuality(quality);
  }

  setExposure(exposure: number): void {
    this._config.exposure = exposure;
    this._sm.renderer.toneMappingExposure = exposure;
  }

  setVignette(enabled: boolean, intensity: number): void {
    this.updateConfig({ vignette: { enabled, intensity } });
  }

  setColorGrading(enabled: boolean, brightness: number, contrast: number, saturation: number): void {
    this.updateConfig({ colorGrading: { enabled, brightness, contrast, saturation } });
  }

  /** Get the EffectComposer (for screenshot / export via composer). */
  getComposer(): EffectComposer | null {
    return this._composer;
  }

  /** Take a screenshot - renders one frame and returns a data URL. */
  capture(): string {
    this.render();
    return this._sm.renderer.domElement.toDataURL('image/png');
  }

  /** Dispose all passes and the composer. */
  dispose(): void {
    if (this._composer) {
      const passes = this._composer.passes.slice().reverse();
      for (const pass of passes) {
        if ('dispose' in pass && typeof (pass as { dispose: () => void }).dispose === 'function') {
          (pass as { dispose: () => void }).dispose();
        }
      }
      this._composer.dispose();
    }
    this._composer = null;
    this._renderPass = null;
    this._bloomPass = null;
    this._ssaoPass = null;
    this._smaaPass = null;
    this._fxaaPass = null;
    this._vignettePass = null;
    this._colorGradingPass = null;
    this._outputPass = null;
  }

  // ------ Private helpers ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Apply SSAO parameters - radius controls kernel spread, intensity controls maxDistance scaling. */
  private _applyAOParams(radius: number, intensity: number): void {
    if (!this._ssaoPass) return;
    this._ssaoPass.kernelRadius = radius;
    this._ssaoPass.minDistance = 0.005;
    // Scale maxDistance with intensity: higher intensity â†’ AO visible at greater depth range
    // Tuned for car-scale scenes (objects ~2-5m across)
    this._ssaoPass.maxDistance = 0.05 + intensity * 0.5;
  }

  private _applyToneMapping(mapping: 'aces' | 'reinhard' | 'linear'): void {
    const r = this._sm.renderer;
    switch (mapping) {
      case 'aces':
        r.toneMapping = THREE.ACESFilmicToneMapping;
        break;
      case 'reinhard':
        r.toneMapping = THREE.ReinhardToneMapping;
        break;
      case 'linear':
        r.toneMapping = THREE.LinearToneMapping;
        break;
    }
    r.toneMappingExposure = this._config.exposure;
  }

  private _applyShadowQuality(quality: string): void {
    const r = this._sm.renderer;
    switch (quality) {
      case 'none':
        r.shadowMap.enabled = false;
        break;
      case 'low':
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.BasicShadowMap;
        break;
      case 'medium':
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFShadowMap;
        break;
      case 'high':
      default:
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        break;
    }

    // Update shadow map sizes on all lights
    this._sm.scene.traverse((child) => {
      const light = child as THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;
      if (light.isLight && light.shadow) {
        const shadow = light.shadow;
        switch (quality) {
          case 'low':
            shadow.mapSize.set(512, 512);
            break;
          case 'medium':
            shadow.mapSize.set(1024, 1024);
            break;
          case 'high':
          default:
            shadow.mapSize.set(2048, 2048);
            break;
        }
        if (shadow.map) {
          shadow.map.dispose();
          shadow.map = null;
        }
      }
    });
  }

  private _applyQuality(quality: 'low' | 'medium' | 'high' | 'ultra'): void {
    const r = this._sm.renderer;
    switch (quality) {
      case 'low':
        r.setPixelRatio(1);
        break;
      case 'medium':
        r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        break;
      case 'high':
        r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        break;
      case 'ultra':
        r.setPixelRatio(window.devicePixelRatio);
        break;
    }
    this._sm.resize();
    if (this._composer) {
      this.resize();
    }
  }
}

interface LightSyncEntry {
  id: string;
  type: string;
  color: string;
  brightness: number;
  opacity: number;
  visible: boolean;
  solo: boolean;
  falloff: string;
  gearVisible: boolean;
  transform: {
    position: { x: number; y: number; z: number };
    spherical: { lat: number; lng: number; radius: number; height: number };
    rotation: { x: number; y: number; z: number; enabled: boolean };
  };
  // Spotlight-specific
  spotAngle?: number;
  spotPenumbra?: number;
  spotDecay?: number;
  // Area light specific
  areaWidth?: number;
  areaHeight?: number;
  edgeSoftness?: number;
  dropShadow?: { enabled: boolean; angle: number; distance: number; intensity: number; softness: number };
}

interface LightObjectEntry {
  object: THREE.Object3D;
  lightType: string;
  target?: THREE.Object3D;
}

export class LightManager {
  private _scene: THREE.Scene;
  private _entries: Map<string, LightObjectEntry> = new Map();
  private _helpers: Map<string, THREE.Object3D> = new Map();
  private _types: Map<string, string> = new Map();

  constructor(scene: THREE.Scene) {
    this._scene = scene;
    ensureRectAreaLib();
  }

  syncLights(lights: LightSyncEntry[]): void {
    const activeIds = new Set(lights.map((l) => l.id));
    const hasSolo = lights.some((l) => l.solo);

    // Remove stale lights
    for (const [id] of this._entries) {
      if (!activeIds.has(id)) {
        this._removeLight(id);
      }
    }

    // Create or update each light
    for (const ld of lights) {
      const isEffectiveSolo = hasSolo ? ld.solo : true;
      const shouldShow = ld.visible && isEffectiveSolo;

      const existing = this._entries.get(ld.id);
      const currentType = this._types.get(ld.id);

      // If type changed, recreate the light
      if (existing && currentType !== ld.type) {
        this._removeLight(ld.id);
      }

      if (!this._entries.has(ld.id)) {
        this._createLight(ld);
      }

      this._updateLight(ld, shouldShow);
    }
  }

  private _createLight(ld: LightSyncEntry): void {
    ensureRectAreaLib();
    const lightObj = this._createLightByType(ld.type);

    // For spot/directional, add a target object
    let target: THREE.Object3D | undefined;
    if (lightObj instanceof THREE.SpotLight || lightObj instanceof THREE.DirectionalLight) {
      target = new THREE.Object3D();
      target.position.set(0, 0, 0);
      this._scene.add(target);
      lightObj.target = target;
    }

    this._scene.add(lightObj);
    this._entries.set(ld.id, { object: lightObj, lightType: ld.type, target });
    this._types.set(ld.id, ld.type);

    // Create helper
    // Stamp the store id onto the THREE object so the gizmo can find this
    // light without reaching into LightManager internals.
    lightObj.userData.lightId = ld.id;
    lightObj.userData.edgeSoftness = ld.edgeSoftness ?? 50;
    lightObj.userData.dropShadow = ld.dropShadow;
    // Raw 0-1 opacity, separate from the baked-into-intensity value below -
    // the HDRI exporter needs this on its own to alpha-composite an area
    // light's rectangle as an occluding "card" rather than a purely additive
    // glow (see the identical stash in _updateLight for why).
    lightObj.userData.opacity = (ld.opacity ?? 100) / 100;

    const helper = this._createHelper(ld.type, lightObj as THREE.Light, ld);
    if (helper) {
      this._helpers.set(ld.id, helper);
      this._scene.add(helper);
    }
  }

  private _updateLight(ld: LightSyncEntry, shouldShow: boolean): void {
    const entry = this._entries.get(ld.id);
    if (!entry) return;

    const { object: lightObj } = entry;

    // Compute position from spherical
    const s = ld.transform.spherical;
    const latRad = (s.lat * Math.PI) / 180;
    const lngRad = (s.lng * Math.PI) / 180;
    // cartesianToSpherical() stores `radius` as the HORIZONTAL distance
    // (sqrt(x^2+z^2)) and `height` as y. Multiplying by cos(lat) here applies
    // the elevation a second time, so every round-trip through the store pulls
    // the light in toward the origin - which is why LightPaint never landed
    // where you clicked.
    void latRad;
    const px = s.radius * Math.cos(lngRad);
    const py = s.height;
    const pz = s.radius * Math.sin(lngRad);

    lightObj.userData.edgeSoftness = ld.edgeSoftness ?? 50;
    lightObj.userData.dropShadow = ld.dropShadow;
    lightObj.userData.opacity = (ld.opacity ?? 100) / 100;
    lightObj.position.set(px, py, pz);
    lightObj.visible = shouldShow;

    // Aiming.
    //
    // A LightPaint target always wins: lookAt() sets the quaternion directly and
    // is immune to the local-vs-world confusion that Euler angles suffer from.
    // Pushing a world-space Euler through lightObj.rotation.set() - which is a
    // LOCAL rotation - is what made side-panel paints drift while roof paints
    // looked fine: overhead, the discrepancy is tiny; beside the car, it is not.
    const aimTarget = (ld.transform as { aimTarget?: { x: number; y: number; z: number } }).aimTarget;

    if (aimTarget) {
      lightObj.lookAt(aimTarget.x, aimTarget.y, aimTarget.z);
    } else if (ld.transform.rotation.enabled) {
      lightObj.rotation.set(
        (ld.transform.rotation.x * Math.PI) / 180,
        (ld.transform.rotation.y * Math.PI) / 180,
        (ld.transform.rotation.z * Math.PI) / 180,
      );
    } else if (lightObj instanceof THREE.RectAreaLight) {
      // Area lights are single-sided; with no explicit aim, face the scene centre
      // so they never emit into the void.
      lightObj.lookAt(0, 0, 0);
    }

    if (lightObj instanceof THREE.Light) {
      lightObj.color.set(ld.color);
      // Map brightness 0-1000 to intensity 0-10
      lightObj.intensity = (ld.brightness / 1000) * 10;

      // Opacity is a 0-200% linear intensity multiplier. The old `< 100`
      // guard meant only the dimming half of the slider (0-100%) ever did
      // anything - 100-200% silently no-op'd, so cranking Opacity past 100%
      // (as in a genuine bug report) had zero visible effect.
      lightObj.intensity *= ld.opacity / 100;

      // Falloff
      if (lightObj instanceof THREE.PointLight || lightObj instanceof THREE.SpotLight) {
        switch (ld.falloff) {
          case 'linear':
            lightObj.decay = 1;
            break;
          case 'none':
            lightObj.decay = 0;
            break;
          case 'custom':
            lightObj.decay = 1.5;
            break;
          case 'quadratic':
          default:
            lightObj.decay = 2;
            break;
        }
      }

      // Spotlight-specific
      if (lightObj instanceof THREE.SpotLight) {
        if (ld.spotAngle !== undefined) {
          lightObj.angle = (ld.spotAngle * Math.PI) / 180;
        }
        if (ld.spotPenumbra !== undefined) {
          lightObj.penumbra = ld.spotPenumbra;
        }
        if (ld.spotDecay !== undefined) {
          lightObj.decay = ld.spotDecay;
        }
      }

      // Area light dimensions
      if (lightObj instanceof THREE.RectAreaLight) {
        if (ld.areaWidth !== undefined) lightObj.width = ld.areaWidth;
        if (ld.areaHeight !== undefined) lightObj.height = ld.areaHeight;
      }

      // Shadow config
      this._configureShadows(lightObj, ld.type);
    }

    // Aim the target: an explicit aimTarget (LightPaint) wins, otherwise derive
    // it from the rotation Euler applied above (forward = local -Z) so the
    // Rotation controls actually steer spot/directional lights instead of being
    // a no-op, and default to the origin when neither is set.
    if (entry.target) {
      if (aimTarget) {
        entry.target.position.set(aimTarget.x, aimTarget.y, aimTarget.z);
      } else if (ld.transform.rotation.enabled) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(lightObj.quaternion);
        entry.target.position.copy(lightObj.position).add(forward);
      } else {
        entry.target.position.set(0, 0, 0);
      }
    }

    // Update helper (a compact wireframe gizmo, shaped per light type)
    const helper = this._helpers.get(ld.id);
    if (helper) {
      helper.visible = shouldShow && ld.gearVisible;
      helper.position.copy(lightObj.position);
      helper.quaternion.copy(lightObj.quaternion);

      if (lightObj instanceof THREE.Light) {
        const mat = helper.userData.gizmoMaterial as THREE.LineBasicMaterial | undefined;
        mat?.color.copy(lightObj.color);

        // Rebuild the rectangle when the area dimensions change. BufferGeometry
        // is immutable, so the old geometry must be disposed and replaced.
        const isAreaType = ld.type === 'area' || ld.type === 'overhead';
        if (isAreaType) {
          const w = Math.max(0.01, ld.areaWidth ?? 2);
          const h = Math.max(0.01, ld.areaHeight ?? 2);
          const prev = helper.userData as { hw?: number; hh?: number };
          if (prev.hw !== w || prev.hh !== h) {
            const line = helper.children[0] as THREE.LineLoop;
            line.geometry.dispose();
            line.geometry = this._areaRectGeometry(w, h);
            prev.hw = w;
            prev.hh = h;
          }
        }

        // Rebuild the spot cone when its angle changes.
        if (lightObj instanceof THREE.SpotLight) {
          const line = helper.children[0] as THREE.LineSegments;
          if (line && Math.abs((line.userData.lastAngle ?? 0) - lightObj.angle) > 0.001) {
            const pts = this._spotConePoints(lightObj.angle);
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
            line.userData.lastAngle = lightObj.angle;
          }
        }
      }
    }
  }

  private _createLightByType(type: string): THREE.Object3D {
    const color = 0xffffff;
    const intensity = 1;
    switch (type) {
      case 'directional': {
        const dl = new THREE.DirectionalLight(color, intensity);
        dl.castShadow = true;
        dl.shadow.mapSize.set(2048, 2048);
        dl.shadow.camera.near = 0.5;
        dl.shadow.camera.far = 50;
        dl.shadow.camera.left = -10;
        dl.shadow.camera.right = 10;
        dl.shadow.camera.top = 10;
        dl.shadow.camera.bottom = -10;
        dl.shadow.bias = -0.001;
        return dl;
      }
      case 'spot': {
        const sl = new THREE.SpotLight(color, intensity, 50, Math.PI / 4, 0.5, 2);
        sl.castShadow = true;
        sl.shadow.mapSize.set(2048, 2048);
        sl.shadow.bias = -0.001;
        return sl;
      }
      case 'area': {
        ensureRectAreaLib();
        return new THREE.RectAreaLight(color, intensity, 2, 2);
      }
      case 'overhead': {
        ensureRectAreaLib();
        return new THREE.RectAreaLight(color, intensity, 4, 4);
      }
      case 'rim': {
        const sl = new THREE.SpotLight(color, intensity, 50, Math.PI / 6, 0.3, 2);
        sl.castShadow = true;
        sl.shadow.mapSize.set(2048, 2048);
        sl.shadow.bias = -0.001;
        return sl;
      }
      case 'underlight': {
        const pl = new THREE.PointLight(color, intensity, 50, 2);
        pl.castShadow = true;
        pl.shadow.mapSize.set(1024, 1024);
        return pl;
      }
      case 'ies':
      case 'point':
      default: {
        const pl = new THREE.PointLight(color, intensity, 50, 2);
        pl.castShadow = true;
        pl.shadow.mapSize.set(1024, 1024);
        return pl;
      }
    }
  }

  private _configureShadows(light: THREE.Object3D, _type: string): void {
    const sl = light as THREE.SpotLight;
    const dl = light as THREE.DirectionalLight;
    const pl = light as THREE.PointLight;
    const shadowCapable = light instanceof THREE.SpotLight
      || light instanceof THREE.DirectionalLight
      || light instanceof THREE.PointLight;

    if (!shadowCapable || !sl.shadow) return;

    sl.castShadow = true;
    sl.shadow.bias = -0.001;

    if (light instanceof THREE.DirectionalLight) {
      dl.shadow.mapSize.set(2048, 2048);
      dl.shadow.camera.near = 0.5;
      dl.shadow.camera.far = 50;
      dl.shadow.camera.left = -10;
      dl.shadow.camera.right = 10;
      dl.shadow.camera.top = 10;
      dl.shadow.camera.bottom = -10;
    } else if (light instanceof THREE.SpotLight) {
      sl.shadow.mapSize.set(2048, 2048);
      sl.shadow.camera.near = 0.5;
      sl.shadow.camera.far = 50;
    } else if (light instanceof THREE.PointLight) {
      pl.shadow.mapSize.set(1024, 1024);
      pl.shadow.camera.near = 0.1;
      pl.shadow.camera.far = 50;
    }
  }

  private _createHelper(type: string, light: THREE.Light, ld?: { areaWidth?: number; areaHeight?: number }): THREE.Object3D | null {
    const isArea = type === 'area' || type === 'overhead';
    const isSpot = type === 'spot' || type === 'rim';

    const mat = new THREE.LineBasicMaterial({
      color: light.color,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });

    let group: THREE.Group;
    if (isArea) {
      const w = Math.max(0.01, ld?.areaWidth ?? 2);
      const h = Math.max(0.01, ld?.areaHeight ?? 2);
      group = this._buildAreaHelper(w, h, mat);
    } else if (isSpot) {
      group = this._buildSpotHelper(light as THREE.SpotLight, mat);
    } else if (type === 'directional') {
      group = this._buildDirectionalHelper(mat);
    } else {
      group = this._buildPointHelper(mat);
    }

    group.userData.isHelper = true;
    group.userData.gizmoMaterial = mat;
    return group;
  }

  private _areaRectGeometry(w: number, h: number): THREE.BufferGeometry {
    const hw = w / 2, hh = h / 2;
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
    ]);
  }

  private _buildAreaHelper(w: number, h: number, mat: THREE.LineBasicMaterial): THREE.Group {
    const group = new THREE.Group();
    const line = new THREE.LineLoop(this._areaRectGeometry(w, h), mat);
    line.renderOrder = 999;
    group.add(line);
    group.userData.hw = w;
    group.userData.hh = h;
    return group;
  }

  private _buildPointHelper(mat: THREE.LineBasicMaterial): THREE.Group {
    const group = new THREE.Group();
    const r = 0.12;
    const segs = 32;
    for (let axis = 0; axis < 3; axis++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const c = Math.cos(a) * r, s = Math.sin(a) * r;
        pts.push(axis === 0 ? new THREE.Vector3(0, c, s) :
                  axis === 1 ? new THREE.Vector3(c, 0, s) :
                               new THREE.Vector3(c, s, 0));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.renderOrder = 999;
      group.add(line);
    }
    return group;
  }

  private _spotConePoints(halfAngle: number): THREE.Vector3[] {
    const length = 1.4;
    const r = Math.tan(halfAngle) * length;
    const pts: THREE.Vector3[] = [];
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, -length));
      pts.push(new THREE.Vector3(Math.cos(a2) * r, Math.sin(a2) * r, -length));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, 0, 0));
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -length));
    }
    return pts;
  }

  private _buildSpotHelper(light: THREE.SpotLight, mat: THREE.LineBasicMaterial): THREE.Group {
    const group = new THREE.Group();
    const halfAngle = light.angle ?? Math.PI / 8;
    const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(this._spotConePoints(halfAngle)), mat);
    line.userData.lastAngle = halfAngle;
    line.renderOrder = 999;
    group.add(line);
    return group;
  }

  private _buildDirectionalHelper(mat: THREE.LineBasicMaterial): THREE.Group {
    const group = new THREE.Group();
    const r = 0.3, segs = 24;
    const circlePts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      circlePts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    const circle = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts), mat);
    circle.renderOrder = 999;
    group.add(circle);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rayPts = [
        new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0),
        new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -1.0),
      ];
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rayPts), mat);
      ray.renderOrder = 999;
      group.add(ray);
    }
    return group;
  }

  private _removeLight(id: string): void {
    const entry = this._entries.get(id);
    if (!entry) return;

    const { object, target } = entry;

    // Dispose shadow maps
    const shadowLight = object as THREE.SpotLight | THREE.DirectionalLight | THREE.PointLight;
    if (object instanceof THREE.Light && shadowLight.shadow && shadowLight.shadow.map) {
      shadowLight.shadow.map.dispose();
    }

    this._scene.remove(object);
    this._disposeObject(object);
    if (target) {
      this._scene.remove(target);
    }

    this._entries.delete(id);
    this._types.delete(id);

    const helper = this._helpers.get(id);
    if (helper) {
      this._scene.remove(helper);
      this._disposeObject(helper);
      this._helpers.delete(id);
    }
  }

  private _disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      // Line/LineSegments/LineLoop (used by the wireframe light gizmos) also
      // carry their own geometry/material, same shape as Mesh.
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        } else if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        }
      }
    });
  }

  getLightObject(id: string): THREE.Object3D | undefined {
    return this._entries.get(id)?.object;
  }

  getLightCount(): number {
    return this._entries.size;
  }

  dispose(): void {
    const ids = Array.from(this._entries.keys());
    for (const id of ids) {
      this._removeLight(id);
    }
  }
}

export class ModelLoader {
  private _scene: THREE.Scene;
  private _currentModel: THREE.Group | null = null;
  private _loader = new GLTFLoader();
  private _objLoader = new OBJLoader();
  private _loading = false;
  private _progress = 0;
  private _onProgress: ((progress: number) => void) | null = null;
  private _onLoaded: ((name: string) => void) | null = null;
  private _onError: ((error: string) => void) | null = null;
  private _contactShadow: THREE.Mesh | null = null;
  private static _contactShadowTexture: THREE.Texture | null = null;

  constructor(scene: THREE.Scene) {
    this._scene = scene;
  }

  /**
   * Soft blurred ellipse fading to transparent - a Sketchfab-style "contact
   * shadow" decal that reads as grounding regardless of the current light
   * rig, unlike real shadow-map shadows which vanish with no shadow-casting
   * light selected. Cached on the class since every model reuses the same
   * gradient, just rescaled per footprint.
   */
  private static getContactShadowTexture(): THREE.Texture {
    if (ModelLoader._contactShadowTexture) return ModelLoader._contactShadowTexture;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0.0, 'rgba(0, 0, 0, 0.55)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.38)');
    gradient.addColorStop(0.75, 'rgba(0, 0, 0, 0.14)');
    gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    ModelLoader._contactShadowTexture = tex;
    return tex;
  }

  /** (Re)creates the contact-shadow decal sized to the model's footprint,
   *  sitting exactly on the grid plane (y=0) so it never floats or clips. */
  private _updateContactShadow(box: THREE.Box3): void {
    this._disposeContactShadow();

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    if (footprint <= 0) return;

    // Wider than the model's own footprint so the falloff reads as a soft
    // pool of shadow rather than a hard silhouette.
    const diameter = footprint * 1.7;
    const geo = new THREE.PlaneGeometry(diameter, diameter);
    const mat = new THREE.MeshBasicMaterial({
      map: ModelLoader.getContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // Just above the floor/grid plane (y=0) to avoid z-fighting, aligned to
    // the model's actual footprint center rather than the world origin.
    mesh.position.set(center.x, 0.008, center.z);
    mesh.renderOrder = 1;
    mesh.userData.isProxy = true; // hide from SceneHierarchy
    mesh.name = '__contactShadow__';
    this._contactShadow = mesh;
    this._scene.add(mesh);
  }

  private _disposeContactShadow(): void {
    if (this._contactShadow) {
      this._scene.remove(this._contactShadow);
      this._contactShadow.geometry.dispose();
      (this._contactShadow.material as THREE.Material).dispose();
      this._contactShadow = null;
    }
  }

  get loading(): boolean { return this._loading; }
  get progress(): number { return this._progress; }

  getCurrentModel(): THREE.Group | null {
    return this._currentModel;
  }

  setCallbacks(callbacks: {
    onProgress?: (progress: number) => void;
    onLoaded?: (name: string) => void;
    onError?: (error: string) => void;
  }): void {
    this._onProgress = callbacks.onProgress ?? null;
    this._onLoaded = callbacks.onLoaded ?? null;
    this._onError = callbacks.onError ?? null;
  }

  async loadFromFile(file: File): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._progress = 0;
    this._onProgress?.(0);

    // Read file as ArrayBuffer to store raw data for scene persistence
    let arrayBuffer: ArrayBuffer | null = null;
    try {
      arrayBuffer = await file.arrayBuffer();
      setRawModelData(arrayBuffer, file.name);
    } catch (e) {
      // The model still renders, but it can't be embedded in a scene file -
      // silently swallowing this made "my model didn't come back after
      // loading a save" impossible to diagnose.
      console.warn(
        `[LightForge] Could not buffer "${file.name}" for scene persistence - ` +
        `the model will render but will NOT be included in saved scene files:`,
        e,
      );
    }

    const url = URL.createObjectURL(file);

    try {
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        this._loader.load(
          url,
          (result) => resolve(result),
          (event) => {
            if (event.lengthComputable) {
              this._progress = (event.loaded / event.total) * 100;
              this._onProgress?.(this._progress);
            }
          },
          (error) => reject(error)
        );
      });

      this.removeCurrentModel();

      this._currentModel = gltf.scene;
      this._scene.add(gltf.scene);

      // Enable shadows
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Center and scale
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 4 / maxDim;
        gltf.scene.scale.multiplyScalar(scale);
      }
      // Recompute after scaling
      const box2 = new THREE.Box3().setFromObject(gltf.scene);
      const center2 = box2.getCenter(new THREE.Vector3());
      gltf.scene.position.sub(center2);
      gltf.scene.position.y += box2.getSize(new THREE.Vector3()).y / 2;

      // Contact shadow sized/placed from the model's FINAL bounding box, so
      // it lands on the grid plane under the model's actual footprint.
      this._updateContactShadow(new THREE.Box3().setFromObject(gltf.scene));

      this._loading = false;
      this._progress = 100;
      this._onProgress?.(100);
      this._onLoaded?.(file.name.replace(/\.(glb|gltf)$/i, ''));
    } catch (err) {
      this._loading = false;
      this._progress = 0;
      const msg = err instanceof Error ? err.message : 'Failed to load model';
      this._onError?.(msg);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Load a model from an ArrayBuffer (e.g., restored from a scene file).
   */
  async loadFromBuffer(
    arrayBuffer: ArrayBuffer,
    fileName: string,
    options?: { skipCenterAndScale?: boolean }
  ): Promise<void> {
    const skipCenterAndScale = options?.skipCenterAndScale ?? false;
    if (this._loading) return;
    this._loading = true;
    this._progress = 0;
    this._onProgress?.(0);

    setRawModelData(arrayBuffer, fileName);

    const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    try {
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        this._loader.load(
          url,
          (result) => resolve(result),
          (event) => {
            if (event.lengthComputable) {
              this._progress = (event.loaded / event.total) * 100;
              this._onProgress?.(this._progress);
            }
          },
          (error) => reject(error)
        );
      });

      this.removeCurrentModel();

      this._currentModel = gltf.scene;
      this._scene.add(gltf.scene);

      // Enable shadows
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Center and scale (skipped when the caller wants the model's original
      // transform preserved, e.g. positions pushed live from Blender)
      if (!skipCenterAndScale) {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const scale = 4 / maxDim;
          gltf.scene.scale.multiplyScalar(scale);
        }
        const box2 = new THREE.Box3().setFromObject(gltf.scene);
        const center2 = box2.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(center2);
        gltf.scene.position.y += box2.getSize(new THREE.Vector3()).y / 2;
      }

      this._loading = false;
      this._progress = 100;
      this._onProgress?.(100);
      this._onLoaded?.(fileName.replace(/\.(glb|gltf)$/i, ''));
    } catch (err) {
      this._loading = false;
      this._progress = 0;
      const msg = err instanceof Error ? err.message : 'Failed to load model from buffer';
      this._onError?.(msg);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Load a model from raw OBJ text (e.g. pushed from Maya, which has no
   * native glTF export). OBJLoader carries no materials of its own - meshes
   * come in with three.js's default material, ready for the app's own
   * Material Editor to take over, same as any other freshly-loaded model.
   */
  async loadObjFromText(
    text: string,
    fileName: string,
    options?: { skipCenterAndScale?: boolean }
  ): Promise<void> {
    if (this._loading) return;
    const skipCenterAndScale = options?.skipCenterAndScale ?? false;
    this._loading = true;
    this._progress = 0;
    this._onProgress?.(0);

    try {
      const obj = this._objLoader.parse(text);

      this.removeCurrentModel();

      this._currentModel = obj;
      this._scene.add(obj);

      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      if (!skipCenterAndScale) {
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          obj.scale.multiplyScalar(4 / maxDim);
        }
        const box2 = new THREE.Box3().setFromObject(obj);
        const center2 = box2.getCenter(new THREE.Vector3());
        obj.position.sub(center2);
        obj.position.y += box2.getSize(new THREE.Vector3()).y / 2;
      }

      this._updateContactShadow(new THREE.Box3().setFromObject(obj));

      this._loading = false;
      this._progress = 100;
      this._onProgress?.(100);
      this._onLoaded?.(fileName.replace(/\.obj$/i, ''));
    } catch (err) {
      this._loading = false;
      this._progress = 0;
      const msg = err instanceof Error ? err.message : 'Failed to load OBJ model';
      this._onError?.(msg);
    }
  }

  removeCurrentModel(): void {
    this._disposeContactShadow();
    if (this._currentModel) {
      this._scene.remove(this._currentModel);
      this._currentModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this._currentModel = null;
      clearRawModelData();
    }
  }

  dispose(): void {
    this.removeCurrentModel();
  }
}

/**
 * Build the limbo backdrop as a 2D canvas texture.
 *
 * Two layers: a vertical dark-to-lighter fade (floor is brighter than sky, as in
 * a real cyc wall), plus a soft radial hotspot centred behind the subject. A flat
 * colour gives a dark car nothing to separate against.
 */
export interface GradientStop {
  color: string;
  position: number;
  opacity: number;
}

export interface GradientBackgroundConfig {
  type: 'linear' | 'radial' | 'conic';
  angle: number;
  stops: GradientStop[];
}

export function createGradientBackground(config: GradientBackgroundConfig): THREE.Texture {
  // Painted onto a 2:1 canvas via the exact same paintGradientOntoContext()
  // the HDRI Preview panel and HDRI export use (gradientToEnvLayer in
  // HDRIExporter.ts), then wrapped with EquirectangularReflectionMapping so
  // the viewport shows a true spherical sky dome - the same curved "hills"
  // shape the flat gradient produces once sampled equirectangularly.
  //
  // The previous version painted onto a plain SQUARE canvas with no mapping
  // set, which THREE.js renders as a flat, screen-aligned backdrop image
  // (no spherical wrap, doesn't turn with the camera) - visually nothing
  // like what HDRI Preview/export actually produce from the same gradient
  // config, which is why toggling it on/off never looked like the same
  // environment in both places.
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  paintGradientOntoContext(ctx, w, h, config);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Wide, dim additive glow laid flat on the floor at the origin - simulates
 * an overhead spotlight pool so the grid reads as lit rather than flat,
 * matching the reference studio look. Independent of the actual light rig.
 */
function createFloorSpotlightPool(): THREE.Mesh {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0.0, 'rgba(120, 150, 200, 0.35)');
  gradient.addColorStop(0.35, 'rgba(90, 115, 165, 0.18)');
  gradient.addColorStop(0.7, 'rgba(60, 80, 120, 0.06)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(16, 16);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  mesh.renderOrder = 0;
  mesh.userData.isProxy = true; // hide from SceneHierarchy
  mesh.name = '__floorSpotlightPool__';
  return mesh;
}

export function createLimboBackground(): THREE.Texture {
  const w = 1024;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (!ctx) return new THREE.Texture();

  // Vertical fade - deep navy studio cyc: near-black at the top, lifting to
  // a dim blue-grey horizon so the subject reads against a graded backdrop.
  const vertical = ctx.createLinearGradient(0, 0, 0, h);
  vertical.addColorStop(0.0, '#03050a');
  vertical.addColorStop(0.5, '#0a0f1c');
  vertical.addColorStop(1.0, '#1a2338');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, w, h);

  // Soft blue hotspot behind the subject — cool studio pop instead of a
  // neutral-grey one.
  const radial = ctx.createRadialGradient(w / 2, h * 0.58, 0, w / 2, h * 0.58, w * 0.55);
  radial.addColorStop(0.0, 'rgba(70, 100, 150, 0.38)');
  radial.addColorStop(0.5, 'rgba(40, 58, 90, 0.18)');
  radial.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, w, h);

  // Vignette - darken the corners so the frame reads as a contained studio
  // volume rather than an infinite flat wash, matching the reference look.
  const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.75);
  vignette.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1.0, 'rgba(0, 1, 4, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}