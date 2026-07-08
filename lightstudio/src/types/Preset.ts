import type { Light } from './Light';
import { createDefaultLight } from './Light';

export interface PresetLight {
  name: string;
  type: Light['type'];
  color: string;
  brightness: number;
  opacity: number;
  colorProfile: Light['colorProfile'];
  areaLight: boolean;
  falloff: Light['falloff'];
  transform: Light['transform'];
}

export interface Preset {
  id: string;
  name: string;
  category: 'sidelights' | 'studio' | 'outdoor' | 'custom';
  thumbnail: string; // base64 data URL
  lights: PresetLight[];
  createdAt: number;
  isDefault: boolean;
}

export function presetToLights(preset: Preset): Light[] {
  return preset.lights.map((pl) =>
    createDefaultLight({
      name: pl.name,
      type: pl.type,
      color: pl.color,
      brightness: pl.brightness,
      opacity: pl.opacity,
      colorProfile: pl.colorProfile,
      areaLight: pl.areaLight,
      falloff: pl.falloff,
      transform: { ...pl.transform },
    })
  );
}

export const MATERIAL_PRESETS: Record<
  string,
  { label: string; color: number; metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number }
> = {
  badge: { label: 'Badge', color: 0xcccccc, metalness: 0.9, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 },
  cement: { label: 'Cement', color: 0x888888, metalness: 0, roughness: 0.92, clearcoat: 0, clearcoatRoughness: 0 },
  glass: { label: 'Glass', color: 0xddeeff, metalness: 0.1, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0 },
  metal: { label: 'Metal', color: 0xdddddd, metalness: 1, roughness: 0.15, clearcoat: 0, clearcoatRoughness: 0 },
  fabric: { label: 'Fabric', color: 0x8b4513, metalness: 0, roughness: 0.95, clearcoat: 0, clearcoatRoughness: 0 },
};

export type MaterialPresetKey = keyof typeof MATERIAL_PRESETS;

export const PREVIEW_BG_OPTIONS = [
  { value: 'black', label: 'Black' },
  { value: 'grey', label: 'Grey' },
  { value: 'white', label: 'White' },
  { value: 'custom', label: 'Custom' },
] as const;

export type PreviewBackground = (typeof PREVIEW_BG_OPTIONS)[number]['value'];