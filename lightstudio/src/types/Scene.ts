export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface EnvironmentState {
  hdri: string | null;
  /** Phase 9: HDRI preset ID (from HDRI_PRESETS) */
  presetId: string;
  /** Phase 9: Environment map rotation in degrees (0-360) */
  rotation: number;
  background: string;
  intensity: number;
  showBackground: boolean;
  gradientBackground: {
    enabled: boolean;
    type: 'linear' | 'radial' | 'conic';
    angle: number;
    stops: { color: string; position: number; opacity: number }[];
  };
  /** Backplate image (data URL). Shown as viewport background instead of HDRI */
  backplate: string | null;
  /** Backplate opacity (0-1) */
  backplateOpacity: number;
}

export interface BloomSettings {
  enabled: boolean;
  intensity: number;
  threshold: number;
  radius: number;
}

export interface AOSettings {
  enabled: boolean;
  radius: number;
  intensity: number;
}

export interface GroundSettings {
  /** Show the ground plane */
  visible: boolean;
  /** Enable real-time floor reflections (CubeCamera + PBR) */
  reflections: boolean;
  /** Reflection intensity 0-1 (controls envMapIntensity of reflections) */
  reflectionSharpness: number;
  /** Ground color (hex) */
  color: string;
  /** Ground roughness 0-1 */
  roughness: number;
  /** Ground metalness 0-1 */
  metalness: number;
  /** Fade ground edges into background (distance from center where fade starts, 0 = off) */
  fadeRadius: number;
  /** Plane size in world units */
  size: number;
  /** World-space offset */
  position: { x: number; y: number; z: number };
  /** Rotation in DEGREES (x is pre-offset by the -90 that makes the plane horizontal) */
  rotation: { x: number; y: number; z: number };
  /**
   * Bake this plane into the exported HDRI.
   * OFF = viewport-only (a working surface you can see but that does not
   * pollute the lighting data). ON = the plane is ray-traced into the HDRI.
   */
  includeInHDRI: boolean;
}

export interface RenderSettings {
  engine: 'pbr' | 'pathtracer';
  tonemapping: 'aces' | 'reinhard' | 'linear';
  exposure: number; // 0.1 - 5.0
  quality: 'low' | 'medium' | 'high' | 'ultra';
  antialiasing: 'none' | 'fxaa' | 'smaa' | 'taa';
  shadowQuality: 'none' | 'low' | 'medium' | 'high';
  bloom: BloomSettings;
  ao: AOSettings;
  ground: GroundSettings;
  vignette: VignetteSettings;
  colorGrading: ColorGradingSettings;
  exportFormat: 'png' | 'jpeg' | 'exr' | 'webp';
  renderResolution: '1k' | '2k' | '4k' | 'custom';
  customWidth: number;
  customHeight: number;
  autoSave: boolean;
  autoSaveInterval: number; // minutes
}

export interface VignetteSettings {
  enabled: boolean;
  intensity: number; // 0 - 1
}

export interface ColorGradingSettings {
  enabled: boolean;
  brightness: number; // -1 - 1
  contrast: number;   // -1 - 1
  saturation: number; // -1 - 1
}

export interface SceneState {
  version: string;
  modelPath: string | null;
  modelName: string;
  camera: CameraState;
  environment: EnvironmentState;
  renderSettings: RenderSettings;
  showGrid: boolean;
  turntable: {
    active: boolean;
    speed: number;
  };
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  engine: 'pbr',
  tonemapping: 'aces',
  exposure: 1.0,
  quality: 'high',
  antialiasing: 'smaa',
  shadowQuality: 'high',
  bloom: { enabled: true, intensity: 0.55, threshold: 0.7, radius: 0.6 },
  ao: { enabled: true, radius: 0.8, intensity: 0.6 },
  ground: {
    // Off by default - a floor should be an explicit choice, not a surprise
    // that shows up in every fresh scene (and in every HDRI export).
    visible: false,
    reflections: true,
    reflectionSharpness: 0.85,
    color: '#111118',
    roughness: 0.15,
    metalness: 0.95,
    fadeRadius: 8.0,
    size: 40,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    includeInHDRI: false,
  },
  vignette: { enabled: false, intensity: 0.4 },
  colorGrading: { enabled: false, brightness: 0, contrast: 0, saturation: 0 },
  exportFormat: 'png',
  renderResolution: '2k',
  customWidth: 1920,
  customHeight: 1080,
  autoSave: false,
  autoSaveInterval: 5,
};

export const DEFAULT_SCENE_STATE: SceneState = {
  version: '1.0',
  modelPath: null,
  modelName: 'No Model Loaded',
  camera: {
    position: [5, 3, 5],
    target: [0, 0, 0],
    fov: 45,
  },
  environment: {
    hdri: null,
    presetId: 'none ',
    rotation: 0,
    background: '#1a1a2e',
    intensity: 1.0,
    showBackground: false,
    gradientBackground: {
      enabled: true,
      type: 'radial',
      angle: 90,
      stops: [
        { color: '#1a2338', position: 0, opacity: 1 },
        { color: '#05070d', position: 1, opacity: 1 },
      ],
    },
    backplate: null,
    backplateOpacity: 1.0,
  },
  renderSettings: DEFAULT_RENDER_SETTINGS,
  showGrid: true,
  turntable: { active: false, speed: 1.0 },
};

export interface CameraBookmark {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export function createDefaultCameraBookmark(index: number): CameraBookmark {
  return {
    id: `bookmark_${Date.now()}_${index}`,
    name: `Camera ${index + 1}`,
    position: [5, 3, 5],
    target: [0, 0, 0],
    fov: 45,
  };
}