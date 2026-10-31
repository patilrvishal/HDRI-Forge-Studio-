import React, { useState } from 'react';
import * as THREE from 'three';
import { useLightsStore } from '../../store/lightsStore';
import { useObjectHdriStore, defaultObjectHdri } from '../../store/objectHdriStore';
import { objectKey } from '../../three/objectBinding';
import { enableObjectLight, disableObjectLight, setIncludeInHdri } from '../../three/objectLightApi';
import { LightProperties } from '../Lights/LightProperties';
import { Toggle } from '../UI/Toggle';
import { Slider } from '../UI/Slider';
import { Dropdown } from '../UI/Dropdown';
import { ColorPicker } from '../UI/ColorPicker';

const Section: React.FC<{ title: string; children: React.ReactNode; right?: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, right, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="props-section">
      <div className="section-header" onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ flexShrink: 0, opacity: 0.65, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
          <path d="M2 0l4 4-4 4z" />
        </svg>
        <span style={{ flex: 1 }}>{title}</span>
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </div>
      {open && children}
    </div>
  );
};

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.45, margin: '2px 0 6px' }}>{children}</div>
);

/**
 * Per-object HDRI controls: include / exclude the object in the HDRI render,
 * and use the object as a light with the full light control set.
 */
export const ObjectHdriLightSection: React.FC<{ obj: THREE.Object3D }> = ({ obj }) => {
  const key = objectKey(obj);
  const light = useLightsStore((s) => s.lights.find((l) => l.objectKey === key));
  const cfg = useObjectHdriStore((s) => s.settings[key]);
  const setCfg = useObjectHdriStore((s) => s.set);
  const included = !!cfg?.include;
  const c = cfg ?? defaultObjectHdri();

  return (
    <>
      <Section title="HDRI Render">
        <Toggle label="Include in HDRI" checked={included} variant="glossy" onChange={(v) => setIncludeInHdri(obj, v)} />
        {included ? (
          <div style={{ marginTop: 6 }}>
            <Slider label="Intensity" value={c.intensity} min={0} max={20} step={0.05} onChange={(v) => setCfg(key, { intensity: v })} />
            <Slider label="Opacity" value={c.opacity} min={0} max={100} step={1} unit="%" onChange={(v) => setCfg(key, { opacity: v })} />
            <Dropdown
              label="Color"
              value={c.colorMode}
              options={[
                { value: 'material', label: 'Object material' },
                { value: 'custom', label: 'Custom color' },
              ]}
              onChange={(v) => setCfg(key, { colorMode: v as 'material' | 'custom' })}
            />
            {c.colorMode === 'custom' && <ColorPicker label="Custom" color={c.color} onChange={(v) => setCfg(key, { color: v })} />}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="btn-sm" title="Paint this object solid black so it blocks light in the HDRI" onClick={() => setCfg(key, { colorMode: 'custom', color: '#000000', opacity: 100 })}>
                Make blocker
              </button>
              <button className="btn-sm" onClick={() => setCfg(key, defaultObjectHdri())}>Reset</button>
            </div>
            <Hint>The object is painted into the exported HDRI and the HDRI preview as seen from the capture point, and hides any light behind it.</Hint>
          </div>
        ) : (
          <Hint>Excluded: the object does not appear in the HDRI. Turn on to paint it into the exported HDRI (flags, cards, blockers).</Hint>
        )}
      </Section>

      <Section title="Light">
        <Toggle
          label="Use as light"
          checked={!!light}
          variant="glossy"
          onChange={(v) => {
            if (v) enableObjectLight(obj);
            else disableObjectLight(key);
          }}
        />
        {!light && <Hint>Make this object emit light. It gets the full light controls (color, brightness, opacity, temperature, softness, drop shadow) and appears in the Lights list.</Hint>}
      </Section>

      {light && <LightProperties lightId={light.id} />}
    </>
  );
};
