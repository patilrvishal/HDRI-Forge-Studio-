import React, { useMemo, useState } from 'react';
import { useHDRIShapesStore } from '../../store/hdriShapesStore';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { ColorPicker } from '../UI/ColorPicker';

/** Matches LightProperties' CollapsibleSection so both panels read as one system. */
const CollapsibleSection: React.FC<{
  title: string;
  headerRight?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, headerRight, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="props-section">
      <div
        className="section-header"
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="currentColor"
          style={{
            flexShrink: 0,
            opacity: 0.65,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path d="M2 0l4 4-4 4z" />
        </svg>
        <span style={{ flex: 1 }}>{title}</span>
        {headerRight && (
          <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
            {headerRight}
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
};

const TYPE_LABELS: Record<string, string> = {
  rectangle: 'Rectangle',
  circle: 'Circle',
  'gradient-strip': 'Gradient Strip',
};

export const HDRIShapeProperties: React.FC = () => {
  const selectedShapeId = useHDRIShapesStore((s) => s.selectedShapeId);
  const shapes = useHDRIShapesStore((s) => s.shapes);
  const updateShape = useHDRIShapesStore((s) => s.updateShape);

  const shape = useMemo(
    () => shapes.find((s) => s.id === selectedShapeId) ?? null,
    [shapes, selectedShapeId],
  );

  if (!shape) return null;

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <CollapsibleSection
        title={`${TYPE_LABELS[shape.type] ?? shape.type} · HDRI Shape`}
        headerRight={
          <Toggle checked={shape.visible} onChange={(v) => updateShape(shape.id, { visible: v })} />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-sec)' }}>Name</span>
            <input
              className="field-input"
              value={shape.name}
              onChange={(e) => updateShape(shape.id, { name: e.target.value })}
              style={{ width: 130, fontSize: 11 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-sec)' }}>Color</span>
            <ColorPicker color={shape.color} onChange={(c) => updateShape(shape.id, { color: c })} />
          </div>

          <Slider
            label="Opacity"
            value={shape.opacity}
            min={0}
            max={200}
            step={1}
            unit="%"
            onChange={(v) => updateShape(shape.id, { opacity: v })}
          />
          <Slider
            label="Softness"
            value={shape.softness}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateShape(shape.id, { softness: v })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Transform">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider
            label="Position X (U)"
            value={shape.u}
            min={0}
            max={1}
            step={0.001}
            onChange={(v) => updateShape(shape.id, { u: v })}
          />
          <Slider
            label="Position Y (V)"
            value={shape.v}
            min={0}
            max={1}
            step={0.001}
            onChange={(v) => updateShape(shape.id, { v: v })}
          />
          <Slider
            label="Scale X (Width)"
            value={shape.width}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => updateShape(shape.id, { width: v })}
          />
          <Slider
            label="Scale Y (Height)"
            value={shape.height}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => updateShape(shape.id, { height: v })}
          />
          {shape.type !== 'circle' && (
            <Slider
              label="Rotation"
              value={shape.rotation}
              min={0}
              max={360}
              step={1}
              unit="°"
              onChange={(v) => updateShape(shape.id, { rotation: v })}
            />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Drop Shadow"
        defaultOpen={false}
        headerRight={
          <Toggle
            checked={shape.dropShadow.enabled}
            onChange={(v) => updateShape(shape.id, { dropShadow: { ...shape.dropShadow, enabled: v } })}
          />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0', opacity: shape.dropShadow.enabled ? 1 : 0.4 }}>
          <Slider
            label="Angle"
            value={shape.dropShadow.angle}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={(v) => updateShape(shape.id, { dropShadow: { ...shape.dropShadow, angle: v } })}
          />
          <Slider
            label="Distance"
            value={shape.dropShadow.distance}
            min={0}
            max={200}
            step={1}
            unit="%"
            onChange={(v) => updateShape(shape.id, { dropShadow: { ...shape.dropShadow, distance: v } })}
          />
          <Slider
            label="Intensity"
            value={shape.dropShadow.intensity}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateShape(shape.id, { dropShadow: { ...shape.dropShadow, intensity: v } })}
          />
          <Slider
            label="Softness"
            value={shape.dropShadow.softness}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateShape(shape.id, { dropShadow: { ...shape.dropShadow, softness: v } })}
          />
        </div>
      </CollapsibleSection>

      <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, padding: '4px 10px 10px' }}>
        Tip: drag directly on the HDRI Preview canvas to reposition this shape.
      </div>
    </div>
  );
};
