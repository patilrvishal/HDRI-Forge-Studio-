import React, { useEffect, useRef, useState } from 'react';
import './modeling.css';
import { useModelingStore, type Falloff, type MenuKind, type OpField, type PivotMode, type SnapTarget } from '../../store/modelingStore';
import { getModelingController } from '../../modeling/bridge';
import { MENUS, contextMenuFor, type MenuItem } from '../../modeling/menus';
import { objectKey } from '../../three/objectBinding';
import { useObjectHdriStore } from '../../store/objectHdriStore';
import { useLightsStore } from '../../store/lightsStore';
import { enableObjectLight, disableObjectLight, setIncludeInHdri } from '../../three/objectLightApi';
import { SliderNumberField } from '../UI/SliderNumberField';
import {
  brightnessToIntensity, intensityToBrightness,
  INTENSITY_SLIDER_MAX, INTENSITY_INPUT_MAX, INTENSITY_STEP,
} from '../../utils/lightIntensity';

const ctl = () => getModelingController();

const Ico = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  vert: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M5 5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0 M19 19m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0',
  edge: 'M5 19L19 5 M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  face: 'M4 6l8-3 8 3v12l-8 3-8-3z M4 6l8 3 8-3 M12 9v12',
  select: 'M5 3l14 8-6 2-2 6z',
  box: 'M4 4h16v16H4z',
  circle: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
  lasso: 'M5 9c0-3 4-5 8-5s7 2 7 5-3 5-7 5c-1 0-2 0-3-.5L7 19l1-4C6 14 5 11 5 9z',
  knife: 'M4 20L18 6l2 2-8 12z M18 6l2-2',
  loopcut: 'M3 8h18 M3 16h18 M12 4v16',
  poly: 'M5 19l4-12 6 3 4 9z',
  cursor: 'M12 3v6 M12 15v6 M3 12h6 M15 12h6',
  chev: 'M6 9l6 6 6-6',
};

function MenuList({ items, flip }: { items: MenuItem[]; flip: boolean }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.sep) return <div key={i} className="mdl-hr" />;
        if (it.title && !it.label) return <div key={i} className="mdl-menu-title">{it.title}</div>;
        return (
          <div
            key={i}
            className={'mdl-item' + (flip ? ' flip' : '')}
            onClick={(e) => {
              e.stopPropagation();
              if (it.cmd) ctl()?.exec(it.cmd);
            }}
          >
            <span>{it.label}</span>
            {it.sub ? <span className="arrow">▸</span> : it.key ? <kbd>{it.key}</kbd> : null}
            {it.sub && (
              <div className="mdl-glass mdl-submenu">
                <MenuList items={it.sub} flip={flip} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function MenuPopup() {
  const menu = useModelingStore((s) => s.menu);
  const selectMode = useModelingStore((s) => s.selectMode);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!menu || !ref.current) return;
    const parent = ref.current.parentElement?.getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    if (!parent) return;
    setPos({
      left: Math.max(6, Math.min(menu.x, parent.width - r.width - 6)),
      top: Math.max(6, Math.min(menu.y, parent.height - r.height - 6)),
    });
  }, [menu]);
  if (!menu || !menu.kind) return null;
  const items: MenuItem[] = menu.kind === 'context' ? contextMenuFor(selectMode) : MENUS[menu.kind as Exclude<MenuKind, null>] ?? [];
  const flip = pos.left > 500;
  return (
    <div ref={ref} className="mdl-glass mdl-menu" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} flip={flip} />
    </div>
  );
}

function Header() {
  const s = useModelingStore();
  const edit = s.mode === 'edit';
  const c = ctl();
  const openMenuAtButton = (kind: MenuKind, e: React.MouseEvent) => {
    const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const parent = (e.currentTarget as HTMLElement).closest('.mdl-root')!.getBoundingClientRect();
    s.set({ menu: s.menu?.kind === kind ? null : { kind, x: btn.left - parent.left, y: btn.bottom - parent.top + 4 } });
  };
  return (
    <div className="mdl-glass mdl-header" onPointerDown={(e) => e.stopPropagation()}>
      <button className={'mdl-btn mode' + (edit ? ' edit' : '')} title="Toggle Object / Edit Mode (Tab)" onClick={() => c?.toggleMode()}>
        {edit ? 'Edit Mode' : 'Object Mode'} <kbd>Tab</kbd>
      </button>
      <button className="mdl-btn" onClick={(e) => openMenuAtButton('add', e)} title="Add a mesh primitive (Shift+A)">
        Add <Ico d={ICONS.chev} size={11} />
      </button>
      {edit && (
        <>
          <span className="mdl-sep" />
          <button className={'mdl-btn icon' + (s.selectMode === 'vert' ? ' active' : '')} title="Vertex select (1)" onClick={() => c?.setSelectMode('vert')}>
            <Ico d={ICONS.vert} />
          </button>
          <button className={'mdl-btn icon' + (s.selectMode === 'edge' ? ' active' : '')} title="Edge select (2)" onClick={() => c?.setSelectMode('edge')}>
            <Ico d={ICONS.edge} />
          </button>
          <button className={'mdl-btn icon' + (s.selectMode === 'face' ? ' active' : '')} title="Face select (3)" onClick={() => c?.setSelectMode('face')}>
            <Ico d={ICONS.face} />
          </button>
          <span className="mdl-sep" />
          <button className="mdl-btn" onClick={(e) => openMenuAtButton('select', e)}>Select <Ico d={ICONS.chev} size={11} /></button>
          <button className="mdl-btn" onClick={(e) => openMenuAtButton('mesh', e)}>Mesh <Ico d={ICONS.chev} size={11} /></button>
          <button className="mdl-btn" onClick={(e) => openMenuAtButton(s.selectMode === 'vert' ? 'vertex' : s.selectMode === 'edge' ? 'edge' : 'face', e)}>
            {s.selectMode === 'vert' ? 'Vertex' : s.selectMode === 'edge' ? 'Edge' : 'Face'} <Ico d={ICONS.chev} size={11} />
          </button>
          <span className="mdl-sep" />
          <button className={'mdl-btn' + (s.xray ? ' active' : '')} title="Toggle X-Ray (Alt+Z)" onClick={() => c?.setXray(!s.xray)}>X-Ray</button>
          <button className={'mdl-btn' + (s.proportional.enabled ? ' active' : '')} title="Proportional editing (O)" onClick={() => s.set({ proportional: { ...s.proportional, enabled: !s.proportional.enabled } })}>
            Prop
          </button>
          {s.proportional.enabled && (
            <select className="mdl-select" value={s.proportional.falloff} onChange={(e) => s.set({ proportional: { ...s.proportional, falloff: e.target.value as Falloff } })} title="Falloff (Shift+O)">
              {['smooth', 'sphere', 'root', 'inverse', 'sharp', 'linear', 'constant', 'random'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}
          <button className={'mdl-btn' + (s.snapping.enabled ? ' active' : '')} title="Snapping (Shift+Tab)" onClick={() => s.set({ snapping: { ...s.snapping, enabled: !s.snapping.enabled } })}>
            Snap
          </button>
          {s.snapping.enabled && (
            <select className="mdl-select" value={s.snapping.target} onChange={(e) => s.set({ snapping: { ...s.snapping, target: e.target.value as SnapTarget } })}>
              <option value="increment">Increment</option>
              <option value="vertex">Vertex</option>
              <option value="edge">Edge</option>
              <option value="face">Face</option>
            </select>
          )}
          <select className="mdl-select" title="Pivot point" value={s.pivot} onChange={(e) => s.set({ pivot: e.target.value as PivotMode })}>
            <option value="median">Median</option>
            <option value="bounds">Bounding Box</option>
            <option value="cursor">3D Cursor</option>
            <option value="active">Active Element</option>
          </select>
          <select className="mdl-select" title="Transform orientation" value={s.orientation} onChange={(e) => s.set({ orientation: e.target.value as 'global' | 'local' | 'normal' | 'view' })}>
            <option value="global">Global</option>
            <option value="local">Local</option>
            <option value="normal">Normal</option>
            <option value="view">View</option>
          </select>
        </>
      )}
      <button className={'mdl-btn' + (s.npanel ? ' active' : '')} title="Item / Material panel (N)" onClick={() => s.set({ npanel: !s.npanel })}>N</button>
    </div>
  );
}

function ToolStrip() {
  const s = useModelingStore();
  const c = ctl();
  if (s.mode !== 'edit') return null;
  const tools: { id: typeof s.tool; icon: string; tip: string; act?: () => void }[] = [
    { id: 'select', icon: ICONS.select, tip: 'Select (click)' },
    { id: 'box', icon: ICONS.box, tip: 'Box Select (B)' },
    { id: 'circle', icon: ICONS.circle, tip: 'Circle Select (C)' },
    { id: 'lasso', icon: ICONS.lasso, tip: 'Lasso Select' },
    { id: 'knife', icon: ICONS.knife, tip: 'Knife (K)' },
    { id: 'loopcut', icon: ICONS.loopcut, tip: 'Loop Cut (Ctrl+R)' },
    { id: 'polybuild', icon: ICONS.poly, tip: 'Poly Build (Shift+Space, P)' },
    { id: 'cursor', icon: ICONS.cursor, tip: '3D Cursor (click to place)' },
  ];
  return (
    <div className="mdl-glass mdl-tools" onPointerDown={(e) => e.stopPropagation()}>
      {tools.map((t) => (
        <button key={t.id} data-tip={t.tip} className={'mdl-btn' + (s.tool === t.id ? ' active' : '')} onClick={() => (t.id === 'knife' ? c?.startKnife() : t.id === 'loopcut' ? c?.startLoopCut() : c?.persistTool(t.id))}>
          <Ico d={t.icon} />
        </button>
      ))}
    </div>
  );
}

function Stats() {
  const s = useModelingStore();
  if (!s.showStats || !s.activeId) return null;
  const st = s.stats;
  const obj = s.objects.find((o) => o.id === s.activeId);
  return (
    <div className="mdl-glass mdl-stats">
      <div className="obj">{obj?.name}</div>
      {s.mode === 'edit' ? (
        <>
          <div>Vertices <b>{st.vertsSel}</b> / {st.vertsTotal}</div>
          <div>Edges <b>{st.edgesSel}</b> / {st.edgesTotal}</div>
          <div>Faces <b>{st.facesSel}</b> / {st.facesTotal}</div>
          <div>Triangles <b>{st.tris}</b></div>
        </>
      ) : (
        <>
          <div>Vertices <b>{st.vertsTotal}</b></div>
          <div>Edges <b>{st.edgesTotal}</b></div>
          <div>Faces <b>{st.facesTotal}</b></div>
          <div>Triangles <b>{st.tris}</b></div>
        </>
      )}
    </div>
  );
}

function StatusStrip() {
  const modal = useModelingStore((s) => s.modal);
  const hint = useModelingStore((s) => s.hint);
  if (!modal) return null;
  return (
    <div className="mdl-glass mdl-status">
      <div>
        <span className="title">{modal.title}</span>
        <span className="text">{modal.text}</span>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function FieldInput({ f, onChange }: { f: OpField; onChange: (v: number | boolean | string) => void }) {
  if (f.type === 'bool') return <input className="mdl-check" type="checkbox" checked={Boolean(f.value)} onChange={(e) => onChange(e.target.checked)} />;
  if (f.type === 'enum')
    return (
      <select className="mdl-select" value={String(f.value)} onChange={(e) => onChange(e.target.value)}>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  return <NumInput value={Number(f.value)} step={f.step} min={f.min} max={f.max} onCommit={(v) => onChange(v)} />;
}

function NumInput({ value, step = 0.1, min, max, onCommit }: { value: number; step?: number; min?: number; max?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(round(value)));
  }, [value]);
  const commit = () => {
    let v = parseFloat(text);
    if (!Number.isFinite(v)) {
      setText(String(round(value)));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onCommit(v);
  };
  return (
    <input
      className="mdl-num"
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const v = parseFloat(text) + (e.key === 'ArrowUp' ? step : -step);
          setText(String(round(v)));
          onCommit(v);
        }
      }}
    />
  );
}
const round = (n: number) => Math.round(n * 10000) / 10000;

function LastOpPanel() {
  const op = useModelingStore((s) => s.lastOp);
  const [open, setOpen] = useState(true);
  if (!op) return null;
  const change = (key: string, v: number | boolean | string) => {
    const vals: Record<string, number | boolean | string> = {};
    for (const f of op.fields) vals[f.key] = f.key === key ? v : f.value;
    ctl()?.editLastOp(vals);
  };
  return (
    <div className="mdl-glass mdl-panel mdl-lastop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mdl-panel-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} {op.name}</span>
        <span className="mdl-badge" onClick={(e) => { e.stopPropagation(); ctl()?.clearLastOp(); }}>×</span>
      </div>
      {open && (
        <div className="mdl-panel-body">
          {op.fields.map((f) => (
            <div key={f.key} className="mdl-field">
              <label>{f.label}</label>
              <FieldInput f={f} onChange={(v) => change(f.key, v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NPanel() {
  const s = useModelingStore();
  const c = ctl();
  if (!s.npanel) return null;
  const it = s.item;
  return (
    <div className="mdl-glass mdl-panel mdl-npanel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mdl-panel-head"><span>Item</span></div>
      <div className="mdl-panel-body">
        {!it && <div style={{ color: 'var(--text-dim)' }}>Select a mesh (click it, or Shift+A to add one).</div>}
        {it && (
          <>
            <input
              className="mdl-txt"
              defaultValue={it.label}
              key={it.label}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              onBlur={(e) => c?.renameActive(e.target.value)}
            />
            {s.mode === 'edit' && it.median && (
              <>
                <div className="mdl-h">Median</div>
                <div className="mdl-xyz">
                  {[0, 1, 2].map((i) => (
                    <NumInput key={i} value={it.median![i]} onCommit={(v) => c?.setMedian(i as 0 | 1 | 2, v)} />
                  ))}
                </div>
              </>
            )}
            <div className="mdl-h">Location</div>
            <div className="mdl-xyz">
              {[0, 1, 2].map((i) => (
                <NumInput key={i} value={it.loc[i]} onCommit={(v) => c?.setObjectTransform('loc', i as 0 | 1 | 2, v)} />
              ))}
            </div>
            <div className="mdl-h">Rotation (deg)</div>
            <div className="mdl-xyz">
              {[0, 1, 2].map((i) => (
                <NumInput key={i} step={1} value={(it.rot[i] * 180) / Math.PI} onCommit={(v) => c?.setObjectTransform('rot', i as 0 | 1 | 2, v)} />
              ))}
            </div>
            <div className="mdl-h">Scale</div>
            <div className="mdl-xyz">
              {[0, 1, 2].map((i) => (
                <NumInput key={i} value={it.scale[i]} onCommit={(v) => c?.setObjectTransform('scale', i as 0 | 1 | 2, v)} />
              ))}
            </div>
            {it.material && (
              <>
                <div className="mdl-h">Material</div>
                <div className="mdl-field"><label>Color</label><input className="mdl-color" type="color" value={it.material.color} onChange={(e) => c?.setMaterial({ color: e.target.value })} /></div>
                <div className="mdl-field"><label>Roughness</label><input className="mdl-range" type="range" min={0} max={1} step={0.01} value={it.material.roughness} onChange={(e) => c?.setMaterial({ roughness: parseFloat(e.target.value) })} /></div>
                <div className="mdl-field"><label>Metalness</label><input className="mdl-range" type="range" min={0} max={1} step={0.01} value={it.material.metalness} onChange={(e) => c?.setMaterial({ metalness: parseFloat(e.target.value) })} /></div>
                <div className="mdl-field"><label>Clearcoat</label><input className="mdl-range" type="range" min={0} max={1} step={0.01} value={it.material.clearcoat} onChange={(e) => c?.setMaterial({ clearcoat: parseFloat(e.target.value) })} /></div>
                <div className="mdl-field"><label>Emission</label><input className="mdl-color" type="color" value={it.material.emissive} onChange={(e) => c?.setMaterial({ emissive: e.target.value })} /></div>
                <HdriLightQuick />
                <div className="mdl-field"><label>Shading</label>
                  <select className="mdl-select" value={it.smooth ? 'smooth' : 'flat'} onChange={(e) => c?.toggleSmooth(e.target.value === 'smooth')}>
                    <option value="flat">Flat</option>
                    <option value="smooth">Smooth</option>
                  </select>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Quick HDRI include / use-as-light toggles for the active mesh. Full controls live in the Properties panel. */
function HdriLightQuick() {
  const c = ctl();
  const obj = c?.active?.object;
  const key = obj ? objectKey(obj) : '';
  const included = useObjectHdriStore((s) => !!s.settings[key]?.include);
  const light = useLightsStore((s) => s.lights.find((l) => l.objectKey === key));
  if (!obj) return null;
  return (
    <>
      <div className="mdl-h">HDRI &amp; Light</div>
      <div className="mdl-field">
        <label>Include in HDRI</label>
        <input className="mdl-check" type="checkbox" checked={included} onChange={(e) => setIncludeInHdri(obj, e.target.checked)} />
      </div>
      <div className="mdl-field">
        <label>Use as light</label>
        <input className="mdl-check" type="checkbox" checked={!!light} onChange={(e) => (e.target.checked ? enableObjectLight(obj) : disableObjectLight(key))} />
      </div>
      {light && (
        <div className="mdl-field">
          <label>Intensity</label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              className="mdl-range" style={{ width: 80 }} type="range" min={0} max={INTENSITY_SLIDER_MAX} step={INTENSITY_STEP}
              value={brightnessToIntensity(light.brightness)}
              onChange={(e) => useLightsStore.getState().updateLight(light.id, { brightness: intensityToBrightness(parseFloat(e.target.value)) })}
            />
            <SliderNumberField
              className="mdl-num" style={{ width: 52 }} label="Intensity"
              value={brightnessToIntensity(light.brightness)} min={0} max={INTENSITY_INPUT_MAX} step={INTENSITY_STEP}
              onChange={(v) => useLightsStore.getState().updateLight(light.id, { brightness: intensityToBrightness(v) })}
            />
          </span>
        </div>
      )}
    </>
  );
}

function Toast() {
  const toast = useModelingStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className="mdl-glass mdl-toast">
      {toast.text}
    </div>
  );
}

/** Blender-style modelling UI drawn over the 3D viewport. */
export function ModelingOverlay() {
  return (
    <div className="mdl-root">
      <Header />
      <ToolStrip />
      <Stats />
      <StatusStrip />
      <LastOpPanel />
      <NPanel />
      <MenuPopup />
      <Toast />
    </div>
  );
}
