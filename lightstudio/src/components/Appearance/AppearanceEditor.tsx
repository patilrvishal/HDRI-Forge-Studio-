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

// ── content-specific controls ───────────────────────────────────────────────

const ContentControls: React.FC<{ layer: ContentLayer; aspect: number; onLayer: (l: ContentLayer) => void }> = ({ layer, aspect, onLayer }) => {
  const c = layer.content;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: Record<string, any>) => onLayer({ ...layer, content: { ...c, p: { ...c.p, ...patch } } as ContentParams });

  switch (c.type) {
    case 'flat': {
      const p = c.p;
      return (
        <>
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Slider label="Alpha" value={p.alpha} min={0} max={1} step={0.01} onChange={(v) => set({ alpha: v })} />
        </>
      );
    }
    case 'bulb': {
      const p = c.p;
      return (
        <>
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Slider label="Width" value={p.width} min={0.05} max={2} step={0.01} onChange={(v) => set({ width: v })} />
          <Slider label="Extent" value={p.extent} min={0.05} max={1.5} step={0.01} onChange={(v) => set({ extent: v })} />
          <RampEditor label="Falloff (centre → edge)" mode="value" stops={p.ramp} onChange={(s) => set({ ramp: s })} vmax={1} />
        </>
      );
    }
    case 'gradient': {
      const p = c.p;
      return (
        <>
          <Dropdown label="Mode" value={p.mode} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} onChange={(v) => set({ mode: v })} />
          {p.mode === 'linear' && <Slider label="Angle" value={p.angle} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ angle: v })} />}
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <RampEditor label="Value ramp" mode="value" stops={p.valueRamp} onChange={(s) => set({ valueRamp: s })} vmax={2} />
          <RampEditor label="Alpha ramp" mode="value" stops={p.alphaRamp} onChange={(s) => set({ alphaRamp: s })} vmax={1} />
          <Toggle label="Use colour ramp" checked={p.useColorRamp} variant="glossy" onChange={(v) => set({ useColorRamp: v })} />
          {p.useColorRamp && <RampEditor label="Colour ramp" mode="color" stops={p.colorRamp} onChange={(s) => set({ colorRamp: s })} />}
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
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Slider label="Sides" value={p.sides} min={3} max={64} step={1} onChange={(v) => set({ sides: Math.round(v) })} />
          <Slider label="Radius" value={p.radius} min={0.05} max={1.5} step={0.01} onChange={(v) => set({ radius: v })} />
          <Slider label="Corner radius" value={p.cornerRadius} min={0} max={1} step={0.01} onChange={(v) => set({ cornerRadius: v })} />
          <Slider label="Softness" value={p.softness} min={0} max={1} step={0.005} onChange={(v) => set({ softness: v })} />
        </>
      );
    }
    case 'image': {
      const p = c.p;
      return (
        <>
          <ImagePicker label="Image" value={p.imageId} onChange={(id) => set({ imageId: id })} />
          <Dropdown
            label="Use"
            value={p.channel}
            options={[
              { value: 'rgba', label: 'RGB + Alpha' },
              { value: 'rgb', label: 'RGB (opaque)' },
              { value: 'luminance', label: 'Luminance' },
              { value: 'alpha', label: 'Alpha only' },
            ]}
            onChange={(v) => set({ channel: v })}
          />
          <Dropdown
            label="Fit"
            value={p.fit}
            options={[{ value: 'fit', label: 'Fit inside' }, { value: 'fill', label: 'Fill' }, { value: 'stretch', label: 'Stretch' }]}
            onChange={(v) => set({ fit: v })}
          />
          <Dropdown
            label="Outside"
            value={p.wrap}
            options={[{ value: 'clamp', label: 'Transparent' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' }]}
            onChange={(v) => set({ wrap: v })}
          />
          <Slider label="Exposure" value={p.exposure} min={-8} max={8} step={0.05} unit=" EV" onChange={(v) => set({ exposure: v })} />
          <ColorPicker label="Tint" color={p.color} onChange={(v) => set({ color: v })} />
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
          <Slider label="Thickness" value={p.thickness} min={0.01} max={1} step={0.005} onChange={(v) => set({ thickness: v })} />
          <Slider label="Softness" value={p.softness} min={0} max={1} step={0.01} onChange={(v) => set({ softness: v })} />
          <Slider label="Glow" value={p.glow} min={0} max={3} step={0.01} onChange={(v) => set({ glow: v })} />
          <Slider label="Glow falloff" value={p.glowFalloff} min={0.1} max={4} step={0.05} onChange={(v) => set({ glowFalloff: v })} />
          <Dropdown
            label="Taper"
            value={p.taper}
            options={[{ value: 'none', label: 'None' }, { value: 'ends', label: 'Both ends' }, { value: 'start', label: 'Start' }, { value: 'end', label: 'End' }]}
            onChange={(v) => set({ taper: v })}
          />
          <div style={{ display: 'flex', gap: 12, margin: '4px 0' }}>
            <Toggle label="Closed" checked={p.closed} variant="glossy" onChange={(v) => set({ closed: v })} />
            <Toggle label="Smooth" checked={p.smooth} variant="glossy" onChange={(v) => set({ smooth: v })} />
          </div>
          <RampEditor label="Brightness along curve" mode="value" stops={p.ramp} onChange={(s) => set({ ramp: s })} vmax={2} />
        </>
      );
    }
    case 'scrim': {
      const p = c.p;
      return (
        <>
          <ColorPicker label="Colour" color={p.color} onChange={(v) => set({ color: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={50} step={0.01} onChange={(v) => set({ intensity: v })} />
          <Slider label="Scrim width" value={p.width} min={0.1} max={1.5} step={0.01} onChange={(v) => set({ width: v })} />
          <Slider label="Scrim height" value={p.height} min={0.1} max={1.5} step={0.01} onChange={(v) => set({ height: v })} />
          <Slider label="Light X" value={p.lightX} min={-1} max={1} step={0.01} onChange={(v) => set({ lightX: v })} />
          <Slider label="Light Y" value={p.lightY} min={-1} max={1} step={0.01} onChange={(v) => set({ lightY: v })} />
          <Slider label="Light distance" value={p.lightZ} min={0.05} max={3} step={0.01} onChange={(v) => set({ lightZ: v })} />
          <Slider label="Light size" value={p.lightSize} min={0} max={1.5} step={0.01} onChange={(v) => set({ lightSize: v })} />
          <Slider label="Falloff" value={p.falloff} min={0.1} max={6} step={0.05} onChange={(v) => set({ falloff: v })} />
          <Slider label="Diffusion" value={p.diffusion} min={0} max={1} step={0.01} onChange={(v) => set({ diffusion: v })} />
          <Slider label="Edge softness" value={p.edgeSoftness} min={0} max={1} step={0.005} onChange={(v) => set({ edgeSoftness: v })} />
          <Slider label="Frame" value={p.frame} min={0} max={0.6} step={0.005} onChange={(v) => set({ frame: v })} />
        </>
      );
    }
    case 'sky': {
      const p = c.p;
      return (
        <>
          <Slider label="Sun azimuth" value={p.sunAzimuth} min={0} max={360} step={1} unit="°" onChange={(v) => set({ sunAzimuth: v })} />
          <Slider label="Sun elevation" value={p.sunElevation} min={-45} max={90} step={0.5} unit="°" onChange={(v) => set({ sunElevation: v })} />
          <Slider label="Sun size" value={p.sunSize} min={0.2} max={6} step={0.05} onChange={(v) => set({ sunSize: v })} />
          <Slider label="Sun intensity" value={p.sunIntensity} min={0} max={500} step={0.5} onChange={(v) => set({ sunIntensity: v })} />
          <Slider label="Turbidity" value={p.turbidity} min={1} max={10} step={0.1} onChange={(v) => set({ turbidity: v })} />
          <ColorPicker label="Zenith" color={p.zenithColor} onChange={(v) => set({ zenithColor: v })} />
          <ColorPicker label="Horizon" color={p.horizonColor} onChange={(v) => set({ horizonColor: v })} />
          <ColorPicker label="Ground" color={p.groundColor} onChange={(v) => set({ groundColor: v })} />
          <Slider label="Horizon line" value={p.horizon} min={-0.9} max={0.9} step={0.01} onChange={(v) => set({ horizon: v })} />
          <Slider label="Horizon softness" value={p.horizonSoftness} min={0} max={1} step={0.01} onChange={(v) => set({ horizonSoftness: v })} />
          <Slider label="Ground alpha" value={p.groundAlpha} min={0} max={1} step={0.01} onChange={(v) => set({ groundAlpha: v })} />
          <Slider label="Sky falloff" value={p.falloff} min={0.1} max={4} step={0.05} onChange={(v) => set({ falloff: v })} />
          <Slider label="Intensity" value={p.intensity} min={0} max={20} step={0.01} onChange={(v) => set({ intensity: v })} />
          <ImagePicker label="Clouds" value={p.cloudsImageId} onChange={(id) => set({ cloudsImageId: id })} />
          {p.cloudsImageId && <Slider label="Clouds amount" value={p.cloudsAmount} min={0} max={1} step={0.01} onChange={(v) => set({ cloudsAmount: v })} />}
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
}> = ({ layer, section, aspect, onLayer, onRemove, onMove }) => {
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
            <ContentControls layer={layer} aspect={aspect} onLayer={onLayer} />
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
}

export const AppearanceEditor: React.FC<EditorProps> = ({ appearance, aspect, onChange }) => {
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
      <LayerCard layer={appearance.master} section="master" aspect={aspect} onLayer={(l) => onChange({ ...appearance, master: l })} />

      <div className="section-header" style={{ marginTop: 10 }}>Value Blend</div>
      {appearance.valueBlend.map((l, i) => (
        <LayerCard
          key={l.id}
          layer={l}
          section="valueBlend"
          aspect={aspect}
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
      <Slider label="Texture scale" value={g.scale} min={0.1} max={5} step={0.01} unit="x" onChange={(v) => setG({ scale: v })} />
      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <Toggle label="Flip X" checked={g.flipX} variant="glossy" onChange={(v) => setG({ flipX: v })} />
        <Toggle label="Flip Y" checked={g.flipY} variant="glossy" onChange={(v) => setG({ flipY: v })} />
      </div>
    </div>
  );
};
