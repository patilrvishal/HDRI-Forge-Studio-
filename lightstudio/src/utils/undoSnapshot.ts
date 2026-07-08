/**
 * Undo/Redo snapshot capture and restore utilities.
 *
 * Captures lightweight snapshots of the three mutable stores:
 *   - lightsStore  (light array + selection)
 *   - sceneStore   (render settings, environment, grid, turntable)
 *   - animationStore (tracks, keyframes, frame range)
 *
 * Uses structuredClone for deep-copy safety.
 */

import { useLightsStore } from '../store/lightsStore';
import { useSceneStore } from '../store/sceneStore';
import { useAnimationStore } from '../store/animationStore';

// ── Snapshot shape ──────────────────────────────────────────────────────────

export interface UndoSnapshot {
  /** Timestamp (ms) for display ordering */
  timestamp: number;
  /** Human-readable label shown in the Edit menu (e.g. "Add Light") */
  label: string;
  /** Serialized lights state */
  lights: {
    lights: ReturnType<typeof useLightsStore.getState>['lights'];
    selectedLightId: string | null;
  };
  /** Serialized scene state (only the mutable parts) */
  scene: {
    renderSettings: ReturnType<typeof useSceneStore.getState>['renderSettings'];
    environment: ReturnType<typeof useSceneStore.getState>['environment'];
    showGrid: boolean;
    turntable: { active: boolean; speed: number };
  };
  /** Serialized animation state */
  animation: {
    tracks: ReturnType<typeof useAnimationStore.getState>['tracks'];
    frameStart: number;
    frameEnd: number;
    fps: number;
    isLooping: boolean;
    snapToFrame: boolean;
  };
}

// ── Capture ────────────────────────────────────────────────────────────────

/**
 * Capture the current state of all tracked stores into an UndoSnapshot.
 * Called *before* a mutation so we can restore to this point on undo.
 */
export function captureSnapshot(label: string): UndoSnapshot {
  const lightsState = useLightsStore.getState();
  const sceneState = useSceneStore.getState();
  const animState = useAnimationStore.getState();

  return {
    timestamp: Date.now(),
    label,
    lights: {
      lights: structuredClone(lightsState.lights),
      selectedLightId: lightsState.selectedLightId,
    },
    scene: {
      renderSettings: structuredClone(sceneState.renderSettings),
      environment: structuredClone(sceneState.environment),
      showGrid: sceneState.showGrid,
      turntable: { ...sceneState.turntable },
    },
    animation: {
      tracks: structuredClone(animState.tracks),
      frameStart: animState.frameStart,
      frameEnd: animState.frameEnd,
      fps: animState.fps,
      isLooping: animState.isLooping,
      snapToFrame: animState.snapToFrame,
    },
  };
}

// ── Restore ────────────────────────────────────────────────────────────────

/**
 * Restore all tracked stores from an UndoSnapshot.
 */
export function restoreSnapshot(snapshot: UndoSnapshot): void {
  // ── Restore lights ─────────────────────────────────────────────────────
  const lightsState = snapshot.lights;
  useLightsStore.setState({
    lights: structuredClone(lightsState.lights),
    selectedLightId: lightsState.selectedLightId,
  });

  // ── Restore scene settings ────────────────────────────────────────────
  const sceneState = snapshot.scene;
  useSceneStore.setState({
    renderSettings: structuredClone(sceneState.renderSettings),
    environment: structuredClone(sceneState.environment),
    showGrid: sceneState.showGrid,
    turntable: { ...sceneState.turntable },
  });

  // ── Restore animation ─────────────────────────────────────────────────
  const animState = snapshot.animation;
  useAnimationStore.setState({
    tracks: structuredClone(animState.tracks),
    frameStart: animState.frameStart,
    frameEnd: animState.frameEnd,
    fps: animState.fps,
    isLooping: animState.isLooping,
    snapToFrame: animState.snapToFrame,
    // Keep playback and selection state as-is (don't resume playing on undo)
    isPlaying: false,
  });
}