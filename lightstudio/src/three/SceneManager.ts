import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraAnimState {
  active: boolean;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  progress: number;
  duration: number;
}

export class SceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  domElement: HTMLCanvasElement;
  ground: THREE.Mesh;
  grid: THREE.GridHelper;
  pmremGenerator: THREE.PMREMGenerator;
  ambientLight: THREE.AmbientLight;

  private container: HTMLElement;
  private animationFrameId: number | null = null;
  private renderCallback: ((delta: number, elapsed: number) => void) | null = null;
  private clock = new THREE.Clock();
  private disposed = false;

  turntableActive = false;
  turntableSpeed = 1.0;
  private turntableTarget: THREE.Object3D | null = null;

  private cameraAnim: CameraAnimState = {
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    progress: 0,
    duration: 1,
  };

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1a1a2e');

    // Camera
    const aspect = container.clientWidth / container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(5, 3, 5);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.domElement = this.renderer.domElement;

    // PMREM Generator
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.target.set(0, 0, 0);

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(this.ambientLight);

    // Grid helper (20x20, 40 divisions)
    this.grid = new THREE.GridHelper(20, 40, 0x444466, 0x333355);
    this.grid.position.y = 0.001; // Slight offset to prevent z-fighting
    this.scene.add(this.grid);

    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(40, 40);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a3e,
      metalness: 0.3,
      roughness: 0.7,
    });
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Append canvas to container
    container.appendChild(this.domElement);
  }

  init(callback?: (delta: number, elapsed: number) => void): void {
    if (callback) {
      this.renderCallback = callback;
    }
    this.animate();
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const w = width || this.container.clientWidth;
    const h = height || this.container.clientHeight;
    if (w === 0 || h === 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate(): void {
    if (this.disposed) return;

    this.animationFrameId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Update camera animation
    if (this.cameraAnim.active) {
      this.updateCameraAnimation(delta);
    }

    // Update turntable
    if (this.turntableActive && this.turntableTarget) {
      this.turntableTarget.rotation.y += delta * this.turntableSpeed * 0.5;
    }

    // Update controls
    this.controls.update();

    // Fire render callback
    if (this.renderCallback) {
      this.renderCallback(delta, elapsed);
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  private updateCameraAnimation(delta: number): void {
    const anim = this.cameraAnim;
    anim.progress += delta / anim.duration;

    if (anim.progress >= 1) {
      anim.progress = 1;
      anim.active = false;
    }

    // Ease-in-out cubic
    const t = anim.progress < 0.5
      ? 4 * anim.progress * anim.progress * anim.progress
      : 1 - Math.pow(-2 * anim.progress + 2, 3) / 2;

    this.camera.position.lerpVectors(anim.startPos, anim.endPos, t);
    this.controls.target.lerpVectors(anim.startTarget, anim.endTarget, t);
  }

  animCam(
    pos: THREE.Vector3,
    target: THREE.Vector3,
    duration: number = 1.0,
  ): void {
    this.cameraAnim.startPos.copy(this.camera.position);
    this.cameraAnim.endPos.copy(pos);
    this.cameraAnim.startTarget.copy(this.controls.target);
    this.cameraAnim.endTarget.copy(target);
    this.cameraAnim.duration = duration;
    this.cameraAnim.progress = 0;
    this.cameraAnim.active = true;
  }

  setTurntableTarget(target: THREE.Object3D | null): void {
    this.turntableTarget = target;
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  setEnvMap(texture: THREE.Texture | null): void {
    if (texture) {
      this.scene.environment = texture;
    }
  }

  setBackground(color: string | THREE.Color): void {
    if (typeof color === 'string') {
      this.scene.background = new THREE.Color(color);
    } else {
      this.scene.background = color;
    }
  }

  setToneMappingExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  getScreenSize(): { width: number; height: number } {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
  }

  dispose(): void {
    this.disposed = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Dispose controls
    this.controls.dispose();

    // Dispose ground
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.scene.remove(this.ground);

    // Dispose grid
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.scene.remove(this.grid);

    // Dispose ambient light
    this.scene.remove(this.ambientLight);

    // Dispose PMREM generator
    this.pmremGenerator.dispose();

    // Dispose renderer
    this.renderer.dispose();

    // Remove canvas from DOM
    if (this.domElement.parentNode) {
      this.domElement.parentNode.removeChild(this.domElement);
    }

    // Clear scene
    this.scene.clear();
  }
}