import React, { useState } from 'react';
import type { Light } from '../../types/Light';
import { useLightsStore } from '../../store/lightsStore';
import { defaultComposite } from '../../types/Composite';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { Dropdown } from '../UI/Dropdown';
import { FilterStackEditor } from '../Filters/FilterStackEditor';
import { useUIStore } from '../../store/uiStore';

/** Group assignment + Composite controls: one set of controls for every light in the group. */
export const CompositeSection: React.FC<{ light: Light; onUpdate: (u: Partial<Light>) => void }> = ({ light, onUpdate }) => {
  const collections = useLightsStore((s) => s.collections);
  const lights = useLightsStore((s) => s.lights);
  const addCollection = useLightsStore((s) => s.addCollection);
  const setComposite = useLightsStore((s) => s.setComposite);
  const [open, setOpen] = useState(true);
  const col = collections.find((c) => c.id === light.collectionId) ?? null;
  const comp = col?.composite;
  const members = col ? lights.filter((l) => l.collectionId === col.id).length : 0;

  return (
    <div className="props-section">
      <div className="section-header" onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer', display: 'flex', gap: 6, userSelect: 'none' }}>
        <span style={{ opacity: 0.65, fontSize: 8 }}>{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1 }}>Group &amp; Composite</span>
      </div>
      {open && (
        <div>
          <Dropdown
            label="Group"
            value={light.collectionId ?? '__none__'}
            options={[{ value: '__none__', label: 'None' }, ...collections.map((c) => ({ value: c.id, label: c.composite?.enabled ? `${c.name} (composite)` : c.name }))]}
            onChange={(v) => onUpdate({ collectionId: v === '__none__' ? null : v })}
          />
          <button
            className="btn-sm"
            style={{ margin: '2px 0 6px' }}
            onClick={async () => {
              const name = await useUIStore.getState().requestPrompt('Name of the new group', 'Composite ' + (collections.length + 1));
              if (!name) return;
              addCollection(name);
              const created = useLightsStore.getState().collections.slice(-1)[0];
              if (created) onUpdate({ collectionId: created.id });
            }}
          >
            + New group with this light
          </button>
          {col && (
            <>
              <Toggle
                label={`Composite (${members} light${members === 1 ? '' : 's'})`}
                checked={!!comp?.enabled}
                variant="glossy"
                onChange={(v) => setComposite(col.id, v ? { ...(comp ?? defaultComposite()), enabled: true } : { enabled: false })}
              />
              {comp?.enabled && (
                <div style={{ marginTop: 6 }}>
                  <Slider label="Brightness" value={comp.brightness} min={0} max={400} step={1} unit="%" onChange={(v) => setComposite(col.id, { brightness: v })} />
                  <Slider label="Opacity" value={comp.opacity} min={0} max={200} step={1} unit="%" onChange={(v) => setComposite(col.id, { opacity: v })} />
                  <Slider label="Rotate (yaw)" value={comp.yaw} min={-180} max={180} step={1} unit="°" onChange={(v) => setComposite(col.id, { yaw: v })} />
                  <Slider label="Tilt (pitch)" value={comp.pitch} min={-80} max={80} step={1} unit="°" onChange={(v) => setComposite(col.id, { pitch: v })} />
                  <Slider label="Distance" value={comp.distance} min={0.25} max={3} step={0.01} unit="x" onChange={(v) => setComposite(col.id, { distance: v })} />
                  <Toggle label="Visible" checked={comp.visible} variant="glossy" onChange={(v) => setComposite(col.id, { visible: v })} />
                  <div className="section-header" style={{ marginTop: 8 }}>Composite filters</div>
                  <FilterStackEditor spherical filters={comp.filters} onChange={(f) => setComposite(col.id, { filters: f })} />
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
                    The whole group is treated as one light: shared brightness and position, and its filters blur/streak the group as a single image in the HDRI.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
