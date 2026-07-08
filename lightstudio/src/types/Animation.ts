// ── Easing Functions ──────────────────────────────────────────────────────────

export type EasingType =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack';

// ── Animated Property Identifiers ────────────────────────────────────────────

export type AnimatedProperty =
  // Light properties
  | 'light.brightness'
  | 'light.color'
  | 'light.positionX'
  | 'light.positionY'
  | 'light.positionZ'
  | 'light.rotationX'
  | 'light.rotationY'
  | 'light.rotationZ'
  | 'light.spotAngle'
  | 'light.areaWidth'
  | 'light.areaHeight'
  // Camera properties
  | 'camera.positionX'
  | 'camera.positionY'
  | 'camera.positionZ'
  | 'camera.targetX'
  | 'camera.targetY'
  | 'camera.targetZ'
  | 'camera.fov'
  // Turntable
  | 'turntable.speed'
  | 'turntable.rotation'
  // Render settings
  | 'render.exposure'
  | 'render.bloomIntensity'
  | 'render.bloomThreshold';

// ── Keyframe ─────────────────────────────────────────────────────────────────

export interface Keyframe {
  id: string;
  frame: number;
  value: number;
  easing: EasingType;
}

// ── Track ────────────────────────────────────────────────────────────────────

export type TrackCategory = 'light' | 'camera' | 'turntable' | 'render';

export interface AnimationTrack {
  id: string;
  name: string;
  property: AnimatedProperty;
  category: TrackCategory;
  /** Reference to the light ID this track targets (for light tracks only) */
  lightId: string | null;
  keyframes: Keyframe[];
  /** Whether this track is muted (solo/isolate system) */
  muted: boolean;
  /** Whether this track is visible in the timeline */
  visible: boolean;
  /** Color for the track lane (hex) */
  color: string;
}

// ── Animation State ──────────────────────────────────────────────────────────

export interface AnimationState {
  /** Current frame position */
  currentFrame: number;
  /** Start frame of the playback range */
  frameStart: number;
  /** End frame of the playback range */
  frameEnd: number;
  /** Frames per second for playback */
  fps: number;
  /** Whether animation is currently playing */
  isPlaying: boolean;
  /** Whether to loop back to start when reaching end */
  isLooping: boolean;
  /** All animation tracks */
  tracks: AnimationTrack[];
  /** Currently selected keyframe ID (for editing) */
  selectedKeyframeId: string | null;
  /** Currently selected track ID */
  selectedTrackId: string | null;
  /** Snap to frame when scrubbing */
  snapToFrame: boolean;
  /** Whether the timeline panel is expanded */
  expanded: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function createKeyframe(
  frame: number,
  value: number,
  easing: EasingType = 'linear',
): Keyframe {
  return {
    id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    frame: Math.round(frame),
    value,
    easing,
  };
}

export function createTrack(
  property: AnimatedProperty,
  name: string,
  category: TrackCategory,
  options: Partial<AnimationTrack> = {},
): AnimationTrack {
  return {
    id: `track_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name,
    property,
    category,
    lightId: options.lightId ?? null,
    keyframes: [],
    muted: false,
    visible: true,
    color: options.color ?? getCategoryColor(category),
  };
}

export function getCategoryColor(category: TrackCategory): string {
  switch (category) {
    case 'light': return '#4a9eff';
    case 'camera': return '#8b5cf6';
    case 'turntable': return '#22c55e';
    case 'render': return '#f59e0b';
  }
}

export function getPropertyLabel(property: AnimatedProperty): string {
  const labels: Record<AnimatedProperty, string> = {
    'light.brightness': 'Brightness',
    'light.color': 'Color',
    'light.positionX': 'Pos X',
    'light.positionY': 'Pos Y',
    'light.positionZ': 'Pos Z',
    'light.rotationX': 'Rot X',
    'light.rotationY': 'Rot Y',
    'light.rotationZ': 'Rot Z',
    'light.spotAngle': 'Spot Angle',
    'light.areaWidth': 'Area W',
    'light.areaHeight': 'Area H',
    'camera.positionX': 'Cam Pos X',
    'camera.positionY': 'Cam Pos Y',
    'camera.positionZ': 'Cam Pos Z',
    'camera.targetX': 'Cam Tgt X',
    'camera.targetY': 'Cam Tgt Y',
    'camera.targetZ': 'Cam Tgt Z',
    'camera.fov': 'FOV',
    'turntable.speed': 'Speed',
    'turntable.rotation': 'Rotation',
    'render.exposure': 'Exposure',
    'render.bloomIntensity': 'Bloom Int.',
    'render.bloomThreshold': 'Bloom Thr.',
  };
  return labels[property];
}

export function getTrackDisplayName(track: AnimationTrack): string {
  return track.name;
}

// ── Default state ────────────────────────────────────────────────────────────

export const DEFAULT_ANIMATION_STATE: AnimationState = {
  currentFrame: 0,
  frameStart: 0,
  frameEnd: 100,
  fps: 30,
  isPlaying: false,
  isLooping: true,
  tracks: [],
  selectedKeyframeId: null,
  selectedTrackId: null,
  snapToFrame: true,
  expanded: true,
};

// ── Easing math ──────────────────────────────────────────────────────────────

export function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'linear': return t;
    case 'easeInQuad': return t * t;
    case 'easeOutQuad': return t * (2 - t);
    case 'easeInOutQuad': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'easeInCubic': return t * t * t;
    case 'easeOutCubic': {
      const t1 = t - 1;
      return t1 * t1 * t1 + 1;
    }
    case 'easeInOutCubic':
      return t < 0.5
        ? 4 * t * t * t
        : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    case 'easeInExpo': return t === 0 ? 0 : Math.pow(2, 10 * (t - 1));
    case 'easeOutExpo': return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'easeInOutExpo':
      if (t === 0) return 0;
      if (t === 1) return 1;
      if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
      return (2 - Math.pow(2, -20 * t + 10)) / 2;
    case 'easeInBack': {
      const s = 1.70158;
      return t * t * ((s + 1) * t - s);
    }
    case 'easeOutBack': {
      const s = 1.70158;
      const t1 = t - 1;
      return t1 * t1 * ((s + 1) * t1 + s) + 1;
    }
    case 'easeInOutBack': {
      const s = 1.70158 * 1.525;
      if (t < 0.5) {
        const t1 = 2 * t;
        return (t1 * t1 * ((s + 1) * t1 - s)) / 2;
      }
      const t1 = 2 * t - 2;
      return (t1 * t1 * ((s + 1) * t1 + s) + 2) / 2;
    }
    default: return t;
  }
}