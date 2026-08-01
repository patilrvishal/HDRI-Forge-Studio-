import { create } from 'zustand';
import type {
  AnimationState,
  AnimationTrack,
  AnimatedProperty,
  EasingType,
  Keyframe,
  TrackCategory,
} from '../types/Animation';
import { DEFAULT_ANIMATION_STATE, createKeyframe, createTrack } from '../types/Animation';
import { history } from './historyStore';

interface AnimationStore extends AnimationState {
  // ── Playback ─────────────────────────────────────────────────────────────
  play: () => void;
  pause: () => void;
  togglePlaying: () => void;
  stop: () => void;
  setCurrentFrame: (frame: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  jumpToStart: () => void;
  jumpToEnd: () => void;
  setFrameRange: (start: number, end: number) => void;
  setFPS: (fps: number) => void;
  toggleLooping: () => void;
  toggleSnapToFrame: () => void;
  toggleExpanded: () => void;
  advanceFrame: () => void;
  /** Called by the render loop; returns true if frame advanced (for loop detection) */
  tick: () => boolean;

  // ── Track management ─────────────────────────────────────────────────────
  addTrack: (property: AnimatedProperty, name: string, category: TrackCategory, lightId?: string | null) => string;
  removeTrack: (trackId: string) => void;
  duplicateTrack: (trackId: string) => string | null;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisible: (trackId: string) => void;
  selectTrack: (trackId: string | null) => void;
  reorderTrack: (fromIndex: number, toIndex: number) => void;

  // ── Keyframe management ──────────────────────────────────────────────────
  addKeyframe: (trackId: string, frame: number, value: number, easing?: EasingType) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Pick<Keyframe, 'frame' | 'value' | 'easing'>>) => void;
  moveKeyframe: (trackId: string, keyframeId: string, newFrame: number) => void;
  selectKeyframe: (keyframeId: string | null) => void;

  // ── Bulk operations ──────────────────────────────────────────────────────
  clearAllTracks: () => void;
  clearTrackKeyframes: (trackId: string) => void;

  // ── Serialization ────────────────────────────────────────────────────────
  exportAnimation: () => AnimationState;
  importAnimation: (state: AnimationState) => void;
}

export const useAnimationStore = create<AnimationStore>((set, get) => ({
  ...DEFAULT_ANIMATION_STATE,

  // ── Playback (NOT recorded — playback state is transient) ────────────────

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
  stop: () => set({ isPlaying: false, currentFrame: 0 }),
  setCurrentFrame: (frame) => {
    // Scrubbing the timeline is NOT recorded per-frame
    const { frameStart, frameEnd, snapToFrame } = get();
    const clamped = Math.max(frameStart, Math.min(frameEnd, frame));
    set({ currentFrame: snapToFrame ? Math.round(clamped) : clamped });
  },
  stepForward: () => {
    const { currentFrame, frameEnd, isLooping, frameStart } = get();
    const next = currentFrame + 1;
    if (next > frameEnd) {
      set({ currentFrame: isLooping ? frameStart : frameEnd });
    } else {
      set({ currentFrame: next });
    }
  },
  stepBackward: () => {
    const { currentFrame, frameStart, frameEnd, isLooping } = get();
    const prev = currentFrame - 1;
    if (prev < frameStart) {
      set({ currentFrame: isLooping ? frameEnd : frameStart });
    } else {
      set({ currentFrame: prev });
    }
  },
  jumpToStart: () => set((s) => ({ currentFrame: s.frameStart })),
  jumpToEnd: () => set((s) => ({ currentFrame: s.frameEnd })),
  setFrameRange: (start, end) => {
    history.record('Change Frame Range');
    const state = get();
    set({
      frameStart: Math.max(0, start),
      frameEnd: Math.max(start + 1, end),
      currentFrame: Math.max(start, Math.min(end, state.currentFrame)),
    });
  },
  setFPS: (fps) => {
    history.record('Change FPS');
    set({ fps: Math.max(1, Math.min(120, fps)) });
  },
  toggleLooping: () => set((s) => ({ isLooping: !s.isLooping })),
  toggleSnapToFrame: () => set((s) => ({ snapToFrame: !s.snapToFrame })),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  advanceFrame: () => {
    get().stepForward();
  },

  tick: () => {
    const state = get();
    if (!state.isPlaying) return false;
    const next = state.currentFrame + 1;
    let wrapped = false;
    if (next > state.frameEnd) {
      if (state.isLooping) {
        set({ currentFrame: state.frameStart });
        wrapped = true;
      } else {
        set({ isPlaying: false, currentFrame: state.frameEnd });
      }
    } else {
      set({ currentFrame: next });
    }
    return wrapped;
  },

  // ── Track management ─────────────────────────────────────────────────────

  addTrack: (property, name, category, lightId) => {
    history.record('Add Track');
    const track = createTrack(property, name, category, { lightId: lightId ?? null });
    set((s) => ({
      tracks: [...s.tracks, track],
      selectedTrackId: track.id,
    }));
    return track.id;
  },

  removeTrack: (trackId) => {
    history.record('Delete Track');
    set((s) => ({
      tracks: s.tracks.filter((t) => t.id !== trackId),
      selectedTrackId: s.selectedTrackId === trackId ? null : s.selectedTrackId,
      selectedKeyframeId:
        s.selectedKeyframeId && !s.tracks.find((t) => t.id === trackId)?.keyframes.some((k) => k.id === s.selectedKeyframeId)
          ? null
          : s.selectedKeyframeId,
    }));
  },

  duplicateTrack: (trackId) => {
    history.record('Duplicate Track');
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track) return null;
    const newTrack: AnimationTrack = {
      ...createTrack(track.property, `${track.name} (copy)`, track.category, {
        lightId: track.lightId,
        color: track.color,
      }),
      keyframes: track.keyframes.map((kf) => ({
        ...createKeyframe(kf.frame, kf.value, kf.easing),
      })),
    };
    set((s) => ({
      tracks: [...s.tracks, newTrack],
      selectedTrackId: newTrack.id,
    }));
    return newTrack.id;
  },

  toggleTrackMute: (trackId) => {
    history.record('Toggle Track Mute');
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, muted: !t.muted } : t,
      ),
    }));
  },

  toggleTrackVisible: (trackId) => {
    history.record('Toggle Track Visibility');
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, visible: !t.visible } : t,
      ),
    }));
  },

  selectTrack: (trackId) => {
    // Selection is NOT recorded
    set({ selectedTrackId: trackId, selectedKeyframeId: null });
  },

  reorderTrack: (fromIndex, toIndex) => {
    history.record('Reorder Tracks');
    set((s) => {
      const newTracks = [...s.tracks];
      const [removed] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, removed);
      return { tracks: newTracks };
    });
  },

  // ── Keyframe management ──────────────────────────────────────────────────

  addKeyframe: (trackId, frame, value, easing) => {
    history.record('Add Keyframe');
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const kf = createKeyframe(frame, value, easing ?? 'linear');
        return { ...t, keyframes: [...t.keyframes, kf].sort((a, b) => a.frame - b.frame) };
      }),
      selectedKeyframeId: null,
    }));
  },

  removeKeyframe: (trackId, keyframeId) => {
    history.record('Delete Keyframe');
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyframeId) };
      }),
      selectedKeyframeId: s.selectedKeyframeId === keyframeId ? null : s.selectedKeyframeId,
    }));
  },

  updateKeyframe: (trackId, keyframeId, updates) => {
    history.recordThrottled('Update Keyframe');
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          keyframes: t.keyframes
            .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
            .sort((a, b) => a.frame - b.frame),
        };
      }),
    }));
  },

  moveKeyframe: (trackId, keyframeId, newFrame) => {
    history.record('Move Keyframe');
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          keyframes: t.keyframes
            .map((k) => (k.id === keyframeId ? { ...k, frame: Math.round(newFrame) } : k))
            .sort((a, b) => a.frame - b.frame),
        };
      }),
    }));
  },

  selectKeyframe: (keyframeId) => {
    // Selection is NOT recorded
    set({ selectedKeyframeId: keyframeId });
  },

  // ── Bulk operations ──────────────────────────────────────────────────────

  clearAllTracks: () => {
    history.record('Clear All Tracks');
    set({
      tracks: [],
      selectedTrackId: null,
      selectedKeyframeId: null,
      isPlaying: false,
      currentFrame: 0,
    });
  },

  clearTrackKeyframes: (trackId) => {
    history.record('Clear Track Keyframes');
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, keyframes: [] } : t,
      ),
      selectedKeyframeId: null,
    }));
  },

  // ── Serialization ────────────────────────────────────────────────────────

  exportAnimation: () => {
    const { tracks, currentFrame, frameStart, frameEnd, fps, isLooping, snapToFrame } = get();
    return {
      tracks: JSON.parse(JSON.stringify(tracks)),
      currentFrame,
      frameStart,
      frameEnd,
      fps,
      isLooping,
      snapToFrame,
      isPlaying: false,
      selectedKeyframeId: null,
      selectedTrackId: null,
      expanded: true,
    };
  },

  importAnimation: (state) => {
    // Scene import — do NOT record (called by undo/redo or file open)
    set({
      ...DEFAULT_ANIMATION_STATE,
      tracks: state.tracks,
      frameStart: state.frameStart,
      frameEnd: state.frameEnd,
      fps: state.fps,
      isLooping: state.isLooping,
      snapToFrame: state.snapToFrame,
      currentFrame: state.frameStart,
    });
  },
}));