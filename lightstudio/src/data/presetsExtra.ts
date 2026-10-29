/**
 * Extra built-in presets: original rigs and single lights for HDRI Forge Studio.
 *
 * Same plain-data shape as presets.ts (`pl()` builds each light). Every entry here was designed for this
 * app's own light model: area lights with a width, height and edge softness, spots with an angle and
 * penumbra. Placement is spherical (`lng` = angle round the capture point, `height` = metres up,
 * `radius` = horizontal distance), the same fields the viewport uses.
 */

import type { PresetLight } from '../types/Preset';
import { pl } from './presets';

export interface ExtraPreset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  lights: PresetLight[];
}

/** Area light with explicit size. */
function area(
  name: string, color: string, brightness: number,
  lng: number, height: number, radius: number,
  w: number, h: number, soft = 50,
): PresetLight {
  return pl(name, 'area', color, brightness, 0, lng, height, radius, {
    areaLight: true, falloff: 'linear', areaWidth: w, areaHeight: h, edgeSoftness: soft,
  });
}

/** Spot light with an angle (degrees) and penumbra (0-1). */
function spot(
  name: string, color: string, brightness: number,
  lng: number, height: number, radius: number,
  angle: number, penumbra: number,
): PresetLight {
  return pl(name, 'spot', color, brightness, 0, lng, height, radius, { spotAngle: angle, spotPenumbra: penumbra });
}

const ring = (n: number, make: (lng: number, i: number) => PresetLight): PresetLight[] =>
  Array.from({ length: n }, (_, i) => make((360 / n) * i, i));

// ── Studio ────────────────────────────────────────────────────────
export const EXTRA_STUDIO: ExtraPreset[] = [
  { id: 'studio_twin_softbox', name: 'Twin Softboxes', description: 'Two large softboxes either side, the classic car-studio pair', tags: ['softbox', 'symmetrical', 'car'],
    lights: [area('Left Softbox', '#fff8f0', 260, 150, 3, 5, 2.5, 2, 70), area('Right Softbox', '#fff8f0', 260, 30, 3, 5, 2.5, 2, 70)] },
  { id: 'studio_strip_tunnel', name: 'Strip Tunnel', description: 'Rows of overhead strips, long clean reflections down the bodywork', tags: ['strips', 'tunnel', 'car', 'overhead'],
    lights: [-1, 0, 1].flatMap((k) => [area(`Strip ${k + 2}`, '#f4f8ff', 200, 90 + k * 55, 6, 1.2, 0.5, 5, 30)]) },
  { id: 'studio_panel_ring', name: 'Panel Ring', description: 'Six panels in a ring, even all-round wraparound', tags: ['ring', 'even', 'product'],
    lights: ring(6, (lng, i) => area(`Panel ${i + 1}`, '#ffffff', 150, lng, 2.5, 5, 1.6, 2.2, 60)) },
  { id: 'studio_cyc_white', name: 'Cyc Wall White', description: 'A huge white wall behind and a soft top, bright infinity look', tags: ['cyc', 'white', 'highkey', 'clean'],
    lights: [area('Back Wall', '#ffffff', 120, 180, 3, 8, 10, 5, 90), area('Top Soft', '#ffffff', 160, 0, 7, 1, 6, 4, 90)] },
  { id: 'studio_clamshell', name: 'Clamshell', description: 'One large softbox above, one below, flat and glamorous', tags: ['clamshell', 'beauty', 'flat'],
    lights: [area('Upper', '#fff8f2', 230, 0, 5, 3, 3, 2, 80), area('Lower', '#fff1e4', 120, 180, -1, 3, 3, 1.5, 80)] },
  { id: 'studio_butterfly', name: 'Butterfly', description: 'One high frontal key with a small fill below', tags: ['butterfly', 'beauty', 'front'],
    lights: [area('High Key', '#fff8f0', 280, 0, 6, 3, 2, 1.6, 55), area('Low Fill', '#e8f0ff', 70, 0, 0.5, 4, 2.5, 1, 85)] },
  { id: 'studio_rembrandt', name: 'Rembrandt', description: 'One side key at 45 degrees, a weak opposite fill', tags: ['rembrandt', 'dramatic', 'portrait'],
    lights: [area('Key', '#fff6ea', 300, 45, 4.5, 4, 1.8, 1.8, 40), area('Fill', '#d8e4ff', 50, 220, 2, 5, 2.4, 2, 90)] },
  { id: 'studio_gradient_room', name: 'Gradient Room', description: 'Warm wall on one side, cool on the other, soft ceiling', tags: ['gradient', 'colour', 'moody'],
    lights: [area('Warm Wall', '#ffb070', 200, 20, 2.5, 6, 3, 4, 85), area('Cool Wall', '#7098ff', 200, 200, 2.5, 6, 3, 4, 85), area('Ceiling', '#ffffff', 90, 0, 6, 1, 5, 4, 95)] },
  { id: 'studio_octa_overhead', name: 'Octa Overhead', description: 'One huge soft source straight above, very gentle falloff', tags: ['octabox', 'overhead', 'soft'],
    lights: [area('Octa', '#fffaf5', 260, 0, 7, 0.5, 5, 5, 95)] },
  { id: 'studio_wide_front_cyc', name: 'Wide Front Wash', description: 'A single broad front panel with two thin rim strips behind', tags: ['wash', 'rim', 'product'],
    lights: [area('Front Wash', '#ffffff', 180, 0, 2, 5, 6, 3, 85), area('Rim Left', '#f0f4ff', 220, 140, 2.5, 5, 0.5, 3, 35), area('Rim Right', '#f0f4ff', 220, 220, 2.5, 5, 0.5, 3, 35)] },
  { id: 'studio_checker_grid', name: 'Light Grid', description: 'A grid of small softboxes overhead, many crisp highlights', tags: ['grid', 'highlights', 'car'],
    lights: [-1, 0, 1].flatMap((a) => [-1, 1].map((b) => area(`Cell ${a + 2}${b > 0 ? 'b' : 'a'}`, '#ffffff', 170, 90 + a * 40 + b * 20, 6, 1.5, 0.9, 0.9, 40))) },
  { id: 'studio_rim_only', name: 'Rim Only', description: 'Only thin edge lights from behind, the body falls into shadow', tags: ['rim', 'dark', 'silhouette'],
    lights: [area('Rim Left', '#ffffff', 300, 135, 2.5, 5, 0.4, 3.5, 30), area('Rim Right', '#ffffff', 300, 225, 2.5, 5, 0.4, 3.5, 30), area('Top Rim', '#e8f0ff', 220, 180, 6, 2, 3, 0.4, 30)] },
];

// ── Outdoor ───────────────────────────────────────────────────────
export const EXTRA_OUTDOOR: ExtraPreset[] = [
  { id: 'outdoor_sunrise', name: 'Sunrise', description: 'Low warm sun on the horizon with a pale sky above', tags: ['warm', 'sunrise', 'low'],
    lights: [pl('Low Sun', 'directional', '#ffb070', 400, 10, 70, 1.5, 6, { falloff: 'none' }), area('Pale Sky', '#c8dcff', 110, 250, 4, 6, 8, 3, 95)] },
  { id: 'outdoor_sun_and_cloud', name: 'Sun And Cloud', description: 'Bright sun through broken cloud, a large soft fill', tags: ['sun', 'cloud', 'mixed'],
    lights: [pl('Sun', 'directional', '#fff4e0', 380, 50, 30, 6, 6, { falloff: 'none' }), area('Cloud Fill', '#e4ecff', 140, 210, 5, 6, 8, 4, 95)] },
  { id: 'outdoor_neon_night', name: 'Neon Night', description: 'Pink and cyan street neon on a dark city night', tags: ['neon', 'night', 'colour'],
    lights: [area('Pink Sign', '#ff3a9a', 240, 40, 2.5, 5, 0.6, 3, 45), area('Cyan Sign', '#22d8ff', 240, 220, 2.5, 5, 0.6, 3, 45), area('Dim Sky', '#16203a', 40, 0, 6, 1, 8, 5, 95)] },
  { id: 'outdoor_desert_noon', name: 'Desert Noon', description: 'Hard white sun overhead and a warm bounce from the sand', tags: ['harsh', 'desert', 'noon'],
    lights: [pl('Noon Sun', 'directional', '#ffffff', 450, 80, 0, 7, 4, { falloff: 'none' }), area('Sand Bounce', '#ffd9a0', 90, 0, -0.5, 6, 10, 2, 95)] },
  { id: 'outdoor_forest_dapple', name: 'Forest Dapple', description: 'Scattered small sun patches through leaves, green fill', tags: ['dapple', 'forest', 'green'],
    lights: [area('Patch 1', '#fff0c8', 260, 20, 5, 4, 0.7, 0.7, 60), area('Patch 2', '#fff0c8', 220, 100, 5.5, 3, 0.5, 0.5, 60), area('Patch 3', '#fff0c8', 240, 180, 5, 4, 0.8, 0.8, 60), area('Patch 4', '#fff0c8', 200, 290, 5.5, 3, 0.5, 0.6, 60), area('Green Fill', '#a8d890', 60, 0, 3, 6, 8, 4, 95)] },
  { id: 'outdoor_moonlight', name: 'Moonlight', description: 'One cold small moon with a deep blue sky', tags: ['moon', 'night', 'cold'],
    lights: [area('Moon', '#cfe0ff', 300, 140, 6, 5, 0.6, 0.6, 35), area('Night Sky', '#1a2c58', 50, 0, 6, 1, 9, 5, 95)] },
];

// ── Spotlight ─────────────────────────────────────────────────────
export const EXTRA_SPOTLIGHT: ExtraPreset[] = [
  { id: 'spot_stage_trio', name: 'Stage Trio', description: 'Three coloured spots from the front, concert-stage feel', tags: ['stage', 'colour', 'trio'],
    lights: [spot('Red Spot', '#ff4040', 320, 120, 5, 4, 28, 0.6), spot('White Spot', '#ffffff', 320, 90, 6, 4, 28, 0.6), spot('Blue Spot', '#4070ff', 320, 60, 5, 4, 28, 0.6)] },
  { id: 'spot_hero_down', name: 'Hero Down', description: 'A single tight spot straight down onto the subject', tags: ['hero', 'top', 'tight'],
    lights: [spot('Hero', '#ffffff', 360, 0, 7, 0.5, 22, 0.3)] },
  { id: 'spot_turntable', name: 'Turntable', description: 'A ring of spots on a turntable, even all round', tags: ['turntable', 'ring', 'even'],
    lights: ring(4, (lng, i) => spot(`Spot ${i + 1}`, '#fff8ee', 240, lng, 5, 4, 32, 0.7)) },
  { id: 'spot_backlit', name: 'Backlit Silhouette', description: 'Two hot spots from behind, a dark front', tags: ['backlight', 'silhouette', 'dark'],
    lights: [spot('Back Left', '#ffffff', 340, 150, 4, 5, 26, 0.4), spot('Back Right', '#ffffff', 340, 210, 4, 5, 26, 0.4)] },
  { id: 'spot_side_slash', name: 'Side Slash', description: 'One low hard spot from the side, long dramatic highlights', tags: ['side', 'hard', 'dramatic'],
    lights: [spot('Slash', '#fff4e0', 340, 90, 1.5, 5, 20, 0.2)] },
  { id: 'spot_cross_rim', name: 'Cross Rim', description: 'Two spots crossed from behind, warm and cool', tags: ['rim', 'cross', 'colour'],
    lights: [spot('Warm Rim', '#ffb070', 320, 140, 4, 5, 24, 0.4), spot('Cool Rim', '#70a0ff', 320, 220, 4, 5, 24, 0.4)] },
];

// ── Sidelights ────────────────────────────────────────────────────
export const EXTRA_SIDELIGHT: ExtraPreset[] = [
  { id: 'side_left_strip', name: 'Left Strip', description: 'One tall strip on the left', tags: ['strip', 'left'],
    lights: [area('Left Strip', '#f4f8ff', 240, 150, 2.5, 5, 0.5, 4, 35)] },
  { id: 'side_right_strip', name: 'Right Strip', description: 'One tall strip on the right', tags: ['strip', 'right'],
    lights: [area('Right Strip', '#f4f8ff', 240, 30, 2.5, 5, 0.5, 4, 35)] },
  { id: 'side_dual_strips', name: 'Dual Strips', description: 'A tall strip on each side, clean parallel highlights', tags: ['strip', 'symmetrical'],
    lights: [area('Left Strip', '#f4f8ff', 230, 150, 2.5, 5, 0.5, 4, 35), area('Right Strip', '#f4f8ff', 230, 30, 2.5, 5, 0.5, 4, 35)] },
  { id: 'side_left_softbox', name: 'Left Softbox', description: 'One big softbox on the left', tags: ['softbox', 'left'],
    lights: [area('Left Softbox', '#fff8f0', 250, 160, 3, 5, 2.4, 2.4, 70)] },
  { id: 'side_right_softbox', name: 'Right Softbox', description: 'One big softbox on the right', tags: ['softbox', 'right'],
    lights: [area('Right Softbox', '#fff8f0', 250, 20, 3, 5, 2.4, 2.4, 70)] },
  { id: 'side_top_and_side', name: 'Top And Side', description: 'A softbox above and a strip on one side', tags: ['top', 'strip', 'mixed'],
    lights: [area('Top Soft', '#ffffff', 180, 0, 6, 1.5, 3, 3, 85), area('Side Strip', '#f4f8ff', 220, 160, 2.5, 5, 0.5, 4, 35)] },
  { id: 'side_warm_cool_split', name: 'Warm Cool Split', description: 'Warm light from one side and cool from the other', tags: ['split', 'colour', 'warm', 'cool'],
    lights: [area('Warm Side', '#ffb070', 240, 160, 3, 5, 2, 2.5, 65), area('Cool Side', '#70a0ff', 240, 20, 3, 5, 2, 2.5, 65)] },
  { id: 'side_low_skim', name: 'Low Skim', description: 'A wide low panel that skims across the surface', tags: ['skim', 'low', 'texture'],
    lights: [area('Skim', '#fff4e8', 260, 180, 0.8, 5, 4, 0.8, 55)] },
];

// ── Single lights (Light group) ───────────────────────────────────
export const EXTRA_LIGHT_PROFILES: ExtraPreset[] = [
  { id: 'profile_tall_panel', name: 'Tall Panel', description: 'Tall rectangular panel', tags: ['panel', 'tall', 'modifier'],
    lights: [area('Tall Panel', '#ffffff', 230, 45, 3, 5, 1, 3.5, 45)] },
  { id: 'profile_wide_panel', name: 'Wide Panel', description: 'Wide, shallow panel', tags: ['panel', 'wide', 'modifier'],
    lights: [area('Wide Panel', '#ffffff', 220, 0, 3, 5, 4, 1.2, 45)] },
  { id: 'profile_hard_square', name: 'Hard Square', description: 'A crisp-edged square', tags: ['square', 'hard', 'modifier'],
    lights: [area('Hard Square', '#ffffff', 260, 45, 3, 5, 1.5, 1.5, 0)] },
  { id: 'profile_tiny_bulb', name: 'Tiny Bulb', description: 'A very small, very bright source: a sharp pinpoint reflection', tags: ['bulb', 'small', 'modifier'],
    lights: [area('Tiny Bulb', '#fff4e0', 300, 45, 3.5, 5, 0.25, 0.25, 40)] },
  { id: 'profile_big_disc', name: 'Big Disc', description: 'A large soft source', tags: ['disc', 'large', 'modifier'],
    lights: [area('Big Disc', '#fffaf5', 240, 45, 3, 5, 3, 3, 95)] },
  { id: 'profile_top_slim', name: 'Slim Top Strip', description: 'A thin strip overhead', tags: ['strip', 'top', 'modifier'],
    lights: [area('Top Strip', '#f4f8ff', 220, 0, 6, 1.5, 0.4, 5, 30)] },
  { id: 'profile_floor_bounce', name: 'Floor Bounce', description: 'A wide soft bounce from below', tags: ['bounce', 'floor', 'modifier'],
    lights: [area('Floor Bounce', '#fff1e0', 130, 0, -0.3, 6, 8, 1.5, 95)] },
  { id: 'profile_cool_window', name: 'Cool Window', description: 'A cool tall window', tags: ['window', 'cool', 'modifier'],
    lights: [area('Cool Window', '#cfe0ff', 230, 120, 3, 5, 2, 3.5, 20)] },
  { id: 'profile_warm_lamp', name: 'Warm Lamp', description: 'A small warm tungsten-style lamp', tags: ['lamp', 'warm', 'modifier'],
    lights: [area('Warm Lamp', '#ffb668', 220, 60, 2, 4, 0.7, 0.9, 70)] },
  { id: 'profile_neon_tube', name: 'Neon Tube', description: 'A long thin coloured tube', tags: ['neon', 'tube', 'modifier'],
    lights: [area('Neon Tube', '#ff40a0', 260, 90, 2.5, 5, 0.18, 4, 40)] },
  { id: 'profile_corner_fill', name: 'Corner Fill', description: 'A broad, dim fill from a back corner', tags: ['fill', 'soft', 'modifier'],
    lights: [area('Corner Fill', '#e4ecff', 90, 225, 2, 6, 3.5, 3.5, 95)] },
  { id: 'profile_hairlight', name: 'Hairlight', description: 'A small hot light high behind the subject', tags: ['hair', 'rim', 'modifier'],
    lights: [area('Hairlight', '#ffffff', 300, 180, 5.5, 3, 0.8, 0.5, 35)] },
  { id: 'profile_slab', name: 'Slab', description: 'A broad flat slab, very clean edge', tags: ['slab', 'clean', 'modifier'],
    lights: [area('Slab', '#ffffff', 220, 0, 3, 5, 5, 2, 10)] },
  { id: 'profile_overhead_large', name: 'Overhead Large', description: 'A huge soft source straight above', tags: ['overhead', 'large', 'modifier'],
    lights: [area('Overhead Large', '#ffffff', 220, 0, 7, 0.5, 6, 6, 90)] },
  { id: 'profile_spot_wide', name: 'Spot Wide', description: 'A wide soft-edged spot', tags: ['spot', 'wide', 'modifier'],
    lights: [spot('Spot Wide', '#fff8ee', 260, 45, 5, 4, 55, 0.8)] },
  { id: 'profile_spot_tight', name: 'Spot Tight', description: 'A tight hard-edged spot', tags: ['spot', 'tight', 'modifier'],
    lights: [spot('Spot Tight', '#ffffff', 340, 45, 5, 4, 12, 0.15)] },
];
