import React from 'react';
import type { GizmoMode } from '../../three/GizmoManager';

interface GizmoToolbarProps {
  mode: GizmoMode;
  onModeChange: (mode: GizmoMode) => void;
  /** Scale is meaningless for point/spot lights - greyed out when false. */
  scaleAllowed: boolean;
  /** Nothing selected: the whole bar is inert. */
  disabled: boolean;
  /** LightPaint: drag on the model to place the light by reflection. */
  paintActive: boolean;
  onPaintToggle: () => void;
}

const TOOLS: Array<{ mode: Exclude<GizmoMode, null>; label: string; key: string; icon: string }> = [
  { mode: 'translate', label: 'Move', key: 'W', icon: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3' },
  { mode: 'rotate', label: 'Rotate', key: 'E', icon: 'M12 4a8 8 0 1 1-5.66 2.34M6 3v4h4' },
  { mode: 'scale', label: 'Scale', key: 'R', icon: 'M4 20L20 4M20 4h-6M20 4v6M4 20h6M4 20v-6' },
];

export const GizmoToolbar: React.FC<GizmoToolbarProps> = ({
  mode,
  onModeChange,
  scaleAllowed,
  disabled,
  paintActive,
  onPaintToggle,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: 4,
        background: 'rgba(20, 20, 26, 0.85)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        backdropFilter: 'blur(6px)',
        zIndex: 20,
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {TOOLS.map((tool) => {
        const isActive = mode === tool.mode;
        const isDisabled = tool.mode === 'scale' && !scaleAllowed;

        return (
          <button
            key={tool.mode}
            title={tool.label + ' (' + tool.key + ')'}
            disabled={isDisabled}
            onClick={() => onModeChange(isActive ? null : tool.mode)}
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isActive ? 'var(--accent)' : 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: isDisabled ? 'default' : 'pointer',
              opacity: isDisabled ? 0.3 : 1,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isActive ? '#fff' : 'var(--text-sec)'}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={tool.icon} />
            </svg>
          </button>
        );
      })}

      <div style={{ height: 1, background: 'var(--border)', margin: '2px 4px' }} />

      {/* LightPaint - drag across the model and the light follows the reflection */}
      <button
        title="LightPaint (T) - drag on the model to aim the reflection"
        onClick={onPaintToggle}
        style={{
          width: 30,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: paintActive ? 'var(--accent)' : 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={paintActive ? '#fff' : 'var(--text-sec)'}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" />
          <circle cx="18" cy="18" r="2.5" />
        </svg>
      </button>
    </div>
  );
};
