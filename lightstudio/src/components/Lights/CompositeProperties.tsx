import React from 'react';
import { useLightsStore } from '../../store/lightsStore';
import { defaultComposite } from '../../types/Composite';
import { BLEND_LABELS } from '../../appearance/types';
import { BLEND_MODE_LIST } from '../../appearance/presets';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { Dropdown } from '../UI/Dropdown';
import { FilterStackEditor } from '../Filters/FilterStackEditor';

/**
 * Properties of a Composite light: the group of lights behaves like one light with shared
 * brightness, rotation, position and blend mode, and Filters (Diffusion, Motion Blur, Reflection)
 * act on the whole group as one image.
 */
export const CompositeProperties: React.FC = () => {
  const id = useLightsStore((s) => s.selectedCompositeId);
  const collections = useLightsStore((s) => s.collections);
  const lights = useLightsStore((s) => s.lights);
  const setComposite = useLightsStore((s) => s.setComposite);
  const rename = useLightsStore((s) => s.renameCollection);
  const release = useLightsStore((s) => s.releaseFromComposite);
  const dissolve = useLightsStore((s) => s.dissolveComposite);
  const selectLight = useLightsStore((s) => s.selectLight);

  const col = collections.find((c) => c.id === id);
  if (!col || !col.composite) return null;
  const c = { ...defaultComposite(), ...col.composite };
  const members = lights.filter((l) => l.collectionId === col.id);
  const set = (patch: Partial<typeof c>) => setComposite(col.id, patch);

  return (
    <div className="light-properties" style={{ flex: 1, overflowY: 'auto' }}>
      <div className="props-section">
        <div className="section-header">Composite Light</div>
        <div className="field-row" style={{ marginBottom: 6 }}>
          <span className="field-label">Name</span>
          <input className="field-input" value={col.name} onChange={(e) => rename(col.id, e.target.value)} />
        </div>
        <Slider label="Brightness" value={c.brightness} min={0} max={400} step={1} unit="%" onChange={(v) => set({ brightness: v })} />
        <Slider label="Opacity" value={c.opacity} min={0} max={200} step={1} unit="%" onChange={(v) => set({ opacity: v })} />
        <Dropdown
          label="Blend mode"
          value={c.blend ?? 'normal'}
          options={BLEND_MODE_LIST.map((b) => ({ value: b, label: BLEND_LABELS[b] }))}
          onChange={(v) => set({ blend: v as typeof c.blend })}
        />
        <Slider label="Rotation (longitude)" value={c.yaw} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ yaw: v })} />
        <Slider label="Tilt (latitude)" value={c.pitch} min={-80} max={80} step={1} unit="°" onChange={(v) => set({ pitch: v })} />
        <Slider label="Distance" value={c.distance} min={0.25} max={3} step={0.01} unit="x" onChange={(v) => set({ distance: v })} />
        <Toggle label="Visible" checked={c.visible} variant="glossy" onChange={(v) => set({ visible: v })} />
      </div>

      <div className="props-section">
        <div className="section-header">Filters</div>
        <FilterStackEditor spherical filters={c.filters} onChange={(f) => set({ filters: f })} />
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
          Filters are applied live to the composite as one image, whatever you do to the lights inside it.
        </div>
      </div>

      <div className="props-section">
        <div className="section-header">Lights in this composite ({members.length})</div>
        {members.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span style={{ flex: 1, fontSize: 11, cursor: 'pointer' }} onClick={() => selectLight(l.id)} title="Edit this light">{l.name}</span>
            <button className="btn-sm" onClick={() => release(l.id)} title="Move this light back to the main list">Release</button>
          </div>
        ))}
        <button className="btn-sm" style={{ marginTop: 6 }} onClick={() => dissolve(col.id)}>Release all &amp; remove composite</button>
      </div>
    </div>
  );
};
