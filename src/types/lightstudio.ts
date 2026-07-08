export type LightType = 'ambient' | 'directional' | 'point' | 'spot';

export interface LightConfig {
  id: string;
  name: string;
  type: LightType;
  color: string;
  intensity: number;
  position: [number, number, number];
  visible: boolean;
  castShadow: boolean;
  decay?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  target: [number, number, number];
}

export interface MaterialConfig {
  id: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
}

export interface AnimationConfig {
  enabled: boolean;
  type: 'rotate' | 'orbit' | 'breathe';
  speed: number;
  axis: 'x' | 'y' | 'z';
}

export type EnvironmentPreset = 'none' | 'studio' | 'sunset' | 'night' | 'dawn';

export interface EnvironmentConfig {
  preset: EnvironmentPreset;
  environmentIntensity: number;
  showGround: boolean;
  groundReflectivity: number;
}

export interface CameraConfig {
  fov: number;
  position: [number, number, number];
  near: number;
  far: number;
  target: [number, number, number];
}

export type ToneMappingType = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces-filmic' | 'agx' | 'neutral';
export type OutputColorSpaceType = 'srgb' | 'srgb-linear' | 'linear-srgb';

export interface PostProcessingConfig {
  enabled: boolean;
  ssao: {
    enabled: boolean;
    intensity: number;
    radius: number;
  };
  bloom: {
    enabled: boolean;
    intensity: number;
    threshold: number;
    luminanceSmoothing: number;
    radius: number;
  };
  colorGrading: {
    enabled: boolean;
    brightness: number;
    contrast: number;
    hue: number;
    saturation: number;
  };
  vignette: {
    enabled: boolean;
    offset: number;
    darkness: number;
  };
}

export interface RenderSettings {
  antialias: boolean;
  toneMapping: ToneMappingType;
  toneMappingExposure: number;
  outputColorSpace: OutputColorSpaceType;
  postProcessing: PostProcessingConfig;
}