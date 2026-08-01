/**
 * Complete built-in light preset definitions for LightForge Studio.
 *
 * Categories:
 *   Studio   (6 presets)  — controlled studio environments
 *   Outdoor  (5 presets)  — natural / outdoor lighting
 *   Spotlight (6 presets) — focused spot / dramatic setups
 *
 * Each preset is a plain-data object compatible with the Preset type.
 * Thumbnails are generated at runtime by PresetThumbnailRenderer.
 */

import type { PresetLight } from '../types/Preset';

// ── Helper: build a PresetLight with minimal boilerplate ────────────

type LT = PresetLight['type'];
type CP = PresetLight['colorProfile'];
type FF = PresetLight['falloff'];

function pl(
  name: string,
  type: LT,
  color: string,
  brightness: number,
  lat: number,
  lng: number,
  height: number,
  radius: number,
  opts: Partial<Omit<PresetLight, 'name' | 'type' | 'color' | 'brightness' | 'transform'>> = {},
): PresetLight {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = Math.max(0.01, radius);
  const posX = r * Math.cos(toRad(lat)) * Math.sin(toRad(lng));
  const posZ = r * Math.cos(toRad(lat)) * Math.cos(toRad(lng));
  const posY = height;

  return {
    name,
    type,
    color,
    brightness,
    opacity: 100,
    colorProfile: (opts.colorProfile ?? 'daylight') as CP,
    areaLight: opts.areaLight ?? false,
    falloff: (opts.falloff ?? 'quadratic') as FF,
    transform: {
      spherical: { lat, lng, radius: r, height },
      position: { x: posX, y: posY, z: posZ },
      rotation: {
        x: 0,
        y: 0,
        z: 0,
        mode: 'euler',
        enabled: false,
        repeat: false,
        advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 },
      },
      maisleU: 0,
      mendieV: 0,
      smartGolly: 0,
      dailyMultiplier: 1,
    },
    ...opts,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  STUDIO PRESETS (6)
// ═══════════════════════════════════════════════════════════════════

export const STUDIO_PRESETS: PresetLight[][] = [
  // 1. 3-Point Classic
  [
    pl('Key Light', 'spot', '#fff5e6', 300, 45, 45, 4, 6),
    pl('Fill Light', 'area', '#c8d8ff', 100, 30, 270, 2, 5, { areaLight: true, falloff: 'linear' }),
    pl('Rim Light', 'rim', '#4a9eff', 180, 10, 180, 2, 7),
  ],
  // 2. Beauty Soft
  [
    pl('Overhead Softbox', 'area', '#fff8f0', 220, 85, 0, 5, 4, { areaLight: true, falloff: 'linear' }),
    pl('Front Fill', 'area', '#ffe8d0', 90, 20, 0, 2, 5, { areaLight: true, falloff: 'linear' }),
    pl('Side Bounce', 'point', '#ffd4a8', 50, 15, 300, 1.5, 4),
  ],
  // 3. High Key White
  [
    pl('Left Panel', 'area', '#ffffff', 280, 30, 210, 2.5, 5, { areaLight: true, falloff: 'linear' }),
    pl('Right Panel', 'area', '#ffffff', 280, 30, 330, 2.5, 5, { areaLight: true, falloff: 'linear' }),
    pl('Top Panel', 'area', '#ffffff', 200, 90, 0, 5.5, 3, { areaLight: true, falloff: 'linear' }),
    pl('Front Fill', 'area', '#ffffff', 120, 20, 0, 1.5, 5, { areaLight: true, falloff: 'linear' }),
  ],
  // 4. Low Key Dramatic
  [
    pl('Hard Key', 'spot', '#ffe0b0', 400, 40, 70, 3.5, 6, { colorProfile: 'tungsten' }),
    pl('Subtle Fill', 'point', '#1a1a3a', 15, 25, 250, 2, 5),
    pl('Background Accent', 'rim', '#1a0a2e', 80, 5, 200, 1.5, 8),
  ],
  // 5. Fashion Editorial
  [
    pl('Left Rim', 'rim', '#ffffff', 220, 20, 160, 3, 6),
    pl('Right Rim', 'rim', '#c8d8ff', 220, 20, 200, 3, 6),
    pl('Center Fill', 'area', '#f0e8ff', 60, 30, 0, 2, 5, { areaLight: true, falloff: 'linear' }),
    pl('Hair Light', 'spot', '#e0d0ff', 180, 70, 180, 4.5, 5),
  ],
  // 6. Product Hero
  [
    pl('Top Down Soft', 'area', '#ffffff', 300, 90, 0, 6, 3, { areaLight: true, falloff: 'linear' }),
    pl('Front Fill', 'area', '#f8f8ff', 100, 25, 0, 2, 4, { areaLight: true, falloff: 'linear' }),
    pl('Left Accent', 'point', '#d0e0ff', 60, 35, 120, 2, 5),
    pl('Right Accent', 'point', '#ffd8c0', 60, 35, 240, 2, 5),
  ],
];

export const STUDIO_META = [
  { id: 'studio_3point', name: '3-Point Classic', description: 'Key + Fill + Rim — the universal studio standard', tags: ['classic', 'versatile', 'standard'] },
  { id: 'studio_beauty', name: 'Beauty Soft', description: 'Large overhead softbox with warm bounce fill', tags: ['beauty', 'soft', 'portrait'] },
  { id: 'studio_highkey', name: 'High Key White', description: 'Bright white studio with minimal shadows', tags: ['bright', 'clean', 'white'] },
  { id: 'studio_lowkey', name: 'Low Key Dramatic', description: 'Single hard key with deep shadows and mood', tags: ['dramatic', 'dark', 'contrast'] },
  { id: 'studio_fashion', name: 'Fashion Editorial', description: 'Dual rim lights with subtle center fill', tags: ['fashion', 'editorial', 'rim'] },
  { id: 'studio_product', name: 'Product Hero', description: 'Top-down soft light with balanced front fill', tags: ['product', 'commercial', 'top'] },
];

// ═══════════════════════════════════════════════════════════════════
//  OUTDOOR PRESETS (5)
// ═══════════════════════════════════════════════════════════════════

export const OUTDOOR_PRESETS: PresetLight[][] = [
  // 1. Golden Hour
  [
    pl('Sun', 'directional', '#ffb347', 400, 20, 135, 3, 20, { falloff: 'none' }),
    pl('Sky Fill', 'area', '#b8d4ff', 80, 40, 270, 6, 10, { areaLight: true, falloff: 'linear' }),
    pl('Ground Bounce', 'point', '#c8a070', 50, -30, 0, -1, 5),
  ],
  // 2. Overcast Sky
  [
    pl('Diffused Top', 'area', '#d0d8e8', 180, 90, 0, 6, 4, { areaLight: true, falloff: 'linear' }),
    pl('Ambient Fill', 'area', '#c0c8d8', 100, 50, 180, 4, 6, { areaLight: true, falloff: 'linear' }),
  ],
  // 3. Midday Sun
  [
    pl('Harsh Sun', 'directional', '#fffbe6', 500, 80, 120, 10, 20, { falloff: 'none' }),
    pl('Ambient Sky', 'point', '#a8c8ff', 40, 30, 270, 4, 8),
  ],
  // 4. Blue Hour Dusk
  [
    pl('Horizon Glow', 'directional', '#ff8844', 200, 5, 270, 1, 15, { falloff: 'none' }),
    pl('Cool Sky Ambient', 'area', '#6688cc', 100, 50, 90, 5, 8, { areaLight: true, falloff: 'linear' }),
    pl('Subtle Fill', 'point', '#4466aa', 40, 30, 0, 2, 6),
  ],
  // 5. Stormy Dramatic
  [
    pl('Silver Rim', 'rim', '#b0c0d8', 250, 10, 180, 3, 8),
    pl('Gloomy Ambient', 'point', '#3a4050', 30, 45, 0, 4, 6),
  ],
];

export const OUTDOOR_META = [
  { id: 'outdoor_golden', name: 'Golden Hour', description: 'Warm directional sun with long shadows', tags: ['warm', 'golden', 'sunset'] },
  { id: 'outdoor_overcast', name: 'Overcast Sky', description: 'Soft diffused top light, no harsh shadows', tags: ['soft', 'diffused', 'flat'] },
  { id: 'outdoor_midday', name: 'Midday Sun', description: 'Harsh overhead with strong contrast', tags: ['harsh', 'bright', 'contrast'] },
  { id: 'outdoor_bluehour', name: 'Blue Hour Dusk', description: 'Cool ambient with warm horizon glow', tags: ['cool', 'dusk', 'moody'] },
  { id: 'outdoor_stormy', name: 'Stormy Dramatic', description: 'Dark sky with a single silver rim light', tags: ['dark', 'storm', 'rim'] },
];

// ═══════════════════════════════════════════════════════════════════
//  SPOTLIGHT PRESETS (6)
// ═══════════════════════════════════════════════════════════════════

export const SPOTLIGHT_PRESETS: PresetLight[][] = [
  // 1. Concert Spot
  [
    pl('Main Spot', 'spot', '#e0e8ff', 500, 70, 0, 6, 7),
  ],
  // 2. Museum Highlight
  [
    pl('Exhibit Spot', 'spot', '#ffffff', 350, 55, 30, 5, 6),
    pl('Ambient Fill', 'point', '#e8e0d8', 25, 45, 180, 3, 6),
  ],
  // 3. Theatrical Cross
  [
    pl('Spot Left', 'spot', '#ffcc88', 280, 50, 135, 4, 7, { colorProfile: 'tungsten' }),
    pl('Spot Right', 'spot', '#88ccff', 280, 50, 225, 4, 7, { colorProfile: 'daylight' }),
  ],
  // 4. Neon Duo
  [
    pl('Cool Spot', 'spot', '#00ccff', 300, 45, 120, 4, 6),
    pl('Warm Spot', 'spot', '#ff6600', 300, 45, 240, 4, 6, { colorProfile: 'tungsten' }),
  ],
  // 5. Crime Scene
  [
    pl('Overhead Interrogation', 'spot', '#e8e0d0', 350, 85, 0, 6, 5, { colorProfile: 'tungsten' }),
  ],
  // 6. Car Reveal
  [
    pl('Stage Left Spot', 'spot', '#ffffff', 320, 40, 150, 5, 7),
    pl('Stage Right Spot', 'spot', '#ffffff', 320, 40, 210, 5, 7),
    pl('Front Fill', 'area', '#f0f0ff', 80, 20, 0, 2, 5, { areaLight: true, falloff: 'linear' }),
    pl('Ground Wash', 'point', '#c8c0ff', 40, -45, 0, -0.5, 4),
  ],
];

export const SPOTLIGHT_META = [
  { id: 'spot_concert', name: 'Concert Spot', description: 'Single hard spot from directly above', tags: ['single', 'dramatic', 'stage'] },
  { id: 'spot_museum', name: 'Museum Highlight', description: 'Tight clean spotlight on white background', tags: ['clean', 'museum', 'focused'] },
  { id: 'spot_theatrical', name: 'Theatrical Cross', description: 'Two spots crossed at 45 degrees', tags: ['cross', 'theater', 'dual'] },
  { id: 'spot_neon', name: 'Neon Duo', description: 'One cool and one warm tight spot', tags: ['neon', 'color', 'contrast'] },
  { id: 'spot_crime', name: 'Crime Scene', description: 'Harsh overhead single spot, interrogation style', tags: ['harsh', 'overhead', 'noir'] },
  { id: 'spot_carreveal', name: 'Car Reveal', description: 'Twin spots from front-top with ground wash', tags: ['reveal', 'stage', 'event'] },
];

// ═══════════════════════════════════════════════════════════════════
//  LEGACY SIDE LIGHTS (kept for backward compat)
// ═══════════════════════════════════════════════════════════════════

export const SIDELIGHT_PRESETS: PresetLight[][] = [
  [
    pl('Key Sidelight', 'spot', '#ffe0b0', 350, 35, 90, 3, 5, { colorProfile: 'tungsten' }),
    pl('Cool Fill', 'point', '#a0b8e0', 40, 20, 270, 2, 6),
  ],
];

export const SIDELIGHT_META = [
  { id: 'side_dramatic', name: 'Dramatic Sidelight', description: 'Hard side key with cool opposite fill', tags: ['side', 'dramatic', 'classic'] },
];