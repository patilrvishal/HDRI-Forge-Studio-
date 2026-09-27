import React, { useState } from 'react';
import { defaultDiffusion, defaultMotion, type FilterSpec, type FilterParams } from '../../filters/filters';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { Dropdown } from '../UI/Dropdown';
import { ImagePicker } from '../Appearance/AppearanceEditor';

const newId = () => 'flt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

interface Props {
  filters: FilterSpec[] | undefined;
  onChange: (f: FilterSpec[]) => void;
  /** True when the target is an equirectangular HDRI (unit labels change). */
  spherical?: boolean;
}

/**
 * Stack of Diffusion / Motion blur filters. The same editor drives light textures
 * (planar) and HDRI maps (spherical).
 */
export const FilterStackEditor: React.FC<Props> = ({ filters = [], onChange, spherical }) => {
  const [addType, setAddType] = useState<'diffusion' | 'motion'>('diffusion');
  const update = (i: number, patch: Partial<FilterSpec>) => onChange(filters.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const setParams = (i: number, p: Partial<FilterParams>) => update(i, { params: { ...filters[i].params, ...p } as FilterParams });

  return (
    <div>
      {filters.map((f, i) => {
        const p = f.params;
        return (
          <div key={f.id} style={{ border: '1px solid var(--border, #3a3a3a)', borderRadius: 6, padding: 6, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Toggle checked={f.enabled} onChange={(v) => update(i, { enabled: v })} />
              <span style={{ flex: 1, fontSize: 11 }}>{p.type === 'diffusion' ? 'Diffusion Blur' : 'Motion Blur'}</span>
              <button className="btn-sm" title="Move up" disabled={i === 0} onClick={() => { const a = [...filters]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>↑</button>
              <button className="btn-sm" title="Remove" onClick={() => onChange(filters.filter((_, k) => k !== i))}>✕</button>
            </div>
            <div style={{ opacity: f.enabled ? 1 : 0.5, marginTop: 4 }}>
              {p.type === 'diffusion' ? (
                <>
                  <Slider label="Amount" value={p.amount} min={0} max={100} step={0.5} unit="%" onChange={(v) => setParams(i, { amount: v })} />
                  <Toggle label="Energy conserving" checked={p.energy} variant="glossy" onChange={(v) => setParams(i, { energy: v })} />
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', margin: '2px 0' }}>
                    {spherical ? 'Spherical: blurs across the HDRI sphere, pole-aware, keeping the total light constant.' : 'Planar: softens the light texture like tracing paper, keeping the total light constant.'}
                  </div>
                </>
              ) : (
                <>
                  <Dropdown label="Mode" value={p.mode} options={[{ value: 'linear', label: 'Linear' }, { value: 'advanced', label: 'Advanced' }]} onChange={(v) => setParams(i, { mode: v as 'linear' | 'advanced' })} />
                  <Slider label="Angle" value={p.angle} min={-180} max={180} step={1} unit="°" onChange={(v) => setParams(i, { angle: v })} />
                  <Slider label="Length" value={p.length} min={0} max={100} step={0.5} unit="%" onChange={(v) => setParams(i, { length: v })} />
                  <Slider label="Samples" value={p.samples} min={8} max={128} step={4} onChange={(v) => setParams(i, { samples: v })} />
                  {p.mode === 'advanced' && (
                    <>
                      <Slider label="Curve" value={p.curve} min={-100} max={100} step={1} onChange={(v) => setParams(i, { curve: v })} />
                      <Slider label="Tilt" value={p.tilt} min={-90} max={90} step={1} unit="°" onChange={(v) => setParams(i, { tilt: v })} />
                      <Slider label="Noise" value={p.noise} min={0} max={100} step={1} unit="%" onChange={(v) => setParams(i, { noise: v })} />
                      <ImagePicker label="Speed map" value={p.speedImageId ?? null} onChange={(id) => setParams(i, { speedImageId: id, speedMap: null })} />
                      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>The brightness of the speed map scales the streak length at each point (white = full length, black = none).</div>
                    </>
                  )}
                  <Toggle label="Energy conserving" checked={p.energy} variant="glossy" onChange={(v) => setParams(i, { energy: v })} />
                </>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Dropdown value={addType} options={[{ value: 'diffusion', label: 'Diffusion Blur' }, { value: 'motion', label: 'Motion Blur' }]} onChange={(v) => setAddType(v as 'diffusion' | 'motion')} />
        <button
          className="btn-sm"
          onClick={() => onChange([...filters, { id: newId(), enabled: true, params: addType === 'diffusion' ? defaultDiffusion() : defaultMotion() }])}
        >
          + Add filter
        </button>
      </div>
    </div>
  );
};
