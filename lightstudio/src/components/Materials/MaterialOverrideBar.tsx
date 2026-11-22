import React from 'react';
import { useMaterialOverrideStore, OVERRIDE_PRESETS } from '../../store/materialOverrideStore';
import type { OverridePreset } from '../../store/materialOverrideStore';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 };
const lab: React.CSSProperties = { fontSize: 9, color: 'var(--text-dim)', width: 62, flexShrink: 0 };

/** The Material Override switch and its look, shown at the top of the Material panel. */
export const MaterialOverrideBar: React.FC = () => {
  const o = useMaterialOverrideStore();
  return (
    <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', background: o.enabled ? 'rgba(224,166,75,0.08)' : undefined }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Shows one temporary material on the model so you can judge its reflections. Untick it to get the original material slots back.">
        <input type="checkbox" checked={o.enabled} onChange={(e) => o.set({ enabled: e.target.checked })} />
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4 }}>Material Override</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto' }}>{o.enabled ? 'temporary' : 'original materials'}</span>
      </label>
      {o.enabled && (
        <>
          <div style={row}>
            <span style={lab}>Look</span>
            <select className="input" style={{ flex: 1, fontSize: 10 }} value={o.preset} onChange={(e) => o.setPreset(e.target.value as OverridePreset)}>
              {(Object.keys(OVERRIDE_PRESETS) as (keyof typeof OVERRIDE_PRESETS)[]).map((k) => <option key={k} value={k}>{OVERRIDE_PRESETS[k].label}</option>)}
              <option value="custom">Custom</option>
            </select>
          </div>
          <div style={row}>
            <span style={lab}>Apply to</span>
            <select className="input" style={{ flex: 1, fontSize: 10 }} value={o.scope} onChange={(e) => o.set({ scope: e.target.value as 'all' | 'selected' })}>
              <option value="all">Whole model</option>
              <option value="selected">Selected object / group</option>
            </select>
          </div>
          <div style={row}>
            <span style={lab}>Colour</span>
            <input type="color" value={o.color} onChange={(e) => o.set({ color: e.target.value, preset: 'custom' })} style={{ width: 32, height: 18, padding: 0, border: '1px solid var(--border)', borderRadius: 3 }} />
          </div>
          {([['Metallic', 'metalness'], ['Roughness', 'roughness'], ['Clearcoat', 'clearcoat']] as const).map(([name, key]) => (
            <div key={key} style={row}>
              <span style={lab}>{name}</span>
              <input type="range" min={0} max={1} step={0.01} value={o[key]} style={{ flex: 1 }} onChange={(e) => o.set({ [key]: parseFloat(e.target.value), preset: 'custom' })} />
              <span style={{ fontSize: 9, width: 28, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{o[key].toFixed(2)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
};
