import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useLightsStore } from '../../store/lightsStore';
import { useRigSetStore, type MatOverride } from '../../store/rigSetStore';
import { useObjectHdriStore } from '../../store/objectHdriStore';
import { useSceneHierarchyStore } from '../../store/sceneHierarchyStore';
import { objectKey } from '../../three/objectBinding';
import { setIncludeInHdri } from '../../three/objectLightApi';
import { applyMaterialOverrides, partMaterials } from '../../three/rigGroup';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { ColorPicker } from '../UI/ColorPicker';

/**
 * Properties of a rig. Selecting the rig group shows everything it is made of, organised by what it is: the rig's lights,
 * then the room (floor, walls, ceiling) and the fixtures, each with its own colour, roughness, metalness and glow.
 * Selecting one part shows just that part. Changes are remembered, so they survive the set being rebuilt.
 */

const box: React.CSSProperties = { borderBottom: '1px solid var(--border-light)' };
const head: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer', userSelect: 'none',
  fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.2,
};
const pad: React.CSSProperties = { padding: '2px 12px 10px' };

const Section: React.FC<{ title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={box}>
      <div style={head} onClick={() => setOpen((o) => !o)}>
        <svg width="9" height="9" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M2 0l4 4-4 4z" /></svg>
        <span style={{ flex: 1 }}>{title}</span>
        {count !== undefined && <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>{count}</span>}
      </div>
      {open && <div style={pad}>{children}</div>}
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0' }}>
    <span style={{ width: 78, fontSize: 12, color: 'var(--text-sec)', flexShrink: 0 }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

const hex = (c: THREE.Color): string => '#' + c.getHexString();

/** Editing controls for one part of the set (colour / roughness / metalness for its body, strength + colour for its glow). */
export const PartEditor: React.FC<{ part: THREE.Object3D; group: THREE.Group; compact?: boolean }> = ({ part, group, compact }) => {
  const [tick, setTick] = useState(0);
  const hiddenIds = useSceneHierarchyStore((s) => s.hiddenIds);
  const key = objectKey(part);
  const included = useObjectHdriStore((s) => !!s.settings[key]?.include);
  const setOverride = useRigSetStore((s) => s.setOverride);
  const { body, glow } = useMemo(() => partMaterials(part), [part, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((patch: MatOverride) => {
    setOverride(part.name, patch);
    applyMaterialOverrides(group, { [part.name]: { ...(useRigSetStore.getState().overrides[part.name] ?? {}), ...patch } });
    useObjectHdriStore.getState().touch();                 // the HDRI uses the colours too
    setTick((n) => n + 1);
  }, [group, part.name, setOverride]);

  const b = body[0];
  const g = glow[0];
  const hidden = hiddenIds.includes(part.uuid) || !part.visible;

  return (
    <div style={compact ? { padding: '4px 0 8px' } : undefined}>
      <Row label="Visible">
        <Toggle checked={!hidden} variant="glossy" onChange={() => {
          useSceneHierarchyStore.getState().toggleVisibility(part.uuid);
          const nowHidden = useSceneHierarchyStore.getState().hiddenIds.includes(part.uuid);
          part.visible = !nowHidden;
          part.traverse((c) => { c.visible = !nowHidden; });
          setTick((n) => n + 1);
        }} />
      </Row>
      <Row label="In HDRI">
        <Toggle checked={included} variant="glossy" onChange={(v) => setIncludeInHdri(part, v)} />
      </Row>
      {b && (
        <>
          <Row label="Colour"><ColorPicker color={hex(b.color)} onChange={(c) => apply({ color: c })} /></Row>
          <Slider label="Roughness" value={b.roughness} min={0} max={1} step={0.01} onChange={(v) => apply({ roughness: v })} />
          <Slider label="Metalness" value={b.metalness} min={0} max={1} step={0.01} onChange={(v) => apply({ metalness: v })} />
        </>
      )}
      {g && (
        <>
          <Row label="Glow colour"><ColorPicker color={hex(g.emissive)} onChange={(c) => apply({ glowColor: c })} /></Row>
          <Slider label="Glow strength" value={g.emissiveIntensity} min={0} max={20} step={0.1} onChange={(v) => apply({ glow: v })} />
        </>
      )}
      {!b && !g && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>This part has no material to edit.</div>}
    </div>
  );
};

const PartRow: React.FC<{ part: THREE.Object3D; group: THREE.Group; defaultOpen?: boolean }> = ({ part, group, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const select = () => useSceneHierarchyStore.getState().select?.(part.uuid);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, margin: '6px 0', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6, transform: open ? 'rotate(90deg)' : 'none' }}><path d="M2 0l4 4-4 4z" /></svg>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{part.name}</span>
        <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); select(); }} title="Select this part in the hierarchy">Select</button>
      </div>
      {open && <div style={{ padding: '0 10px 6px' }}><PartEditor part={part} group={group} compact /></div>}
    </div>
  );
};

/** One rig light: the controls you reach for most, with a jump to its full light properties. */
const LightRow: React.FC<{ id: string }> = ({ id }) => {
  const light = useLightsStore((s) => s.lights.find((l) => l.id === id));
  const update = useLightsStore((s) => s.updateLight);
  const select = useLightsStore((s) => s.selectLight);
  const [open, setOpen] = useState(false);
  if (!light) return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, margin: '6px 0', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6, transform: open ? 'rotate(90deg)' : 'none' }}><path d="M2 0l4 4-4 4z" /></svg>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: light.color, border: '1px solid var(--border-light)' }} />
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{light.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(light.brightness)}</span>
        <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); useSceneHierarchyStore.getState().select?.(null as never); select(light.id); }} title="Open this light's full properties">Open</button>
      </div>
      {open && (
        <div style={{ padding: '0 10px 8px' }}>
          <Row label="Visible"><Toggle checked={light.visible !== false} variant="glossy" onChange={(v) => update(light.id, { visible: v })} /></Row>
          <Row label="Colour"><ColorPicker color={light.color} onChange={(c) => update(light.id, { color: c })} /></Row>
          <Slider label="Brightness" value={light.brightness} min={0} max={5000} step={10} inputMax={100000} onChange={(v) => update(light.id, { brightness: v })} />
          {(light.type === 'area' || light.areaLight) && (
            <>
              <Slider label="Width" value={light.areaWidth ?? 1} min={0.05} max={12} step={0.05} onChange={(v) => update(light.id, { areaWidth: v })} />
              <Slider label="Height" value={light.areaHeight ?? 1} min={0.05} max={12} step={0.05} onChange={(v) => update(light.id, { areaHeight: v })} />
              <Slider label="Edge softness" value={light.edgeSoftness ?? 50} min={0} max={100} step={1} onChange={(v) => update(light.id, { edgeSoftness: v })} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const CATEGORIES: { title: string; test: RegExp; open: boolean }[] = [
  { title: 'Floor', test: /floor|apron|concrete/i, open: true },
  { title: 'Walls & Cyc', test: /wall|cyc|return/i, open: true },
  { title: 'Ceiling & Truss', test: /ceiling|truss|beam/i, open: false },
  { title: 'Fixtures', test: /fixture|softbox|panel|strip/i, open: true },
];

export const RigGroupProperties: React.FC<{ group: THREE.Group }> = ({ group }) => {
  const [, setTick] = useState(0);
  const lightIds = useRigSetStore((s) => s.lightIds);
  const lights = useLightsStore((s) => s.lights);
  const clearOverrides = useRigSetStore((s) => s.clearOverrides);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 600);
    return () => clearInterval(t);
  }, []);

  const parts = group.children.filter((c) => c.userData.rigPart);
  const buckets = CATEGORIES.map((c) => ({ ...c, items: [] as THREE.Object3D[] }));
  const details: THREE.Object3D[] = [];
  for (const p of parts) {
    const b = buckets.find((c) => c.test.test(p.name));
    if (b) b.items.push(p); else details.push(p);
  }
  const rigLights = lightIds.filter((id) => lights.some((l) => l.id === id));
  const scaleAll = (f: number) => rigLights.forEach((id) => {
    const l = useLightsStore.getState().lights.find((x) => x.id === id);
    if (l) useLightsStore.getState().updateLight(id, { brightness: Math.max(0, Math.round(l.brightness * f)) });
  });

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <div style={{ padding: '10px 12px', ...box }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{group.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
          Rig &middot; {rigLights.length} light{rigLights.length !== 1 ? 's' : ''} &middot; {parts.length} parts
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn-sm" style={{ fontSize: 12 }} onClick={() => scaleAll(0.8)} title="All rig lights 20% dimmer">Lights &minus;20%</button>
          <button className="btn-sm" style={{ fontSize: 12 }} onClick={() => scaleAll(1.25)} title="All rig lights 25% brighter">Lights +25%</button>
          <button className="btn-sm" style={{ fontSize: 12 }} onClick={() => clearOverrides()} title="Put every material back to the rig's own look">Reset materials</button>
        </div>
      </div>

      <Section title="Lights" count={rigLights.length}>
        {rigLights.length ? rigLights.map((id) => <LightRow key={id} id={id} />) : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No lights left in this rig.</div>}
      </Section>

      {buckets.filter((b) => b.items.length).map((b) => (
        <Section key={b.title} title={b.title} count={b.items.length} defaultOpen={b.open}>
          {b.items.map((p) => <PartRow key={p.uuid} part={p} group={group} defaultOpen={b.items.length === 1} />)}
        </Section>
      ))}

      {details.length > 0 && (
        <Section title="Details" count={details.length} defaultOpen={false}>
          {details.map((p) => <PartRow key={p.uuid} part={p} group={group} />)}
        </Section>
      )}
    </div>
  );
};

/** A single part selected in the hierarchy. */
export const RigPartProperties: React.FC<{ part: THREE.Object3D; group: THREE.Group }> = ({ part, group }) => (
  <div style={{ overflowY: 'auto', flex: 1 }}>
    <div style={{ padding: '10px 12px', ...box }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{part.name}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Part of rig &ldquo;{group.name}&rdquo;</div>
      <button className="btn-sm" style={{ fontSize: 12, marginTop: 8 }} onClick={() => useSceneHierarchyStore.getState().select?.(group.uuid)}>
        &larr; Back to {group.name}
      </button>
    </div>
    <Section title="Material">
      <PartEditor part={part} group={group} />
    </Section>
  </div>
);
