/**
 * HDRI Environment Preset definitions for Phase 9.
 * Each preset describes a procedural studio environment with colored light panels.
 */

export interface EnvPanel {
  /** Position [x, y, z] of the emissive panel */
  position: [number, number, number];
  /** Width × Height of the panel */
  size: [number, number];
  /** Rotation around Y axis (radians). 0 = facing center, PI/2 = facing right, -PI/2 = facing left */
  rotationY: number;
  /** Rotation around X axis (radians). PI/2 = horizontal (ceiling) */
  rotationX?: number;
  /** Panel color (hex) */
  color: number;
  /** Panel brightness multiplier (0-3) */
  intensity: number;
}

export interface HDRIPreset {
  id: string;
  name: string;
  category: 'studio' | 'outdoor' | 'creative';
  description: string;
  /** Background color shown behind the model (CSS-compatible) */
  backgroundHint: string;
  /** Gradient colors for the thumbnail swatch */
  thumbnailGradient: [string, string, string];
  /** The light panels that define this environment */
  panels: EnvPanel[];
  /** Optional: overall ambient fill color and intensity */
  ambient?: { color: number; intensity: number };
  /** Optional: ground/reflectivity color */
  groundColor?: number;
}

// ── Built-in procedural HDRI presets ──────────────────────────────────────────

export const HDRI_PRESETS: HDRIPreset[] = [
  {
    id: 'studio-neutral',
    name: 'Neutral Studio',
    category: 'studio',
    description: 'Balanced 3-point studio lighting with neutral white tones',
    backgroundHint: '#2a2a3e',
    thumbnailGradient: ['#444455', '#888899', '#444455'],
    panels: [
      { position: [0, 6, 0], size: [6, 6], rotationY: 0, rotationX: Math.PI / 2, color: 0xffffff, intensity: 1.0 },
      { position: [6, 3, 0], size: [4, 5], rotationY: -Math.PI / 2, color: 0xffeedd, intensity: 0.7 },
      { position: [-6, 3, 0], size: [4, 5], rotationY: Math.PI / 2, color: 0xddeeff, intensity: 0.5 },
      { position: [0, 3, -7], size: [8, 5], rotationY: 0, color: 0xccccdd, intensity: 0.3 },
    ],
    ambient: { color: 0x888899, intensity: 0.3 },
    groundColor: 0x333344,
  },
  {
    id: 'studio-warm',
    name: 'Warm Studio',
    category: 'studio',
    description: 'Warm-toned studio with golden key and amber fill lights',
    backgroundHint: '#2e2a1e',
    thumbnailGradient: ['#554422', '#cc9944', '#553311'],
    panels: [
      { position: [0, 6, 0], size: [6, 6], rotationY: 0, rotationX: Math.PI / 2, color: 0xffe4c4, intensity: 1.2 },
      { position: [6, 3, 2], size: [4, 5], rotationY: -Math.PI / 2, color: 0xffcc88, intensity: 0.8 },
      { position: [-5, 2, 0], size: [4, 4], rotationY: Math.PI / 2, color: 0xffddaa, intensity: 0.4 },
      { position: [0, 3, -7], size: [8, 5], rotationY: 0, color: 0x886644, intensity: 0.3 },
      { position: [4, 1, -5], size: [3, 3], rotationY: -Math.PI / 4, color: 0xffaa66, intensity: 0.3 },
    ],
    ambient: { color: 0x998866, intensity: 0.3 },
    groundColor: 0x3a3322,
  },
  {
    id: 'studio-cool',
    name: 'Cool Studio',
    category: 'studio',
    description: 'Cool blue-tinted studio for metallic and silver finishes',
    backgroundHint: '#1a2a3e',
    thumbnailGradient: ['#223355', '#6688bb', '#223355'],
    panels: [
      { position: [0, 6, 0], size: [6, 6], rotationY: 0, rotationX: Math.PI / 2, color: 0xccddff, intensity: 1.0 },
      { position: [6, 3, 0], size: [4, 5], rotationY: -Math.PI / 2, color: 0x88aadd, intensity: 0.7 },
      { position: [-6, 3, 0], size: [4, 5], rotationY: Math.PI / 2, color: 0x99bbff, intensity: 0.5 },
      { position: [0, 3, -7], size: [8, 5], rotationY: 0, color: 0x445577, intensity: 0.3 },
    ],
    ambient: { color: 0x667799, intensity: 0.3 },
    groundColor: 0x223344,
  },
  {
    id: 'studio-dramatic',
    name: 'Dramatic',
    category: 'studio',
    description: 'High-contrast dramatic lighting with deep shadows',
    backgroundHint: '#111118',
    thumbnailGradient: ['#111111', '#444444', '#0a0a0a'],
    panels: [
      { position: [5, 5, 3], size: [3, 6], rotationY: -Math.PI / 3, color: 0xffffff, intensity: 1.5 },
      { position: [-7, 2, 0], size: [3, 3], rotationY: Math.PI / 2, color: 0x2222ff, intensity: 0.2 },
      { position: [0, 6, 0], size: [3, 3], rotationY: 0, rotationX: Math.PI / 2, color: 0x888888, intensity: 0.15 },
    ],
    ambient: { color: 0x222222, intensity: 0.1 },
    groundColor: 0x111111,
  },
  {
    id: 'studio-ring',
    name: 'Ring Light',
    category: 'studio',
    description: 'Even front-facing ring light for beauty and product shots',
    backgroundHint: '#1e1e2e',
    thumbnailGradient: ['#333344', '#aaaaaa', '#333344'],
    panels: [
      { position: [0, 0, 6], size: [5, 5], rotationY: Math.PI, color: 0xffffff, intensity: 1.0 },
      { position: [0, 6, 0], size: [4, 4], rotationY: 0, rotationX: Math.PI / 2, color: 0xdddddd, intensity: 0.3 },
      { position: [0, -1, 6], size: [5, 2], rotationY: Math.PI, color: 0xffffff, intensity: 0.3 },
    ],
    ambient: { color: 0x666677, intensity: 0.2 },
    groundColor: 0x2a2a3a,
  },
  {
    id: 'outdoor-sunset',
    name: 'Golden Hour',
    category: 'outdoor',
    description: 'Warm sunset lighting with long golden shadows',
    backgroundHint: '#2e1a0e',
    thumbnailGradient: ['#ff6622', '#ffaa44', '#332211'],
    panels: [
      { position: [10, 3, -2], size: [12, 8], rotationY: -Math.PI / 4, color: 0xff8844, intensity: 1.2 },
      { position: [-8, 8, -5], size: [16, 10], rotationY: Math.PI / 6, color: 0xff6622, intensity: 0.6 },
      { position: [0, 10, 0], size: [20, 10], rotationY: 0, rotationX: Math.PI / 2, color: 0x443322, intensity: 0.2 },
      { position: [0, 2, 8], size: [10, 4], rotationY: Math.PI, color: 0x223344, intensity: 0.15 },
    ],
    ambient: { color: 0x664422, intensity: 0.3 },
    groundColor: 0x221100,
  },
  {
    id: 'outdoor-overcast',
    name: 'Overcast',
    category: 'outdoor',
    description: 'Soft even lighting from cloudy sky, no harsh shadows',
    backgroundHint: '#2a2d33',
    thumbnailGradient: ['#556677', '#889999', '#445566'],
    panels: [
      { position: [0, 10, 0], size: [20, 20], rotationY: 0, rotationX: Math.PI / 2, color: 0xcccccc, intensity: 0.6 },
      { position: [10, 5, 0], size: [10, 10], rotationY: -Math.PI / 2, color: 0xaaaaaa, intensity: 0.3 },
      { position: [-10, 5, 0], size: [10, 10], rotationY: Math.PI / 2, color: 0xaaaaaa, intensity: 0.3 },
      { position: [0, 5, -10], size: [10, 10], rotationY: 0, color: 0x999999, intensity: 0.25 },
      { position: [0, 5, 10], size: [10, 10], rotationY: Math.PI, color: 0x999999, intensity: 0.2 },
    ],
    ambient: { color: 0x889999, intensity: 0.5 },
    groundColor: 0x334455,
  },
  {
    id: 'outdoor-night',
    name: 'Night Street',
    category: 'outdoor',
    description: 'Dark moody nighttime with colored city light accents',
    backgroundHint: '#0a0a14',
    thumbnailGradient: ['#0a0a1e', '#223366', '#0a0a1e'],
    panels: [
      { position: [8, 4, 3], size: [3, 4], rotationY: -Math.PI / 3, color: 0xff6644, intensity: 0.6 },
      { position: [-6, 5, -2], size: [2, 3], rotationY: Math.PI / 4, color: 0x4466ff, intensity: 0.5 },
      { position: [0, 10, 0], size: [20, 10], rotationY: 0, rotationX: Math.PI / 2, color: 0x111122, intensity: 0.05 },
      { position: [5, 2, -5], size: [2, 2], rotationY: -Math.PI / 6, color: 0xffcc44, intensity: 0.2 },
    ],
    ambient: { color: 0x111133, intensity: 0.15 },
    groundColor: 0x0a0a11,
  },
  {
    id: 'creative-neon',
    name: 'Neon Glow',
    category: 'creative',
    description: 'Vibrant neon-colored accents on dark background',
    backgroundHint: '#0a0a12',
    thumbnailGradient: ['#ff0066', '#6600ff', '#00ffcc'],
    panels: [
      { position: [6, 3, 2], size: [1.5, 5], rotationY: -Math.PI / 3, color: 0xff0066, intensity: 0.8 },
      { position: [-5, 4, -1], size: [1.5, 4], rotationY: Math.PI / 3, color: 0x6600ff, intensity: 0.7 },
      { position: [0, 6, 0], size: [4, 4], rotationY: 0, rotationX: Math.PI / 2, color: 0x222222, intensity: 0.1 },
      { position: [3, 1, 6], size: [2, 2], rotationY: -Math.PI / 6, color: 0x00ffcc, intensity: 0.4 },
      { position: [-3, 2, -6], size: [3, 2], rotationY: Math.PI / 5, color: 0xff0066, intensity: 0.2 },
    ],
    ambient: { color: 0x111122, intensity: 0.1 },
    groundColor: 0x0a0a10,
  },
  {
    id: 'creative-gradient',
    name: 'Soft Gradient',
    category: 'creative',
    description: 'Gentle top-to-bottom gradient for clean product renders',
    backgroundHint: '#1a1a2e',
    thumbnailGradient: ['#e8e0d8', '#c0b8b0', '#1a1a2e'],
    panels: [
      { position: [0, 8, 0], size: [16, 12], rotationY: 0, rotationX: Math.PI / 2, color: 0xeeeeee, intensity: 0.5 },
      { position: [0, 2, -8], size: [12, 4], rotationY: 0, color: 0xcccccc, intensity: 0.2 },
    ],
    ambient: { color: 0x999999, intensity: 0.4 },
    groundColor: 0x333333,
  },
  {
    id: 'creative-warehouse',
    name: 'Warehouse',
    category: 'creative',
    description: 'Industrial warehouse with high ceilings and strip lights',
    backgroundHint: '#1c1c1c',
    thumbnailGradient: ['#333322', '#999977', '#222211'],
    panels: [
      { position: [-4, 8, 0], size: [1, 12], rotationY: 0, color: 0xffffee, intensity: 1.0 },
      { position: [0, 8, 0], size: [1, 12], rotationY: 0, color: 0xffffee, intensity: 0.8 },
      { position: [4, 8, 0], size: [1, 12], rotationY: 0, color: 0xffffee, intensity: 0.6 },
      { position: [0, 10, 0], size: [20, 20], rotationY: 0, rotationX: Math.PI / 2, color: 0x222211, intensity: 0.05 },
    ],
    ambient: { color: 0x444433, intensity: 0.2 },
    groundColor: 0x1a1a11,
  },
  {
    id: 'none',
    name: 'None (Flat)',
    category: 'studio',
    description: 'No environment map, only direct lights',
    backgroundHint: '#0d0d1a',
    thumbnailGradient: ['#0d0d1a', '#1a1a2e', '#0d0d1a'],
    panels: [],
    ambient: { color: 0x404060, intensity: 0.15 },
    groundColor: 0x2a2a3e,
  },
];

export function getHDRIPresetById(id: string): HDRIPreset | undefined {
  return HDRI_PRESETS.find((p) => p.id === id);
}

export function getHDRIPresetsByCategory(category: HDRIPreset['category']): HDRIPreset[] {
  return HDRI_PRESETS.filter((p) => p.category === category);
}