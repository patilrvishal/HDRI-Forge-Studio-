import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHDRIAssetStore, type HDRIAsset } from '../../store/hdriAssetStore';
import { getEditedImage, invalidateEdited, hasEdits, getSourceImage } from '../../hdriedit/envSource';
import { detectSun } from '../../hdriedit/apply';
import { driveViewportWith } from '../../hdriedit/viewportEnv';
import { EDIT_KIND_LABELS, newEditLayer, type EditKind, type EditLayer, type EditRegion, type SkyEnvParams } from '../../hdriedit/types';
import { linearToSrgbChannel } from '../../appearance/evaluate';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { Dropdown } from '../UI/Dropdown';
import { ColorPicker } from '../UI/ColorPicker';
import { FilterStackEditor } from '../Filters/FilterStackEditor';

const CW = 320, CH = 160;

type PickTarget = 'region' | 'source' | 'target';

/** Equirect preview of the edited map with the selected layer's region drawn on top. */
const EnvCanvas: React.FC<{
  asset: HDRIAsset;
  layer: EditLayer | null;
  pick: PickTarget | null;
  onPick: (u: number, v: number) => void;
}> = ({ asset, layer, pick, onPick }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<{ data: Float32Array; width: number; height: number } | null>(null);
  const sig = JSON.stringify([asset.edits, asset.sky, asset.dataBase64?.length]);

  useEffect(() => {
    let dead = false;
    const t = window.setTimeout(async () => {
      const im = await getEditedImage(asset, 512);
      if (!dead && im) setImg(im);
    }, 120);
    return () => { dead = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = CW; c.height = CH;
    const ctx = c.getContext('2d')!;
    const id = ctx.createImageData(CW, CH);
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const sx = Math.min(img.width - 1, Math.floor((x / CW) * img.width)), sy = Math.min(img.height - 1, Math.floor((y / CH) * img.height));
        const s = (sy * img.width + sx) * 4, o = (y * CW + x) * 4;
        for (let k = 0; k < 3; k++) {
          const v = Math.max(0, img.data[s + k]);
          id.data[o + k] = Math.round(linearToSrgbChannel(v / (1 + v * 0.25)) * 255);
        }
        id.data[o + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    if (layer && layer.region.shape !== 'global') drawRegion(ctx, layer.region, '#4af');
    if (layer?.edit.kind === 'fill' && layer.edit.p.mode === 'clone') marker(ctx, layer.edit.p.sourceU, layer.edit.p.sourceV, '#5f5');
    if (layer?.edit.kind === 'sun' && layer.edit.p.action === 'move') marker(ctx, layer.edit.p.targetU, layer.edit.p.targetV, '#fa4');
  }, [img, layer]);

  return (
    <canvas
      ref={ref}
      width={CW}
      height={CH}
      onClick={(e) => {
        if (!pick) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPick(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
      }}
      style={{ width: '100%', aspectRatio: '2 / 1', borderRadius: 4, border: '1px solid var(--border, #333)', cursor: pick ? 'crosshair' : 'default', background: '#111' }}
    />
  );
};

function marker(ctx: CanvasRenderingContext2D, u: number, v: number, col: string) {
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(u * CW, v * CH, 6, 0, Math.PI * 2); ctx.moveTo(u * CW - 10, v * CH); ctx.lineTo(u * CW + 10, v * CH); ctx.moveTo(u * CW, v * CH - 10); ctx.lineTo(u * CW, v * CH + 10); ctx.stroke();
}

/** Outline the region by sampling its boundary on the sphere. */
function drawRegion(ctx: CanvasRenderingContext2D, r: EditRegion, col: string) {
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  const c = uv2dir(r.u, r.v);
  const up0: [number, number, number] = Math.abs(c[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
  const rr = norm(cross(up0, c));
  const uu = cross(c, rr);
  ctx.beginPath();
  const N = 96;
  let prevX = 0;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    let x = Math.cos(a), y = Math.sin(a);
    let dist = r.size * (Math.PI / 180);
    if (r.shape === 'rect') {
      const roll = (r.rotation * Math.PI) / 180;
      // point on the rectangle boundary in the tangent plane
      const hw = Math.tan(Math.min(89, r.size) * (Math.PI / 180)), hh = Math.tan(Math.min(89, r.sizeV) * (Math.PI / 180));
      const m = Math.max(Math.abs(x) / hw, Math.abs(y) / hh);
      x /= m; y /= m;
      const rx = x * Math.cos(roll) - y * Math.sin(roll), ry = x * Math.sin(roll) + y * Math.cos(roll);
      const d = norm([c[0] + rr[0] * rx + uu[0] * ry, c[1] + rr[1] * rx + uu[1] * ry, c[2] + rr[2] * rx + uu[2] * ry]);
      const [u, v] = dir2uv(d);
      seg(ctx, i, u, v, prevX); prevX = u * CW;
      continue;
    }
    dist = Math.min(dist, Math.PI - 0.01);
    const d = norm([
      c[0] * Math.cos(dist) + (rr[0] * x + uu[0] * y) * Math.sin(dist),
      c[1] * Math.cos(dist) + (rr[1] * x + uu[1] * y) * Math.sin(dist),
      c[2] * Math.cos(dist) + (rr[2] * x + uu[2] * y) * Math.sin(dist),
    ]);
    const [u, v] = dir2uv(d);
    seg(ctx, i, u, v, prevX); prevX = u * CW;
  }
  ctx.stroke();
}
function seg(ctx: CanvasRenderingContext2D, i: number, u: number, v: number, prevX: number) {
  const x = u * CW, y = v * CH;
  if (i === 0 || Math.abs(x - prevX) > CW / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
}
type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const uv2dir = (u: number, v: number): V3 => { const th = (u - 0.5) * 2 * Math.PI, ph = v * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
const dir2uv = (d: V3): [number, number] => [Math.atan2(d[2], d[0]) / (2 * Math.PI) + 0.5, Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI];

// ── layer parameter editors ─────────────────────────────────────────────────

const RegionControls: React.FC<{ region: EditRegion; onChange: (r: EditRegion) => void; pick: PickTarget | null; setPick: (p: PickTarget | null) => void }> = ({ region, onChange, pick, setPick }) => (
  <div>
    <Dropdown label="Region" value={region.shape} options={[{ value: 'global', label: 'Whole map' }, { value: 'circle', label: 'Circle' }, { value: 'rect', label: 'Rectangle' }]} onChange={(v) => onChange({ ...region, shape: v as EditRegion['shape'] })} />
    {region.shape !== 'global' && (
      <>
        <button className="btn-sm" style={{ margin: '2px 0 4px', outline: pick === 'region' ? '1px solid var(--accent-bright, #4af)' : 'none' }} onClick={() => setPick(pick === 'region' ? null : 'region')}>
          {pick === 'region' ? 'Click the map…' : 'Pick position on map'}
        </button>
        <Slider label={region.shape === 'circle' ? 'Radius' : 'Half width'} value={region.size} min={0.5} max={region.shape === 'circle' ? 179 : 85} step={0.5} unit="°" onChange={(v) => onChange({ ...region, size: v })} />
        {region.shape === 'rect' && (
          <>
            <Slider label="Half height" value={region.sizeV} min={0.5} max={85} step={0.5} unit="°" onChange={(v) => onChange({ ...region, sizeV: v })} />
            <Slider label="Roll" value={region.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => onChange({ ...region, rotation: v })} />
          </>
        )}
        <Slider label="Feather" value={region.feather} min={0} max={100} step={1} unit="%" onChange={(v) => onChange({ ...region, feather: v })} />
        <Toggle label="Invert" checked={region.invert} variant="glossy" onChange={(v) => onChange({ ...region, invert: v })} />
      </>
    )}
  </div>
);

const LayerParams: React.FC<{ asset: HDRIAsset; layer: EditLayer; onLayer: (l: EditLayer) => void; pick: PickTarget | null; setPick: (p: PickTarget | null) => void }> = ({ asset, layer, onLayer, pick, setPick }) => {
  const e = layer.edit;
  const others = useHDRIAssetStore((s) => s.assets).filter((a) => a.id !== asset.id);
  const [sunInfo, setSunInfo] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setP = (patch: Record<string, any>) => onLayer({ ...layer, edit: { ...e, p: { ...e.p, ...patch } } as EditLayer['edit'] });
  switch (e.kind) {
    case 'adjust':
      return (
        <>
          <Slider label="Exposure" value={e.p.exposure} min={-6} max={6} step={0.05} unit=" EV" onChange={(v) => setP({ exposure: v })} />
          <Slider label="Hue" value={e.p.hue} min={-180} max={180} step={1} unit="°" onChange={(v) => setP({ hue: v })} />
          <Slider label="Saturation" value={e.p.saturation} min={-100} max={100} step={1} onChange={(v) => setP({ saturation: v })} />
          <Slider label="Contrast" value={e.p.contrast} min={-100} max={100} step={1} onChange={(v) => setP({ contrast: v })} />
          <Slider label="Gamma" value={e.p.gamma} min={0.2} max={3} step={0.01} onChange={(v) => setP({ gamma: v })} />
          <ColorPicker label="Tint" color={e.p.tint} onChange={(v) => setP({ tint: v })} />
          <Slider label="Tint amount" value={e.p.tintAmount} min={0} max={100} step={1} unit="%" onChange={(v) => setP({ tintAmount: v })} />
        </>
      );
    case 'blur':
      return <FilterStackEditor spherical filters={e.p.filters} onChange={(f) => setP({ filters: f })} />;
    case 'blocker':
      return (
        <>
          <Dropdown label="Mode" value={e.p.mode} options={[{ value: 'multiply', label: 'Darken (block light)' }, { value: 'solid', label: 'Solid colour card' }]} onChange={(v) => setP({ mode: v })} />
          <Slider label="Amount" value={e.p.amount} min={0} max={100} step={1} unit="%" onChange={(v) => setP({ amount: v })} />
          {e.p.mode === 'solid' && (
            <>
              <ColorPicker label="Colour" color={e.p.color} onChange={(v) => setP({ color: v })} />
              <Slider label="Intensity" value={e.p.intensity} min={0} max={50} step={0.05} onChange={(v) => setP({ intensity: v })} />
            </>
          )}
        </>
      );
    case 'fill':
      return (
        <>
          <Dropdown label="Mode" value={e.p.mode} options={[{ value: 'remove', label: 'Remove (fill from surroundings)' }, { value: 'clone', label: 'Clone from another area' }]} onChange={(v) => setP({ mode: v })} />
          {e.p.mode === 'remove' ? (
            <Slider label="Smear" value={e.p.smear} min={0} max={100} step={1} unit="%" onChange={(v) => setP({ smear: v })} />
          ) : (
            <button className="btn-sm" style={{ outline: pick === 'source' ? '1px solid var(--accent-bright, #4af)' : 'none' }} onClick={() => setPick(pick === 'source' ? null : 'source')}>
              {pick === 'source' ? 'Click the source…' : 'Pick clone source on map'}
            </button>
          )}
        </>
      );
    case 'sun':
      return (
        <>
          <Dropdown label="Action" value={e.p.action} options={[{ value: 'resize', label: 'Resize (keeps energy)' }, { value: 'remove', label: 'Remove' }, { value: 'move', label: 'Move' }]} onChange={(v) => setP({ action: v })} />
          {e.p.action !== 'remove' && <Slider label="Size" value={e.p.scale} min={0.1} max={8} step={0.05} unit="x" onChange={(v) => setP({ scale: v })} />}
          {e.p.action !== 'remove' && <Slider label="Energy" value={e.p.intensity} min={0} max={4} step={0.01} unit="x" onChange={(v) => setP({ intensity: v })} />}
          <Slider label="Threshold" value={e.p.threshold} min={1} max={90} step={1} unit="%" onChange={(v) => setP({ threshold: v })} />
          {e.p.action === 'move' && (
            <button className="btn-sm" style={{ outline: pick === 'target' ? '1px solid var(--accent-bright, #4af)' : 'none' }} onClick={() => setPick(pick === 'target' ? null : 'target')}>
              {pick === 'target' ? 'Click the new position…' : 'Pick new position on map'}
            </button>
          )}
          <button
            className="btn-sm"
            style={{ marginLeft: 6 }}
            onClick={async () => {
              const src = await getSourceImage(asset);
              const f = src ? detectSun(src, layer.region, e.p.threshold) : null;
              setSunInfo(f ? `Found at u=${f.info.u.toFixed(3)} v=${f.info.v.toFixed(3)} - ${f.info.pixels} px, radius ${((f.info.radius * 180) / Math.PI).toFixed(2)}°, peak ${f.info.peak.toFixed(0)}` : 'No bright spot in the region.');
            }}
          >
            Detect
          </button>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>{sunInfo || 'Pick the sun with the region tool first (position it over the sun).'}</div>
        </>
      );
    case 'mix':
      return (
        <>
          <Dropdown label="Source" value={e.p.assetId ?? ''} options={[{ value: '', label: '(choose an HDRI)' }, ...others.map((a) => ({ value: a.id, label: a.name }))]} onChange={(v) => setP({ assetId: v || null })} />
          <Slider label="Rotation" value={e.p.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => setP({ rotation: v })} />
          <Dropdown label="Blend" value={e.p.blend} options={[{ value: 'normal', label: 'Replace' }, { value: 'add', label: 'Add' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }]} onChange={(v) => setP({ blend: v })} />
          <Slider label="Intensity" value={e.p.intensity} min={0} max={10} step={0.01} onChange={(v) => setP({ intensity: v })} />
        </>
      );
  }
};

const SkyControls: React.FC<{ sky: SkyEnvParams; onChange: (s: SkyEnvParams) => void }> = ({ sky, onChange }) => {
  const set = (patch: Partial<SkyEnvParams>) => onChange({ ...sky, ...patch });
  return (
    <div>
      <Slider label="Sun azimuth" value={sky.sunAzimuth} min={0} max={360} step={1} unit="°" onChange={(v) => set({ sunAzimuth: v })} />
      <Slider label="Sun elevation" value={sky.sunElevation} min={-30} max={90} step={0.5} unit="°" onChange={(v) => set({ sunElevation: v })} />
      <Slider label="Sun size" value={sky.sunSize} min={0.2} max={12} step={0.05} unit="x" onChange={(v) => set({ sunSize: v })} />
      <Slider label="Sun intensity" value={sky.sunIntensity} min={0} max={200000} step={100} onChange={(v) => set({ sunIntensity: v })} />
      <ColorPicker label="Sun colour" color={sky.sunColor} onChange={(v) => set({ sunColor: v })} />
      <Slider label="Turbidity" value={sky.turbidity} min={1} max={10} step={0.1} onChange={(v) => set({ turbidity: v })} />
      <ColorPicker label="Zenith" color={sky.zenithColor} onChange={(v) => set({ zenithColor: v })} />
      <ColorPicker label="Horizon" color={sky.horizonColor} onChange={(v) => set({ horizonColor: v })} />
      <ColorPicker label="Ground" color={sky.groundColor} onChange={(v) => set({ groundColor: v })} />
      <Slider label="Horizon softness" value={sky.horizonSoftness} min={0.005} max={0.5} step={0.005} onChange={(v) => set({ horizonSoftness: v })} />
      <Slider label="Sky falloff" value={sky.falloff} min={0.1} max={4} step={0.05} onChange={(v) => set({ falloff: v })} />
      <Slider label="Sky brightness" value={sky.intensity} min={0} max={10} step={0.01} onChange={(v) => set({ intensity: v })} />
      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>A larger or smaller sun keeps the same energy, so changing its size softens or sharpens shadows without changing exposure.</div>
    </div>
  );
};

/**
 * Edit HDRI Environments: a non-destructive layer stack on the selected HDRI, plus procedural sky controls.
 */
export const EditHdriSection: React.FC<{ asset: HDRIAsset }> = ({ asset }) => {
  const updateAsset = useHDRIAssetStore((s) => s.updateAsset);
  const layers = asset.edits ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [addKind, setAddKind] = useState<EditKind>('adjust');
  const sel = useMemo(() => layers.find((l) => l.id === selId) ?? null, [layers, selId]);

  const setLayers = (next: EditLayer[]) => { invalidateEdited(asset.id); updateAsset(asset.id, { edits: next }); };
  const setLayer = (l: EditLayer) => setLayers(layers.map((x) => (x.id === l.id ? l : x)));

  const onPick = (u: number, v: number) => {
    if (!sel) return;
    if (pick === 'region') setLayer({ ...sel, region: { ...sel.region, u, v, shape: sel.region.shape === 'global' ? 'circle' : sel.region.shape } });
    else if (pick === 'source' && sel.edit.kind === 'fill') setLayer({ ...sel, edit: { ...sel.edit, p: { ...sel.edit.p, sourceU: u, sourceV: v } } });
    else if (pick === 'target' && sel.edit.kind === 'sun') setLayer({ ...sel, edit: { ...sel.edit, p: { ...sel.edit.p, targetU: u, targetV: v } } });
    setPick(null);
  };

  return (
    <div style={{ padding: '4px 0' }}>
      <EnvCanvas asset={asset} layer={sel} pick={pick} onPick={onPick} />
      <div style={{ fontSize: 9, color: 'var(--text-dim)', margin: '3px 0 6px' }}>Map in its own orientation (before the Rotation setting).</div>

      {asset.kind === 'sky' && asset.sky && (
        <>
          <div className="section-header">Sky</div>
          <SkyControls sky={asset.sky} onChange={(s) => { invalidateEdited(asset.id); updateAsset(asset.id, { sky: s }); }} />
        </>
      )}

      <div className="section-header" style={{ marginTop: 8 }}>Edit layers</div>
      {layers.map((l, i) => (
        <div
          key={l.id}
          onClick={() => { setSelId(l.id); setPick(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, cursor: 'pointer', background: l.id === selId ? 'rgba(80,160,255,0.15)' : 'transparent', marginBottom: 2 }}
        >
          <span onClick={(e) => e.stopPropagation()}><Toggle checked={l.enabled} onChange={(v) => setLayer({ ...l, enabled: v })} /></span>
          <span style={{ flex: 1, fontSize: 11 }}>{l.name}</span>
          <button className="btn-sm" title="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); const a = [...layers]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setLayers(a); }}>↑</button>
          <button className="btn-sm" title="Move down" disabled={i === layers.length - 1} onClick={(e) => { e.stopPropagation(); const a = [...layers]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setLayers(a); }}>↓</button>
          <button className="btn-sm" title="Delete" onClick={(e) => { e.stopPropagation(); setLayers(layers.filter((x) => x.id !== l.id)); if (selId === l.id) setSelId(null); }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <Dropdown value={addKind} options={(Object.keys(EDIT_KIND_LABELS) as EditKind[]).map((k) => ({ value: k, label: EDIT_KIND_LABELS[k] }))} onChange={(v) => setAddKind(v as EditKind)} />
        <button
          className="btn-sm"
          onClick={() => {
            const l = newEditLayer(addKind);
            setLayers([...layers, l]);
            setSelId(l.id);
          }}
        >
          + Add layer
        </button>
      </div>

      {sel && (
        <div style={{ marginTop: 8, border: '1px solid var(--border, #3a3a3a)', borderRadius: 6, padding: 6 }}>
          <div className="field-row" style={{ marginBottom: 6 }}>
            <span className="field-label">Name</span>
            <input className="field-input" value={sel.name} onChange={(e) => setLayer({ ...sel, name: e.target.value })} />
          </div>
          <Slider label="Layer opacity" value={sel.opacity} min={0} max={100} step={1} unit="%" onChange={(v) => setLayer({ ...sel, opacity: v })} />
          <RegionControls region={sel.region} onChange={(r) => setLayer({ ...sel, region: r })} pick={pick} setPick={setPick} />
          <div className="section-header" style={{ marginTop: 6 }}>{EDIT_KIND_LABELS[sel.edit.kind]}</div>
          <LayerParams asset={asset} layer={sel} onLayer={setLayer} pick={pick} setPick={setPick} />
        </div>
      )}

      {hasEdits(asset) && (
        <button className="btn-sm" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => void driveViewportWith(asset.id)}>
          Show in the 3D viewport
        </button>
      )}
    </div>
  );
};
