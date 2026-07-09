// Light types for the studio
export type LightType = 
  | 'point' 
  | 'spot' 
  | 'area' 
  | 'directional'
  | 'ies'
  | 'overhead'
  | 'underlight'
  | 'rim';

export type ColorProfile = 'daylight' | 'tungsten' | 'custom' | 'fluorescent';

export type FalloffType = 'quadratic' | 'linear' | 'none' | 'custom';

export type RotationMode = 'euler' | 'quaternion';

export type ContentType = 'badge' | 'cement' | 'glass' | 'metal' | 'fabric';

export type ViewMode = 'perspective' | 'front' | 'right' | 'top';

export type RenderEngine = 'pbr' | 'pathtracer';

export interface SphericalPosition {
  lat: number;    // -90 to 90
  lng: number;    // 0 to 360
  radius: number; // distance from origin
  height: number; // Y offset
}

export interface LightRotation {
  x: number;
  y: number;
  z: number;
  mode: RotationMode;
  enabled: boolean;
  repeat: boolean;
  advanced: {
    lR: number;
    p1: number;
    p2: number;
    p3: number;
    rR: number;
    ro: number;
    roat: number;
  };
}

export interface LightTransform {
  spherical: SphericalPosition;
  position: { x: number; y: number; z: number };
  rotation: LightRotation;
}

export interface Light {
  id: string;
  name: string;
  type: LightType;
  visible: boolean;
  solo: boolean;
  color: string;        // hex color
  brightness: number;   // 0-1000
  opacity: number;      // 0-200 (percentage)
  colorProfile: ColorProfile;
  areaLight: boolean;
  falloff: FalloffType;
  gearVisible: boolean;
  transform: LightTransform;
  collectionId: string | null;
  // Spotlight parameters
  spotAngle: number;     // degrees (1-90)
  spotPenumbra: number;  // 0-1 (0=hard edge, 1=full soft)
  // Area light dimensions
  areaWidth: number;     // meters
  areaHeight: number;    // meters
}

export function createDefaultLight(overrides: Partial<Light> = {}): Light {
  const id = `light_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  return {
    id,
    name: 'New Light',
    type: 'point',
    visible: true,
    solo: false,
    color: '#ffffff',
    brightness: 100,
    opacity: 100,
    colorProfile: 'daylight',
    areaLight: false,
    falloff: 'quadratic',
    gearVisible: true,
    transform: {
      spherical: { lat: 45, lng: 45, radius: 5, height: 3 },
      position: { x: 3.5, y: 3, z: 3.5 },
      rotation: {
        x: 0, y: 0, z: 0,
        mode: 'euler',
        enabled: false,
        repeat: false,
        advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 },
      },

    },
    collectionId: null,
    spotAngle: 45,
    spotPenumbra: 0.5,
    areaWidth: 2,
    areaHeight: 2,
    ...overrides,
  };
}

// Preset light types with sensible defaults
export const LIGHT_TEMPLATES: Record<string, Partial<Light>> = {
  point: { type: 'point', name: 'Round Light', color: '#ffffff', brightness: 150, falloff: 'quadratic' },
  ies: { type: 'ies', name: 'IES Point Light', color: '#ffe4b5', brightness: 200, falloff: 'custom' },
  spot: { type: 'spot', name: 'Spot Light', color: '#ffffff', brightness: 300, falloff: 'quadratic', spotAngle: 45, spotPenumbra: 0.5 },
  area: { type: 'area', name: 'Area Light', color: '#e8e8ff', brightness: 250, areaLight: true, falloff: 'linear', areaWidth: 2, areaHeight: 2 },
  overhead: { type: 'overhead', name: 'Overhead Box Light', color: '#ffffff', brightness: 200, areaLight: true, spotAngle: 45, spotPenumbra: 0.5, areaWidth: 4, areaHeight: 4, transform: { spherical: { lat: 90, lng: 0, radius: 4, height: 5 }, position: { x: 0, y: 5, z: 0 }, rotation: { x: -90, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } } } },
  underlight: { type: 'underlight', name: 'Under Grid Light', color: '#4a9eff', brightness: 80, transform: { spherical: { lat: -90, lng: 0, radius: 3, height: -0.5 }, position: { x: 0, y: -0.5, z: 0 }, rotation: { x: 90, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } } } },
  rim: { type: 'rim', name: 'Rim Light', color: '#4a9eff', brightness: 180, spotAngle: 30, spotPenumbra: 0.3, transform: { spherical: { lat: 10, lng: 180, radius: 6, height: 2 }, position: { x: -6, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0, mode: 'euler', enabled: false, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } } } },
  fill: { type: 'area', name: 'Fill Light', color: '#c8d8ff', brightness: 100, areaLight: true, falloff: 'linear', areaWidth: 3, areaHeight: 2, transform: { spherical: { lat: 30, lng: -90, radius: 5, height: 2 }, position: { x: -5, y: 2, z: 0 }, rotation: { x: 0, y: 90, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } } } },
};