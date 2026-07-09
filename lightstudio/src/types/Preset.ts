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
  category: 'sidelights' | 'studio' | 'outdoor' | 'spotlight' | 'custom';
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

/** Generate a canvas-based gradient thumbnail from preset light colors */
export function generatePresetThumbnail(lights: PresetLight[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Dark base
  ctx.fillStyle = '#0c0c18';
  ctx.fillRect(0, 0, 120, 90);

  // Subtle grid
  ctx.strokeStyle = 'rgba(167,139,250,0.06)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < 120; x += 15) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 90); ctx.stroke();
  }
  for (let y = 0; y < 90; y += 15) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(120, y); ctx.stroke();
  }

  // Car silhouette (simple side profile)
  ctx.save();
  ctx.translate(60, 55);
  ctx.beginPath();
  ctx.moveTo(-28, 0);
  ctx.lineTo(-30, -5);
  ctx.lineTo(-26, -12);
  ctx.lineTo(-18, -18);
  ctx.lineTo(-8, -22);
  ctx.lineTo(2, -24);
  ctx.lineTo(14, -22);
  ctx.lineTo(22, -16);
  ctx.lineTo(28, -8);
  ctx.lineTo(30, -3);
  ctx.lineTo(28, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(20,20,40,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(167,139,250,0.15)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Wheels
  ctx.fillStyle = 'rgba(10,10,20,0.95)';
  ctx.beginPath(); ctx.arc(-18, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(18, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Draw light glows based on light positions
  for (const light of lights) {
    const lng = light.transform?.spherical?.lng ?? 45;
    const lat = light.transform?.spherical?.lat ?? 45;
    // Map spherical to 2D position on thumbnail
    const x = 60 + Math.cos((lng * Math.PI) / 180) * 45;
    const y = 45 - (lat / 90) * 40;

    // Parse color
    const color = light.color || '#ffffff';
    const brightness = Math.min((light.brightness || 100) / 400, 1);

    // Outer glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 30 * brightness + 10);
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${0.5 * brightness})`);
    gradient.addColorStop(0.5, `rgba(${r},${g},${b},${0.15 * brightness})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 120, 90);

    // Bright core
    ctx.beginPath();
    ctx.arc(x, y, 2 + brightness * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.8 + brightness * 0.2})`;
    ctx.fill();
  }

  return canvas.toDataURL('image/jpeg', 0.7);
}

export const PREVIEW_BG_OPTIONS = [
  { value: 'black', label: 'Black' },
  { value: 'grey', label: 'Grey' },
  { value: 'white', label: 'White' },
  { value: 'custom', label: 'Custom' },
] as const;

export type PreviewBackground = (typeof PREVIEW_BG_OPTIONS)[number]['value'];