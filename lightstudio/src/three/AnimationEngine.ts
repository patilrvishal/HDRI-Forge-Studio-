import type { AnimationTrack, AnimatedProperty } from '../types/Animation';
import { applyEasing } from '../types/Animation';

// ── Evaluation result: a map of property → interpolated value ───────────────

export interface EvaluatedFrame {
  values: Map<AnimatedProperty, number>;
  /** Any tracks that had no keyframes or were out of range → property is absent */
}

// ── Animation Engine ────────────────────────────────────────────────────────

export class AnimationEngine {
  private _lastEvaluatedFrame = -1;
  private _cachedResult: EvaluatedFrame = { values: new Map() };

  /**
   * Evaluate all non-muted, visible tracks at a given frame number.
   * Returns a Map of property → interpolated value.
   */
  evaluate(tracks: AnimationTrack[], frame: number): EvaluatedFrame {
    // Use cached result if the frame hasn't changed
    if (frame === this._lastEvaluatedFrame && this._cachedResult) {
      return this._cachedResult;
    }

    const values = new Map<AnimatedProperty, number>();

    for (const track of tracks) {
      // Skip muted or invisible tracks
      if (track.muted || !track.visible) continue;
      if (track.keyframes.length === 0) continue;

      const value = this.interpolateTrack(track.keyframes, frame);
      if (value !== null) {
        values.set(track.property, value);
      }
    }

    this._lastEvaluatedFrame = frame;
    this._cachedResult = { values };
    return this._cachedResult;
  }

  /**
   * Interpolate a single track's keyframes at a given frame.
   * Returns null if the frame is before the first or after the last keyframe
   * (hold behavior: clamp to nearest keyframe value instead).
   */
  private interpolateTrack(keyframes: readonly { frame: number; value: number; easing: string }[], frame: number): number | null {
    if (keyframes.length === 0) return null;
    if (keyframes.length === 1) return keyframes[0].value;

    // Before first keyframe: hold at first value
    if (frame <= keyframes[0].frame) {
      return keyframes[0].value;
    }

    // After last keyframe: hold at last value
    if (frame >= keyframes[keyframes.length - 1].frame) {
      return keyframes[keyframes.length - 1].value;
    }

    // Find the two keyframes bracketing the current frame
    for (let i = 0; i < keyframes.length - 1; i++) {
      const kfA = keyframes[i];
      const kfB = keyframes[i + 1];

      if (frame >= kfA.frame && frame <= kfB.frame) {
        // If both keyframes are on the same frame, return the second one
        if (kfB.frame === kfA.frame) return kfB.value;

        // Compute local t in [0, 1]
        const t = (frame - kfA.frame) / (kfB.frame - kfA.frame);
        // Apply the easing of the outgoing keyframe (kfA)
        const easedT = applyEasing(t, kfA.easing as import('../types/Animation').EasingType);

        // Linear interpolation with eased t
        return kfA.value + (kfB.value - kfA.value) * easedT;
      }
    }

    // Fallback (should not reach here)
    return keyframes[keyframes.length - 1].value;
  }

  /**
   * Apply evaluated animation values to a scene state updater callback.
   * This is the bridge between the engine and the stores.
   */
  static applyToScene(
    evaluated: EvaluatedFrame,
    callbacks: {
      updateLightProperty: (lightId: string, property: string, value: number) => void;
      updateCameraProperty: (property: string, value: number) => void;
      updateTurntableProperty: (property: string, value: number) => void;
      updateRenderProperty: (property: string, value: number) => void;
    },
    tracks: AnimationTrack[],
  ): void {
    const { values } = evaluated;

    for (const track of tracks) {
      const value = values.get(track.property);
      if (value === undefined) continue;

      switch (track.category) {
        case 'light':
          if (track.lightId) {
            callbacks.updateLightProperty(track.lightId, track.property, value);
          }
          break;
        case 'camera':
          callbacks.updateCameraProperty(track.property, value);
          break;
        case 'turntable':
          callbacks.updateTurntableProperty(track.property, value);
          break;
        case 'render':
          callbacks.updateRenderProperty(track.property, value);
          break;
      }
    }
  }

  /**
   * Invalidate the cache (call when tracks change structurally).
   */
  invalidateCache(): void {
    this._lastEvaluatedFrame = -1;
    this._cachedResult = { values: new Map() };
  }
}

// Singleton instance for the app
export const animationEngine = new AnimationEngine();