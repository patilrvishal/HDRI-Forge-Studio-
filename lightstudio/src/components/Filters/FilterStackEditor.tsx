import React, { useState } from 'react';
import {
  defaultDiffusion,
  defaultMotion,
  defaultMotionAdvanced,
  defaultReflection,
  type FilterSpec,
  type FilterParams,
} from '../../filters/filters';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { Dropdown } from '../UI/Dropdown';
import { ImagePicker } from '../Appearance/AppearanceEditor';

const newId = () => 'flt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

type AddKind = 'diffusion' | 'motion' | 'motionAdvanced' | 'reflection';
const KIND_LABEL: Record<AddKind, string> = {
  diffusion: 'Diffusion Blur',
  motion: 'Motion Blur',
  motionAdvanced: 'Motion Blur (Advanced)',
  reflection: 'Reflection',
};

const ACCURACY = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }];

function labelOf(p: FilterParams): string {
  if (p.type === 'diffusion') return KIND_LABEL.diffusion;
  if (p.type === 'reflection') return KIND_LABEL.reflection;
  return p.mode === 'advanced' ? KIND_LABEL.motionAdvanced : KIND_LABEL.motion;
}

interface Props {
  filters: FilterSpec[] | undefined;
  onChange: (f: FilterSpec[]) => void;
  /** True when the target is an equirectangular HDRI (Spherical filters); false for light textures (Planar). */
  spherical?: boolean;
}

/**
 * Filter stack: Diffusion Blur, Motion Blur, Motion Blur (Advanced) and Reflection. The same editor
 * drives light textures (planar) and HDRI maps / composites (spherical).
 */
export const FilterStackEditor: React.FC<Props> = ({ filters = [], onChange, spherical }) => {
  const [addKind, setAddKind] = useState<AddKind>('diffusion');
  const update = (i: number, patch: Partial<FilterSpec>) => onChange(filters.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setParams = (i: number, p: Record<string, any>) => update(i, { params: { ...filters[i].params, ...p } as FilterParams });

  return (
    <div>
      {filters.map((f, i) => {
        const p = f.params;
        return (
          <div key={f.id} style={{ border: '1px solid var(--border, #3a3a3a)', borderRadius: 6, padding: 6, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Toggle checked={f.enabled} onChange={(v) => update(i, { enabled: v })} />
              <span style={{ flex: 1, fontSize: 11 }}>{labelOf(p)} <span style={{ color: 'var(--text-dim)' }}>({spherical ? 'Spherical' : 'Planar'})</span></span>
              <button className="btn-sm" title="Move up" disabled={i === 0} onClick={() => { const a = [...filters]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>↑</button>
              <button className="btn-sm" title="Remove" onClick={() => onChange(filters.filter((_, k) => k !== i))}>✕</button>
            </div>
            <div style={{ opacity: f.enabled ? 1 : 0.5, marginTop: 4 }}>
              {p.type === 'diffusion' && (
                <>
                  <Slider label="Percentage" value={p.amount} min={0} max={100} step={0.5} unit="%" onChange={(v) => setParams(i, { amount: v })} />
                  <Dropdown label="Accuracy" value={p.accuracy} options={ACCURACY} onChange={(v) => setParams(i, { accuracy: v })} />
                  {!spherical && <Toggle label="Scale to fit" checked={p.scaleToFit} variant="glossy" onChange={(v) => setParams(i, { scaleToFit: v })} />}
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', margin: '2px 0' }}>
                    Energy conserving: the amount of light stays the same as the blur increases.
                  </div>
                </>
              )}
              {p.type === 'motion' && (
                <>
                  {spherical ? (
                    <>
                      <Slider label="U direction" value={p.u} min={-1} max={1} step={0.01} onChange={(v) => setParams(i, { u: v })} />
                      <Slider label="V direction" value={p.v} min={-1} max={1} step={0.01} onChange={(v) => setParams(i, { v })} />
                    </>
                  ) : (
                    <Slider label="Blur angle" value={p.angle} min={-180} max={180} step={1} unit="°" onChange={(v) => setParams(i, { angle: v })} />
                  )}
                  <Slider label="Blur length" value={p.length} min={0} max={100} step={0.5} unit="%" onChange={(v) => setParams(i, { length: v })} />
                  {spherical && <Slider label="Bias" value={p.bias} min={1} max={8} step={0.05} onChange={(v) => setParams(i, { bias: v })} />}
                  {!spherical && <Toggle label="Scale to fit" checked={p.scaleToFit} variant="glossy" onChange={(v) => setParams(i, { scaleToFit: v })} />}
                  <Dropdown label="Accuracy" value={p.accuracy} options={ACCURACY} onChange={(v) => setParams(i, { accuracy: v })} />
                  {p.mode === 'advanced' && (
                    <>
                      <Slider label="Curvature" value={p.curvature} min={0} max={2} step={0.01} onChange={(v) => setParams(i, { curvature: v })} />
                      <Slider label="Tilt" value={p.tilt} min={-180} max={180} step={1} unit="°" onChange={(v) => setParams(i, { tilt: v })} />
                      <div className="field-label" style={{ fontSize: 10, margin: '6px 0 2px' }}>Noise profile</div>
                      <Slider label="Spread" value={p.noise.spread} min={0.05} max={5} step={0.05} onChange={(v) => setParams(i, { noise: { ...p.noise, spread: v } })} />
                      <Slider label="Seed" value={p.noise.seed} min={0} max={100} step={1} onChange={(v) => setParams(i, { noise: { ...p.noise, seed: v } })} />
                      <Slider label="Amplitude" value={p.noise.amplitude} min={0} max={2} step={0.01} onChange={(v) => setParams(i, { noise: { ...p.noise, amplitude: v } })} />
                      <Toggle label="Ground clamp" checked={p.noise.groundClamp} variant="glossy" onChange={(v) => setParams(i, { noise: { ...p.noise, groundClamp: v } })} />
                      <ImagePicker label="Depth image" value={p.speedImageId ?? null} onChange={(id) => setParams(i, { speedImageId: id, speedMap: null })} />
                      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>Black pixels stay un-blurred, white pixels get the full blur.</div>
                    </>
                  )}
                </>
              )}
              {p.type === 'reflection' && (
                <>
                  <Slider label="Axis" value={p.axis} min={-180} max={180} step={1} unit="°" onChange={(v) => setParams(i, { axis: v })} />
                  {!spherical && <Slider label="Axis offset" value={p.offset} min={-1} max={1} step={0.01} onChange={(v) => setParams(i, { offset: v })} />}
                  <Dropdown label="Reflect" value={p.direction} options={[{ value: 'forward', label: 'Forward side → back' }, { value: 'backward', label: 'Back side → forward' }]} onChange={(v) => setParams(i, { direction: v })} />
                  <Slider label="Brightness" value={p.brightness} min={0} max={4} step={0.01} onChange={(v) => setParams(i, { brightness: v })} />
                  <Slider label="Alpha" value={p.alpha} min={0} max={1} step={0.01} onChange={(v) => setParams(i, { alpha: v })} />
                  <Slider label="Blend" value={p.blend} min={0} max={1} step={0.01} onChange={(v) => setParams(i, { blend: v })} />
                </>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Dropdown value={addKind} options={(Object.keys(KIND_LABEL) as AddKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(v) => setAddKind(v as AddKind)} />
        <button
          className="btn-sm"
          onClick={() => {
            const params = addKind === 'diffusion' ? defaultDiffusion() : addKind === 'motion' ? defaultMotion() : addKind === 'motionAdvanced' ? defaultMotionAdvanced() : defaultReflection();
            onChange([...filters, { id: newId(), enabled: true, params }]);
          }}
        >
          + Add filter
        </button>
      </div>
    </div>
  );
};
