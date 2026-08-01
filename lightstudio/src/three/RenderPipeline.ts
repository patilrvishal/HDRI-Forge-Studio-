import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export interface BloomSettings {
  enabled: boolean;
  intensity: number;
  threshold: number;
  radius: number;
}

export interface PipelineSettings {
  bloom: BloomSettings;
  antialiasing: string;
  shadowQuality: string;
}

export class RenderPipeline {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private smaaPass: SMAAPass | null = null;

  private currentSettings: PipelineSettings = {
    bloom: { enabled: false, intensity: 0.3, threshold: 0.8, radius: 0.5 },
    antialiasing: 'smaa',
    shadowQuality: 'high',
  };

  private disposed = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
  }

  init(settings?: Partial<PipelineSettings>): void {
    if (settings) {
      this.currentSettings = { ...this.currentSettings, ...settings };
    }

    this.rebuildComposer();
  }

  private rebuildComposer(): void {
    // Dispose existing composer
    if (this.composer) {
      this.disposeComposer();
    }

    const size = this.renderer.getSize(new THREE.Vector2());
    const width = size.x || 1;
    const height = size.y || 1;

    // Create composer
    this.composer = new EffectComposer(this.renderer);

    // Render pass (always present)
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Bloom pass (optional, at half resolution for performance)
    if (this.currentSettings.bloom.enabled) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width / 2, height / 2),
        this.currentSettings.bloom.intensity,
        this.currentSettings.bloom.radius,
        this.currentSettings.bloom.threshold,
      );
      this.composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }

    // SMAA pass (optional)
    if (this.currentSettings.antialiasing === 'smaa') {
      // @ts-expect-error — SMAAPass types incomplete
      this.smaaPass = new SMAAPass(width, height);
      this.composer.addPass(this.smaaPass);
    } else {
      this.smaaPass = null;
    }
  }

  updateSettings(settings: PipelineSettings): void {
    const bloomChanged =
      settings.bloom.enabled !== this.currentSettings.bloom.enabled ||
      settings.antialiasing !== this.currentSettings.antialiasing;

    this.currentSettings = { ...settings };

    if (bloomChanged) {
      // Need to rebuild the composer when bloom or antialiasing toggles
      this.rebuildComposer();
    } else {
      // Just update bloom parameters in place
      if (this.bloomPass && settings.bloom.enabled) {
        this.bloomPass.strength = settings.bloom.intensity;
        this.bloomPass.radius = settings.bloom.radius;
        this.bloomPass.threshold = settings.bloom.threshold;
      }

      // Handle shadow quality changes
      this.applyShadowQuality(settings.shadowQuality);
    }
  }

  updateBloom(bloom: BloomSettings): void {
    this.updateSettings({ ...this.currentSettings, bloom });
  }

  private applyShadowQuality(quality: string): void {
    switch (quality) {
      case 'none':
        this.renderer.shadowMap.enabled = false;
        break;
      case 'low':
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        break;
      case 'medium':
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        break;
      case 'high':
      default:
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        break;
    }

    // Update shadow map size based on quality
    this.scene.traverse((child) => {
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
        // Force shadow map regeneration
        if (shadow.map) {
          shadow.map.dispose();
          shadow.map = null;
        }
      }
    });
  }

  resize(width: number, height: number): void {
    if (this.disposed || !this.composer) return;
    if (width === 0 || height === 0) return;

    this.composer.setSize(width, height);

    // Update bloom resolution
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width / 2, height / 2);
    }

    // Update SMAA resolution
    if (this.smaaPass) {
      this.smaaPass.setSize(width, height);
    }
  }

  render(): void {
    if (this.disposed || !this.composer) {
      // Fallback to direct render
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }

  getComposer(): EffectComposer | null {
    return this.composer;
  }

  private disposeComposer(): void {
    if (this.composer) {
      // Dispose passes in reverse order
      const passes = this.composer.passes.slice().reverse();
      for (const pass of passes) {
        if ('dispose' in pass && typeof (pass as { dispose: () => void }).dispose === 'function') {
          (pass as { dispose: () => void }).dispose();
        }
      }
      this.composer.dispose();
    }
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.smaaPass = null;
  }

  dispose(): void {
    this.disposed = true;
    this.disposeComposer();
  }
}