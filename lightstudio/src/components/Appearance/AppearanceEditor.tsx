import React, { useRef, useState } from 'react';
import {
  BLEND_LABELS,
  CONTENT_SECTIONS,
  CONTENT_TYPE_LABELS,
  type AppearanceBlend,
  type ContentLayer,
  type ContentParams,
  type ContentType,
  type LightAppearance,
  type SectionKind,
} from '../../appearance/types';
import { defaultContent, newLayer } from '../../appearance/content';
import { BLEND_MODE_LIST } from '../../appearance/presets';
import { useAppearanceStore } from '../../appearance/appearanceStore';
import { importImageFile } from '../../appearance/imageImport';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { Dropdown } from '../UI/Dropdown';
import { ColorPicker } from '../UI/ColorPicker';
import { RampEditor } from './RampEditor';
import { CurveEditor } from './CurveEditor';
import { FilterStackEditor } from '../Filters/FilterStackEditor';

const TYPE_OPTIONS = (section: SectionKind) =>
  (Object.keys(CONTENT_TYPE_LABELS) as ContentType[])
    .filter((t) => CONTENT_SECTIONS[t].includes(section))
    .map((t) => ({ value: t, label: CONTENT_TYPE_LABELS[t] }));

const BLEND_OPTIONS = BLEND_MODE_LIST.map((b) => ({ value: b, label: BLEND_LABELS[b] }));

const Sub: React.FC<{ title: string; children: React.ReactNode; open?: boolean }> = ({ title, children, open = false }) => {
  const [o, setO] = useState(open);
  return (
    <div style={{ marginTop: 6 }}>
      <div onClick={() => setO(!o)} style={{ cursor: 'pointer', fontSize: 10, color: 'var(--text-sec)', userSelect: 'none', padding: '2px 0' }}>
        {o ? '▾' : '▸'} {title}
      </div>
      {o && <div style={{ paddingLeft: 4 }}>{children}</div>}
    </div>
  );
};

// ── image picker ────────────────────────────────────────────────────────────

export const ImagePicker: React.FC<{ value: string | null; onChange: (id: string | null) => void; label: string }> = ({ value, onChange, label }) => {
  const images = useAppearanceStore((s) => s.images);
  const addImage = useAppearanceStore((s) => s.addImage);
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const opts = [{ value: '', label: '(none)' }, ...Object.values(images).map((i) => ({ value: i.id, label: `${i.name} (${i.width}x${i.height})` }))];
  return (
    <div>
      <Dropdown label={label} value={value ?? ''} options={opts} onChange={(v) => onChange(v || null)} />
      <div style={{ display: 'flex', gap: 6, margin: '4px 0' }}>
        <button className="btn-sm" onClick={() => file.current?.click()}>Import image…</button>
        {value && <button className="btn-sm" onClick={() => onChange(null)}>Clear</button>}
      </div>
      {err && <div style={{ color: 'var(--danger, #f87171)', fontSize: 10 }}>{err}</div>}
      <input
        ref={file}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.hdr,.exr"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setErr('');
            const img = await importImageFile(f);
            addImage(img);
            onChange(img.id);
          } catch (ex) {
            setErr('Could not read that image: ' + (ex instanceof Error ? ex.message : String(ex)));
          }
        }}
      />
    </div>
  );
};

// ── content-specific controls (names follow HDR Light Studio's content reference) ──

const Sub2: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ fontSize: 10, color: 'var(--text-sec)', margin: '8px 0 2px' }}>{title}</div>
);
void Sub2;

const ContentControls: React.FC<{
  layer: ContentLayer;
  aspect: number;
  onLayer: (l: ContentLayer) => void;
  onRestoreAspect?: (imageAspect: number) => void;
}> = ({ layer, aspect, onLayer, onRestoreAspect }) => {
  const c = layer.content;
  const images = useAppearanceStore((s) => s.images);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: Record<string, any>) => onLayer({ ...layer, content: { ...c, p: { ...c.p, ...patch } } as ContentParams });

  switch (c.type) {
    case 'flat': {
      const p = c.p;
      return <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />;
    }
    case 'bulb': {
      const p = c.p;
      return (
        <>
          <Dropdown label="Light type" value={p.shape} options={[{ value: 'round', label: 'Round' }, { value: 'rect', label: 'Rect' }, { value: 'hex', label: 'Hex' }]} onChange={(v) => set({ shape: v })} />
          <Slider label="Bulb width" value={p.width} min={0} max={100} step={1} unit="%" onChange={(v) => set({ width: v })} />
          <Slider label="Bulb position" value={p.position} min={-50} max={50} step={1} onChange={(v) => set({ position: v })} />
          <div style={{ display: 'flex', gap: 12 }}>
            <Toggle label="Half" checked={p.half} variant="glossy" onChange={(v) => set({ half: v })} />
            <Toggle label="Outside" checked={p.outside} variant="glossy" onChange={(v) => set({ outside: v })} />
          </div>
          <Dropdown label="Colour mode" value={p.colorMode} options={[{ value: 'flat', label: 'Flat' }, { value: 'ramp', label: 'Ramp' }]} onChange={(v) => set({ colorMode: v })} />
          {p.colorMode === 'flat' ? (
            <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          ) : (
            <RampEditor label="Colour ramp (centre → outside)" mode="color" stops={p.colorRamp} onChange={(s) => set({ colorRamp: s })} />
          )}
          <RampEditor label="Alpha ramp (centre → outside)" mode="value" stops={p.alphaRamp} onChange={(s) => set({ alphaRamp: s })} vmax={1} />
        </>
      );
    }
    case 'gradient': {
      const p = c.p;
      return (
        <>
          <Dropdown label="Type" value={p.mode} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} onChange={(v) => set({ mode: v })} />
          <RampEditor label="Colour ramp" mode="color" stops={p.colorRamp} onChange={(s) => set({ colorRamp: s })} />
          <RampEditor label="Value ramp" mode="value" stops={p.valueRamp} onChange={(s) => set({ valueRamp: s })} vmax={2} />
          <RampEditor label="Alpha ramp" mode="value" stops={p.alphaRamp} onChange={(s) => set({ alphaRamp: s })} vmax={1} />
          {p.mode === 'linear' && <Slider label="Rotation" value={p.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ rotation: v })} />}
          <Slider label="Origin X" value={p.originX} min={-1} max={1} step={0.01} onChange={(v) => set({ originX: v })} />
          <Slider label="Origin Y" value={p.originY} min={-1} max={1} step={0.01} onChange={(v) => set({ originY: v })} />
          <Slider label="Extent" value={p.extent} min={0.05} max={4} step={0.01} onChange={(v) => set({ extent: v })} />
        </>
      );
    }
    case 'boxgrad': {
      const p = c.p;
      const edge = (name: 'left' | 'right' | 'top' | 'bottom', label: string) => (
        <Sub title={`${label} edge`}>
          <Slider label="Position" value={p[name].pos} min={0} max={1} step={0.005} onChange={(v) => set({ [name]: { ...p[name], pos: v } })} />
          <Slider label="Softness" value={p[name].soft} min={0} max={1} step={0.005} onChange={(v) => set({ [name]: { ...p[name], soft: v } })} />
        </Sub>
      );
      return (
        <>
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Dropdown label="Edge interpolation" value={p.edgeInterp} options={[{ value: 'cosine', label: 'Cosine' }, { value: 'step', label: 'Step' }]} onChange={(v) => set({ edgeInterp: v })} />
          {edge('left', 'Left')}
          {edge('right', 'Right')}
          {edge('top', 'Top')}
          {edge('bottom', 'Bottom')}
          <Dropdown
            label="Combine"
            value={p.combine}
            options={[{ value: 'multiply', label: 'Multiply' }, { value: 'add', label: 'Add' }, { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' }]}
            onChange={(v) => set({ combine: v })}
          />
          <RampEditor label="Horizontal ramp" mode="value" stops={p.hRamp} onChange={(s) => set({ hRamp: s })} vmax={2} />
          <RampEditor label="Vertical ramp" mode="value" stops={p.vRamp} onChange={(s) => set({ vRamp: s })} vmax={2} />
        </>
      );
    }
    case 'polygon': {
      const p = c.p;
      return (
        <>
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Sides" value={p.sides} min={3} max={12} step={1} onChange={(v) => set({ sides: Math.round(v) })} />
          <Slider label="Softness" value={p.softness} min={0} max={1} step={0.005} onChange={(v) => set({ softness: v })} />
          <Slider label="Radius" value={p.radius} min={0} max={1} step={0.005} onChange={(v) => set({ radius: v })} />
        </>
      );
    }
    case 'image': {
      const p = c.p;
      const img = p.imageId ? images[p.imageId] : undefined;
      return (
        <>
          <ImagePicker label="Image" value={p.imageId} onChange={(id) => set({ imageId: id })} />
          {img && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-sec)', margin: '2px 0 6px' }}>
              <span>Resolution {img.width} × {img.height}</span>
              {onRestoreAspect && <button className="btn-sm" onClick={() => onRestoreAspect(img.width / img.height)}>Restore aspect ratio</button>}
            </div>
          )}
          <Toggle label="Color transform (sRGB → linear)" checked={p.colorTransform} variant="glossy" onChange={(v) => set({ colorTransform: v })} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '4px 0' }}>
            <Toggle label="Half" checked={p.half} variant="glossy" onChange={(v) => set({ half: v })} />
            <Toggle label="Flip" checked={p.flip} variant="glossy" onChange={(v) => set({ flip: v })} />
            <Toggle label="Unpremultiply" checked={p.unpremultiply} variant="glossy" onChange={(v) => set({ unpremultiply: v })} />
            <Toggle label="Invert alpha" checked={p.invertAlpha} variant="glossy" onChange={(v) => set({ invertAlpha: v })} />
          </div>
          <Dropdown label="Colour mode" value={p.colorMode} options={[{ value: 'source', label: 'Source' }, { value: 'flat', label: 'Flat' }, { value: 'ramp', label: 'Ramp' }]} onChange={(v) => set({ colorMode: v })} />
          {p.colorMode === 'flat' && <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />}
          {p.colorMode === 'ramp' && (
            <>
              <Dropdown label="Ramp type" value={p.rampMode} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} onChange={(v) => set({ rampMode: v })} />
              <RampEditor label="Colour ramp" mode="color" stops={p.colorRamp} onChange={(s) => set({ colorRamp: s })} />
            </>
          )}
          <Slider label="Saturation" value={p.saturation} min={0} max={3} step={0.01} onChange={(v) => set({ saturation: v })} />
          <Slider label="Gamma" value={p.gamma} min={0.2} max={4} step={0.01} onChange={(v) => set({ gamma: v })} />
          <Slider label="Exposure" value={p.exposure} min={-8} max={8} step={0.05} unit=" EV" onChange={(v) => set({ exposure: v })} />
        </>
      );
    }
    case 'lumicurve': {
      const p = c.p;
      return (
        <>
          <CurveEditor params={p} aspect={aspect} onChange={(patch) => set(patch)} />
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Dropdown
            label="Offset type"
            value={p.offsetType}
            options={[{ value: 'normal', label: 'Line normal' }, { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'angle', label: 'Angle' }]}
            onChange={(v) => set({ offsetType: v })}
          />
          {p.offsetType === 'angle' && <Slider label="Offset angle" value={p.offsetAngle} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ offsetAngle: v })} />}
          <Slider label="Falloff offset (green)" value={p.greenOffset} min={0.01} max={1.5} step={0.005} onChange={(v) => set({ greenOffset: v })} />
          {!p.symmetrical && <Slider label="Falloff offset (blue)" value={p.blueOffset} min={0.01} max={1.5} step={0.005} onChange={(v) => set({ blueOffset: v })} />}
          <Toggle label="Symmetrical" checked={p.symmetrical} variant="glossy" onChange={(v) => set({ symmetrical: v, blueRamp: v ? p.blueRamp : JSON.parse(JSON.stringify(p.greenRamp)), blueOffset: v ? p.blueOffset : p.greenOffset })} />
          <RampEditor label="Falloff (green)" mode="value" stops={p.greenRamp} onChange={(s) => set({ greenRamp: s })} vmax={1} />
          {!p.symmetrical && <RampEditor label="Falloff (blue)" mode="value" stops={p.blueRamp} onChange={(s) => set({ blueRamp: s })} vmax={1} />}
          <RampEditor label="Length ramp" mode="value" stops={p.lengthRamp} onChange={(s) => set({ lengthRamp: s })} vmax={1} />
          <Toggle label="Closed" checked={p.closed} variant="glossy" onChange={(v) => set({ closed: v })} />
          <Sub title="Ends">
            <Slider label="Roundness start" value={p.roundnessStart} min={0} max={0.49} step={0.005} onChange={(v) => set({ roundnessStart: v })} />
            <Slider label="Roundness end" value={p.roundnessEnd} min={0} max={0.49} step={0.005} onChange={(v) => set({ roundnessEnd: v })} />
            <Slider label="Start blend" value={p.startBlend} min={1} max={6} step={0.1} onChange={(v) => set({ startBlend: v })} />
            <Slider label="End blend" value={p.endBlend} min={1} max={6} step={0.1} onChange={(v) => set({ endBlend: v })} />
            <Slider label="Start angle" value={p.startAngle} min={-90} max={90} step={1} unit="°" onChange={(v) => set({ startAngle: v })} />
            <Slider label="End angle" value={p.endAngle} min={-90} max={90} step={1} unit="°" onChange={(v) => set({ endAngle: v })} />
          </Sub>
        </>
      );
    }
    case 'scrim': {
      const p = c.p;
      return (
        <>
          <Dropdown label="Light type" value={p.kind} options={[{ value: 'polygon', label: 'Polygon light' }, { value: 'spot', label: 'Spot light' }]} onChange={(v) => set({ kind: v })} />
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Slider label="Height" value={p.height} min={0.1} max={4} step={0.01} onChange={(v) => set({ height: v })} />
          <Slider label="Tilt" value={p.tilt} min={-80} max={80} step={1} unit="°" onChange={(v) => set({ tilt: v })} />
          <Slider label="Position X" value={p.posX} min={-2} max={2} step={0.01} onChange={(v) => set({ posX: v })} />
          <Slider label="Position Y" value={p.posY} min={-2} max={2} step={0.01} onChange={(v) => set({ posY: v })} />
          <Slider label="Rotation" value={p.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ rotation: v })} />
          {p.kind === 'polygon' && (
            <>
              <Slider label="Sides" value={p.sides} min={3} max={25} step={1} onChange={(v) => set({ sides: Math.round(v) })} />
              <Slider label="Width" value={p.width} min={0.02} max={3} step={0.01} onChange={(v) => set({ width: v })} />
              <Slider label="Depth" value={p.depth} min={0.02} max={3} step={0.01} onChange={(v) => set({ depth: v })} />
            </>
          )}
          <Slider label="Spread" value={p.spread} min={5} max={180} step={1} unit="°" onChange={(v) => set({ spread: v })} />
          <Slider label="Surface fade" value={p.surfaceFade} min={0} max={1} step={0.005} onChange={(v) => set({ surfaceFade: v })} />
          <Slider label="Zoom" value={p.zoom} min={0.1} max={4} step={0.01} onChange={(v) => set({ zoom: v })} />
          <Slider label="Handle X" value={p.handleX} min={-2} max={2} step={0.01} onChange={(v) => set({ handleX: v })} />
          <Slider label="Handle Y" value={p.handleY} min={-2} max={2} step={0.01} onChange={(v) => set({ handleY: v })} />
          {p.kind === 'spot' && <RampEditor label="Falloff (centre → edge)" mode="value" stops={p.falloff} onChange={(s) => set({ falloff: s })} vmax={1} />}
          <button className="btn-sm" style={{ marginTop: 6 }} onClick={() => onLayer({ ...layer, content: defaultContent('scrim') })}>Reset</button>
        </>
      );
    }
    case 'sky': {
      const p = c.p;
      return (
        <>
          <Slider label="Altitude" value={p.altitude} min={0} max={90} step={0.5} unit="°" onChange={(v) => set({ altitude: v })} />
          <Slider label="Azimuth" value={p.azimuth} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ azimuth: v })} />
          <Slider label="Turbidity" value={p.turbidity} min={0} max={10} step={0.1} onChange={(v) => set({ turbidity: v })} />
          <Slider label="Albedo" value={p.albedo} min={0} max={1} step={0.01} onChange={(v) => set({ albedo: v })} />
          <Slider label="Disc size" value={p.discSize} min={0.1} max={20} step={0.05} unit="x" onChange={(v) => set({ discSize: v })} />
          <Toggle label="Disc visibility" checked={p.discVisible} variant="glossy" onChange={(v) => set({ discVisible: v })} />
          <RampEditor label="Disc falloff" mode="value" stops={p.discFalloff} onChange={(s) => set({ discFalloff: s })} vmax={1} />
          <Slider label="Energy boost" value={p.energyBoost} min={0} max={20} step={0.05} onChange={(v) => set({ energyBoost: v })} />
          <Toggle label="Sky visibility" checked={p.skyVisible} variant="glossy" onChange={(v) => set({ skyVisible: v })} />
          <RampEditor label="Sky alpha (horizon → zenith)" mode="value" stops={p.skyAlpha} onChange={(s) => set({ skyAlpha: s })} vmax={1} />
          <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>Sky is laid out in texture space: left-right is azimuth, bottom-top is altitude 0-90. A bigger disc keeps the sun's energy.</div>
        </>
      );
    }
  }
};

// ── layer card ──────────────────────────────────────────────────────────────

const LayerCard: React.FC<{
  layer: ContentLayer;
  section: SectionKind;
  aspect: number;
  onLayer: (l: ContentLayer) => void;
  onRemove?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onRestoreAspect?: (a: number) => void;
}> = ({ layer, section, aspect, onLayer, onRemove, onMove, onRestoreAspect }) => {
  const [open, setOpen] = useState(section === 'master');
  const t = layer.transform;
  const setT = (patch: Partial<typeof t>) => onLayer({ ...layer, transform: { ...t, ...patch } });
  return (
    <div className="appearance-layer" style={{ border: '1px solid var(--border, #3a3a3a)', borderRadius: 6, padding: 6, marginBottom: 6, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span onClick={() => setOpen(!open)} style={{ cursor: 'pointer', width: 10, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        <Toggle checked={layer.enabled} onChange={(v) => onLayer({ ...layer, enabled: v })} />
        <span style={{ flex: 1, fontSize: 11, cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen(!open)}>
          {layer.name}
          <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{CONTENT_TYPE_LABELS[layer.content.type]}</span>
        </span>
        {onMove && (
          <>
            <button className="btn-sm" title="Move up" onClick={() => onMove(-1)}>↑</button>
            <button className="btn-sm" title="Move down" onClick={() => onMove(1)}>↓</button>
          </>
        )}
        {onRemove && <button className="btn-sm" title="Remove layer" onClick={onRemove}>✕</button>}
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          <Dropdown
            label="Content"
            value={layer.content.type}
            options={TYPE_OPTIONS(section)}
            onChange={(v) => onLayer({ ...layer, name: section === 'master' ? 'Master' : CONTENT_TYPE_LABELS[v as ContentType], content: defaultContent(v as ContentType) })}
          />
          {section !== 'master' && (
            <>
              {section === 'valueBlend' && (
                <Dropdown label="Blend" value={layer.blend} options={BLEND_OPTIONS} onChange={(v) => onLayer({ ...layer, blend: v as AppearanceBlend })} />
              )}
              <Slider label="Amount" value={layer.amount} min={0} max={100} step={1} unit="%" onChange={(v) => onLayer({ ...layer, amount: v })} />
            </>
          )}
          <Toggle label="Invert" checked={layer.invert} variant="glossy" onChange={(v) => onLayer({ ...layer, invert: v })} />
          <div style={{ marginTop: 6 }}>
            <ContentControls layer={layer} aspect={aspect} onLayer={onLayer} onRestoreAspect={onRestoreAspect} />
          </div>
          <Sub title="Transform">
            <Slider label="Scale X" value={t.scaleX} min={0.05} max={5} step={0.01} onChange={(v) => setT({ scaleX: v })} />
            <Slider label="Scale Y" value={t.scaleY} min={0.05} max={5} step={0.01} onChange={(v) => setT({ scaleY: v })} />
            <Slider label="Rotation" value={t.rotation} min={-180} max={180} step={0.5} unit="°" onChange={(v) => setT({ rotation: v })} />
            <Slider label="Offset X" value={t.offsetX} min={-2} max={2} step={0.005} onChange={(v) => setT({ offsetX: v })} />
            <Slider label="Offset Y" value={t.offsetY} min={-2} max={2} step={0.005} onChange={(v) => setT({ offsetY: v })} />
            <div style={{ display: 'flex', gap: 12 }}>
              <Toggle label="Flip X" checked={t.flipX} variant="glossy" onChange={(v) => setT({ flipX: v })} />
              <Toggle label="Flip Y" checked={t.flipY} variant="glossy" onChange={(v) => setT({ flipY: v })} />
            </div>
            <button className="btn-sm" style={{ marginTop: 4 }} onClick={() => setT({ scaleX: 1, scaleY: 1, rotation: 0, offsetX: 0, offsetY: 0, flipX: false, flipY: false })}>Reset transform</button>
          </Sub>
        </div>
      )}
    </div>
  );
};

// ── main editor ─────────────────────────────────────────────────────────────

interface EditorProps {
  appearance: LightAppearance;
  aspect: number;
  onChange: (a: LightAppearance) => void;
  /** Set the light's height so an image keeps its proportions. */
  onRestoreAspect?: (imageAspect: number) => void;
}

export const AppearanceEditor: React.FC<EditorProps> = ({ appearance, aspect, onChange, onRestoreAspect }) => {
  const [addType, setAddType] = useState<ContentType>('bulb');
  const [addAlphaType, setAddAlphaType] = useState<ContentType>('boxgrad');
  const g = appearance.global;
  const setG = (patch: Partial<typeof g>) => onChange({ ...appearance, global: { ...g, ...patch } });

  const updateList = (section: 'valueBlend' | 'alphaMultiply', idx: number, l: ContentLayer) =>
    onChange({ ...appearance, [section]: appearance[section].map((x, i) => (i === idx ? l : x)) });
  const removeFrom = (section: 'valueBlend' | 'alphaMultiply', idx: number) =>
    onChange({ ...appearance, [section]: appearance[section].filter((_, i) => i !== idx) });
  const move = (section: 'valueBlend' | 'alphaMultiply', idx: number, dir: -1 | 1) => {
    const list = [...appearance[section]];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    onChange({ ...appearance, [section]: list });
  };

  return (
    <div className="appearance-editor">
      <div className="section-header" style={{ marginTop: 4 }}>Master</div>
      <LayerCard layer={appearance.master} section="master" aspect={aspect} onRestoreAspect={onRestoreAspect} onLayer={(l) => onChange({ ...appearance, master: l })} />

      <div className="section-header" style={{ marginTop: 10 }}>Value Blend</div>
      {appearance.valueBlend.map((l, i) => (
        <LayerCard
          key={l.id}
          layer={l}
          section="valueBlend"
          aspect={aspect}
          onRestoreAspect={onRestoreAspect}
          onLayer={(x) => updateList('valueBlend', i, x)}
          onRemove={() => removeFrom('valueBlend', i)}
          onMove={(d) => move('valueBlend', i, d)}
        />
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Dropdown value={addType} options={TYPE_OPTIONS('valueBlend')} onChange={(v) => setAddType(v as ContentType)} />
        <button
          className="btn-sm"
          onClick={() => onChange({ ...appearance, valueBlend: [...appearance.valueBlend, newLayer(addType, { blend: 'multiply' })] })}
        >
          + Value Blend
        </button>
      </div>

      <div className="section-header" style={{ marginTop: 10 }}>Alpha Multiply</div>
      {appearance.alphaMultiply.map((l, i) => (
        <LayerCard
          key={l.id}
          layer={l}
          section="alphaMultiply"
          aspect={aspect}
          onRestoreAspect={onRestoreAspect}
          onLayer={(x) => updateList('alphaMultiply', i, x)}
          onRemove={() => removeFrom('alphaMultiply', i)}
          onMove={(d) => move('alphaMultiply', i, d)}
        />
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Dropdown value={addAlphaType} options={TYPE_OPTIONS('alphaMultiply')} onChange={(v) => setAddAlphaType(v as ContentType)} />
        <button className="btn-sm" onClick={() => onChange({ ...appearance, alphaMultiply: [...appearance.alphaMultiply, newLayer(addAlphaType)] })}>
          + Alpha Multiply
        </button>
      </div>

      <div className="section-header" style={{ marginTop: 10 }}>Filters</div>
      <FilterStackEditor filters={appearance.filters} onChange={(f) => onChange({ ...appearance, filters: f })} />

      <div className="section-header" style={{ marginTop: 10 }}>Global</div>
      <Slider label="Brightness" value={g.brightness} min={-6} max={6} step={0.05} unit=" EV" onChange={(v) => setG({ brightness: v })} />
      <ColorPicker label="Tint" color={g.tint} onChange={(v) => setG({ tint: v })} />
      <Slider label="Hue" value={g.hue} min={-180} max={180} step={1} unit="°" onChange={(v) => setG({ hue: v })} />
      <Slider label="Saturation" value={g.saturation} min={-100} max={100} step={1} onChange={(v) => setG({ saturation: v })} />
      <Slider label="Contrast" value={g.contrast} min={-100} max={100} step={1} onChange={(v) => setG({ contrast: v })} />
      <Slider label="Gamma" value={g.gamma} min={0.2} max={3} step={0.01} onChange={(v) => setG({ gamma: v })} />
      <Slider label="Opacity" value={g.opacity} min={0} max={100} step={1} unit="%" onChange={(v) => setG({ opacity: v })} />
      <Slider label="Content scale" value={g.scale} min={0.1} max={5} step={0.01} unit="x" onChange={(v) => setG({ scale: v })} />
      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <Toggle label="Flip X" checked={g.flipX} variant="glossy" onChange={(v) => setG({ flipX: v })} />
        <Toggle label="Flip Y" checked={g.flipY} variant="glossy" onChange={(v) => setG({ flipY: v })} />
      </div>
    </div>
  );
};
