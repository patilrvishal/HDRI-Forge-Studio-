import React, { useCallback } from 'react';
import { useAnimationStore } from '../../store/animationStore';
import type { AnimationTrack, Keyframe, EasingType } from '../../types/Animation';

const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeInQuad', label: 'In Quad' },
  { value: 'easeOutQuad', label: 'Out Quad' },
  { value: 'easeInOutQuad', label: 'In/Out Quad' },
  { value: 'easeInCubic', label: 'In Cubic' },
  { value: 'easeOutCubic', label: 'Out Cubic' },
  { value: 'easeInOutCubic', label: 'In/Out Cubic' },
  { value: 'easeInExpo', label: 'In Expo' },
  { value: 'easeOutExpo', label: 'Out Expo' },
  { value: 'easeInOutExpo', label: 'In/Out Expo' },
  { value: 'easeInBack', label: 'In Back' },
  { value: 'easeOutBack', label: 'Out Back' },
  { value: 'easeInOutBack', label: 'In/Out Back' },
];

interface KeyframeEditorProps {
  track: AnimationTrack;
  keyframe: Keyframe;
}

export const KeyframeEditor: React.FC<KeyframeEditorProps> = ({ track, keyframe }) => {
  const updateKeyframe = useAnimationStore((s) => s.updateKeyframe);
  const removeKeyframe = useAnimationStore((s) => s.removeKeyframe);
  const selectKeyframe = useAnimationStore((s) => s.selectKeyframe);
  const setCurrentFrame = useAnimationStore((s) => s.setCurrentFrame);

  const handleFrameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 0) {
        updateKeyframe(track.id, keyframe.id, { frame: v });
      }
    },
    [track.id, keyframe.id, updateKeyframe],
  );

  const handleValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        updateKeyframe(track.id, keyframe.id, { value: v });
      }
    },
    [track.id, keyframe.id, updateKeyframe],
  );

  const handleEasingChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateKeyframe(track.id, keyframe.id, {
        easing: e.target.value as EasingType,
      });
    },
    [track.id, keyframe.id, updateKeyframe],
  );

  const handleDelete = useCallback(() => {
    removeKeyframe(track.id, keyframe.id);
    selectKeyframe(null);
  }, [track.id, keyframe.id, removeKeyframe, selectKeyframe]);

  const handleGoToFrame = useCallback(() => {
    setCurrentFrame(keyframe.frame);
  }, [keyframe.frame, setCurrentFrame]);

  return (
    <div className="kf-editor">
      <div className="kf-editor-left">
        <span className="kf-editor-label">
          <span
            className="tl-track-color-dot"
            style={{ background: track.color, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}
          />
          {track.name}
        </span>
      </div>

      <div className="kf-editor-fields">
        {/* Frame */}
        <div className="kf-field">
          <label>Frame</label>
          <input
            type="number"
            className="kf-input"
            value={keyframe.frame}
            onChange={handleFrameChange}
            min={0}
          />
        </div>

        {/* Value */}
        <div className="kf-field">
          <label>Value</label>
          <input
            type="number"
            className="kf-input"
            value={keyframe.value}
            onChange={handleValueChange}
            step={0.01}
          />
        </div>

        {/* Easing */}
        <div className="kf-field">
          <label>Easing</label>
          <select
            className="kf-select"
            value={keyframe.easing}
            onChange={handleEasingChange}
          >
            {EASING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Value range slider */}
        <div className="kf-field kf-field-wide">
          <label>Value</label>
          <input
            type="range"
            min={-10}
            max={1000}
            step={0.1}
            value={keyframe.value}
            onChange={(e) => {
              updateKeyframe(track.id, keyframe.id, { value: parseFloat(e.target.value) });
            }}
          />
        </div>
      </div>

      <div className="kf-editor-actions">
        <button
          className="btn-sm"
          onClick={handleGoToFrame}
          title="Go to this frame"
        >
          Go
        </button>
        <button
          className="btn-sm"
          onClick={handleDelete}
          title="Delete keyframe"
          style={{ color: 'var(--danger)' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
        <button
          className="btn-sm"
          onClick={() => selectKeyframe(null)}
          title="Close editor"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1l8 8M9 1L1 9" />
          </svg>
        </button>
      </div>
    </div>
  );
};