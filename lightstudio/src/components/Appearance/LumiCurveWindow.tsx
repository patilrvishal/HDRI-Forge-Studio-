import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLumiCurveWindowStore } from '../../store/lumiCurveWindowStore';
import { useLightsStore } from '../../store/lightsStore';
import type { ContentLayer, CurvePoint, LightAppearance, LumiCurveParams } from '../../appearance/types';
import { sampleCurve, smoothTangents, pointOffsetDir } from '../../appearance/evaluate';
import { renderTexture } from '../../appearance/textures';

/**
 * The floating Lumi-Curve Editor (HDR Light Studio style): a black canvas that shows the light as it is rendered right now,
 * the curve on top of it with its tangent handles, a green and a blue handle on the selected point that set how far the glow
 * reaches on each side, and a toolbar down each side. Everything dragged here changes the light at once, so the reflections
 * on the model and the HDRI Erik receives follow the curve live.
 */

type Tool = 'move' | 'moveall' | 'add' | 'delete' | 'rotate' | 'scale';
type Hit = { kind: 'pt' | 'in' | 'out' | 'dir' | 'green' | 'blue'; i: number };

const VB = 300;                    // canvas size (square in the editor; the light's aspect is drawn inside it)

const Ico: React.FC<{ d: string; fill?: boolean }> = ({ d, fill }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  add: 'M5 17c3-8 11-8 14-12M16 14v6M13 17h6',
  del: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  all: 'M5 5h14v14H5zM12 8v8M8 12h8',
  rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  scale: 'M4 20l16-16M14 4h6v6M10 20H4v-6',
  flipV: 'M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5',
  flipH: 'M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5',
  smooth: 'M3 18c5 0 4-12 9-12s4 12 9 12M5 4l2 2M3 8l3 0',
  reset: 'M6 6l12 12M18 6L6 18',
  zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  pan: 'M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2 6-6 6-3 0-5-2-6-5l-1-3a1.5 1.5 0 0 1 3 0',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  fitAll: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5M9 9h6v6H9z',
  line: 'M3 12h18',
  snap: 'M7 4v8a5 5 0 0 0 10 0V4M7 8h4M13 8h4',
  preview: 'M4 5h16v14H4zM4 9h16',
};

function findLumi(app: LightAppearance): { layer: ContentLayer; where: 'master' | 'vb' | 'am'; idx: number } | null {
  if (app.master.content.type === 'lumicurve') return { layer: app.master, where: 'master', idx: 0 };
  for (let i = 0; i < app.valueBlend.length; i++) if (app.valueBlend[i].content.type === 'lumicurve') return { layer: app.valueBlend[i], where: 'vb', idx: i };
  for (let i = 0; i < app.alphaMultiply.length; i++) if (app.alphaMultiply[i].content.type === 'lumicurve') return { layer: app.alphaMultiply[i], where: 'am', idx: i };
  return null;
}

function withParams(app: LightAppearance, patch: Partial<LumiCurveParams>): LightAppearance {
  const f = findLumi(app);
  if (!f || f.layer.content.type !== 'lumicurve') return app;
  const layer = { ...f.layer, content: { ...f.layer.content, p: { ...f.layer.content.p, ...patch } } } as ContentLayer;
  if (f.where === 'master') return { ...app, master: layer };
  const key = f.where === 'vb' ? 'valueBlend' : 'alphaMultiply';
  const list = app[key].slice();
  list[f.idx] = layer;
  return { ...app, [key]: list };
}

export const LumiCurveWindow: React.FC = () => {
  const lightId = useLumiCurveWindowStore((s) => s.lightId);
  const close = useLumiCurveWindowStore((s) => s.close);
  const light = useLightsStore((s) => s.lights.find((l) => l.id === lightId) ?? null);
  const updateLight = useLightsStore((s) => s.updateLight);

  const [pos, setPos] = useState({ x: 360, y: 110 });
  const [tool, setTool] = useState<Tool>('move');
  const [sel, setSel] = useState(0);
  const [hover, setHover] = useState<Hit | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, cx: 0, cy: 0 });
  const [pan, setPan] = useState(false);
  const [snapGrid, setSnapGrid] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const svg = useRef<SVGSVGElement>(null);

  const app = light?.appearance ?? null;
  const found = app ? findLumi(app) : null;
  const params: LumiCurveParams | null = found && found.layer.content.type === 'lumicurve' ? found.layer.content.p : null;
  const aspect = light ? Math.max(0.05, (light.areaWidth ?? 2) / Math.max(0.05, light.areaHeight ?? 2)) : 1;

  // the light as it is rendered right now, drawn on black behind the curve
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!app || !showPreview) { setPreviewUrl(null); return; }
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      try {
        const tex = renderTexture(app, aspect, 220);
        const c = document.createElement('canvas');
        c.width = tex.width; c.height = tex.height;
        const ctx = c.getContext('2d')!;
        const img = ctx.createImageData(tex.width, tex.height);
        for (let i = 0; i < tex.width * tex.height; i++) {
          const a = tex.data[i * 4 + 3];
          for (let k = 0; k < 3; k++) {
            const v = Math.min(1, Math.max(0, tex.data[i * 4 + k] * a));
            img.data[i * 4 + k] = Math.round(255 * Math.pow(v, 1 / 2.2));
          }
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        setPreviewUrl(c.toDataURL('image/png'));
      } catch { setPreviewUrl(null); }
    });
    return () => { if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; } };
  }, [app, aspect, showPreview]);

  const pts = params?.points ?? [];
  const set = (patch: Partial<LumiCurveParams>) => {
    if (!light || !light.appearance) return;
    updateLight(light.id, { appearance: withParams(light.appearance, patch) });
  };
  const setPts = (next: CurvePoint[]) => set({ points: next });

  // the light's rectangle inside the square canvas, then the zoom / pan on top
  const rectW = aspect >= 1 ? VB * 0.9 : VB * 0.9 * aspect;
  const rectH = aspect >= 1 ? (VB * 0.9) / aspect : VB * 0.9;
  const px = (x: number) => VB / 2 + ((x - view.cx) * view.zoom * rectW) / 2;
  const py = (y: number) => VB / 2 - ((y - view.cy) * view.zoom * rectH) / 2;
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * VB, sy = ((e.clientY - r.top) / r.height) * VB;
    return { x: ((sx - VB / 2) * 2) / (view.zoom * rectW) + view.cx, y: -((sy - VB / 2) * 2) / (view.zoom * rectH) + view.cy };
  };
  const snapV = (v: number) => (snapGrid ? Math.round(v / 0.05) * 0.05 : v);

  const poly = useMemo(() => (params ? sampleCurve(params) : []), [params]);
  const m = Math.min(aspect, 1);

  /** The direction (unit, in aspect space) of the glow offset at a control point. */
  const offsetDir = (q: CurvePoint): { nx: number; ny: number } => {
    if (!params) return { nx: 0, ny: 1 };
    switch (params.offsetType) {
      case 'vertical': return { nx: 0, ny: 1 };
      case 'horizontal': return { nx: 1, ny: 0 };
      case 'angle': { const a = (params.offsetAngle * Math.PI) / 180; return { nx: Math.cos(a), ny: Math.sin(a) }; }
      case 'freeform': { const d = pointOffsetDir(q); return { nx: d.ux, ny: d.uy }; }
      default: {
        let bi = 0, bd = Infinity;
        poly.forEach((s, i) => { const d = (s.x - q.x) ** 2 + (s.y - q.y) ** 2; if (d < bd) { bd = d; bi = i; } });
        const a = poly[Math.max(0, bi - 1)], b = poly[Math.min(poly.length - 1, bi + 1)];
        if (!a || !b) return { nx: 0, ny: 1 };
        const dx = (b.x - a.x) * aspect, dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        return { nx: -dy / l, ny: dx / l };
      }
    }
  };
  const handlePos = (q: CurvePoint, side: 1 | -1): { x: number; y: number } => {
    const { nx, ny } = offsetDir(q);
    const dist = side === 1 ? params!.greenOffset : params!.symmetrical ? params!.greenOffset : params!.blueOffset;
    return { x: q.x + (nx * side * dist * m) / aspect, y: q.y + ny * side * dist * m };
  };

  /** Nearest handle in reach: the selected point's green / blue offset handles first, then every point and tangent. */
  const nearest = (lx: number, ly: number): Hit | null => {
    if (!params) return null;
    const reach = (9 / (view.zoom * rectW)) * 2;
    let best: Hit | null = null;
    let bd = reach * reach * 1.6;
    const tryPt = (kind: Hit['kind'], i: number, x: number, y: number) => {
      const d = (x - lx) ** 2 + (y - ly) ** 2;
      if (d < bd) { bd = d; best = { kind, i }; }
    };
    const s = pts[sel];
    if (s) { const g = handlePos(s, 1), b = handlePos(s, -1); tryPt('green', sel, g.x, g.y); tryPt('blue', sel, b.x, b.y); }
    pts.forEach((q, i) => {
      tryPt('pt', i, q.x, q.y);
      tryPt('in', i, q.x + q.inX, q.y + q.inY);
      tryPt('out', i, q.x + q.outX, q.y + q.outY);
    });
    return best;
  };

  const pointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !params) return;
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* released pointer */ }
    const start = toLocal(e);
    const track = (move: (ev: PointerEvent) => void) => {
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    if (pan) {
      const v0 = view;
      track((ev) => {
        const p = toLocal(ev);
        setView({ ...v0, cx: v0.cx - (p.x - start.x), cy: v0.cy - (p.y - start.y) });
      });
      return;
    }
    if (tool === 'move') {
      const hit = nearest(start.x, start.y);
      if (!hit) return;
      setSel(hit.i);
      const base = pts;
      track((ev) => {
        const p = toLocal(ev);
        if (hit.kind === 'green' || hit.kind === 'blue') {
          const q = base[hit.i];
          const { nx, ny } = offsetDir(q);
          const side = hit.kind === 'green' ? 1 : -1;
          // distance of the handle along the offset direction, back in the units the offsets use
          const dist = (((p.x - q.x) * aspect * nx + (p.y - q.y) * ny) * side) / m;
          const v = Math.min(1.5, Math.max(0.01, dist));
          set(hit.kind === 'green' ? { greenOffset: v } : { blueOffset: v });
          return;
        }
        setPts(base.map((q, i) => {
          if (i !== hit.i) return q;
          if (hit.kind === 'pt') return { ...q, x: snapV(p.x), y: snapV(p.y) };
          if (hit.kind === 'in') return { ...q, inX: p.x - q.x, inY: p.y - q.y };
          return { ...q, outX: p.x - q.x, outY: p.y - q.y };
        }));
      });
      return;
    }
    if (tool === 'delete') {
      const hit = nearest(start.x, start.y);
      if (hit && hit.kind === 'pt' && pts.length > 2) { setPts(pts.filter((_, i) => i !== hit.i)); setSel(Math.max(0, hit.i - 1)); }
      return;
    }
    if (tool === 'add') {
      // click drops a point (inside the curve if you clicked on it, else at its end); dragging then shapes that point's tangent
      let bi = 0, bd = Infinity;
      poly.forEach((q, i) => { const d = (q.x - start.x) ** 2 + (q.y - start.y) ** 2; if (d < bd) { bd = d; bi = i; } });
      const onCurve = poly.length > 0 && bd < 0.02 * 0.02 * 4;
      let next: CurvePoint[];
      let at: number;
      if (onCurve) {
        const segs = params.closed ? pts.length : pts.length - 1;
        const seg = Math.min(segs - 1, Math.floor(poly[bi].t * segs - 1e-9));
        next = [...pts];
        next.splice(seg + 1, 0, { x: poly[bi].x, y: poly[bi].y, inX: 0, inY: 0, outX: 0, outY: 0 });
        at = seg + 1;
      } else {
        const last = pts[pts.length - 1];
        next = [...pts, { x: snapV(start.x), y: snapV(start.y), inX: (last.x - start.x) / 3, inY: (last.y - start.y) / 3, outX: (start.x - last.x) / 3, outY: (start.y - last.y) / 3 }];
        at = next.length - 1;
      }
      next = smoothTangents(next, params.closed);
      setPts(next);
      setSel(at);
      const base = next;
      track((ev) => {
        const p = toLocal(ev);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (Math.hypot(dx, dy) < 0.01) return;
        setPts(base.map((q, i) => (i === at ? { ...q, outX: dx, outY: dy, inX: -dx, inY: -dy } : q)));
      });
      return;
    }
    // move all / rotate / scale act on the whole curve
    const base = pts.map((q) => ({ ...q }));
    const cx = base.reduce((s, q) => s + q.x, 0) / base.length, cy = base.reduce((s, q) => s + q.y, 0) / base.length;
    const pivot = tool === 'rotate' ? start : { x: cx, y: cy };
    const a0 = Math.atan2(start.y - pivot.y, start.x - pivot.x), d0 = Math.max(0.02, Math.hypot(start.x - pivot.x, start.y - pivot.y));
    track((ev) => {
      const p = toLocal(ev);
      if (tool === 'moveall') {
        const dx = p.x - start.x, dy = p.y - start.y;
        setPts(base.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })));
      } else if (tool === 'rotate') {
        const da = Math.atan2(p.y - pivot.y, p.x - pivot.x) - a0;
        const cs = Math.cos(da), sn = Math.sin(da);
        const rot = (x: number, y: number) => ({ x: cs * x - sn * y, y: sn * x + cs * y });
        setPts(base.map((q) => {
          const c = rot(q.x - pivot.x, q.y - pivot.y), i = rot(q.inX, q.inY), o = rot(q.outX, q.outY);
          return { ...q, x: pivot.x + c.x, y: pivot.y + c.y, inX: i.x, inY: i.y, outX: o.x, outY: o.y };
        }));
      } else {
        const k = Math.hypot(p.x - pivot.x, p.y - pivot.y) / d0;
        const kx = ev.ctrlKey ? 1 : k, ky = ev.shiftKey ? 1 : k;
        setPts(base.map((q) => ({ ...q, x: pivot.x + (q.x - pivot.x) * kx, y: pivot.y + (q.y - pivot.y) * ky, inX: q.inX * kx, inY: q.inY * ky, outX: q.outX * kx, outY: q.outY * ky })));
      }
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ ...v, zoom: Math.min(8, Math.max(0.4, v.zoom * k)) }));
  };

  const dragWindow = (e: React.PointerEvent) => {
    const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Esc closes it
  useEffect(() => {
    if (!lightId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightId, close]);

  if (!lightId || !light || !params) return null;

  const path = poly.map((q, i) => `${i ? 'L' : 'M'}${px(q.x).toFixed(1)},${py(q.y).toFixed(1)}`).join(' ');
  const selPt = pts[Math.min(sel, pts.length - 1)];
  const gh = selPt ? handlePos(selPt, 1) : null;
  const bh = selPt ? handlePos(selPt, -1) : null;

  const tb = (id: string, icon: string, title: string, active: boolean, onClick: () => void) => (
    <button key={id} title={title} onClick={onClick} className={'lce-btn' + (active ? ' on' : '')}>
      <Ico d={icon} />
    </button>
  );
  const hints: Record<Tool, string[]> = {
    move: ['Click & drag to move selected point or tangent', '(Green handle: sets how far the glow reaches above · Blue: below)'],
    moveall: ['Click & drag to move all'],
    add: ['Click & drop to add each curve point & control the tangent'],
    delete: ['Click a point to remove it'],
    rotate: ['Drag to rotate the curve around where you started'],
    scale: ['Drag to scale the curve (Shift = horizontal only, Ctrl = vertical only)'],
  };
  // the green crosshair snaps onto the handle you would grab
  const snapAt = hover && tool === 'move' ? (hover.kind === 'pt' ? pts[hover.i] : hover.kind === 'in' ? { x: pts[hover.i].x + pts[hover.i].inX, y: pts[hover.i].y + pts[hover.i].inY } : hover.kind === 'out' ? { x: pts[hover.i].x + pts[hover.i].outX, y: pts[hover.i].y + pts[hover.i].outY } : hover.kind === 'green' ? gh : bh) : null;
  const cross = snapAt ?? cursor;

  return (
    <div className="lce-window" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
      <style>{`
        .lce-window{position:fixed;z-index:9000;width:384px;background:#1c1d20;border:1px solid #3a3c42;border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,.6);color:#d7d9de;font:11px system-ui,sans-serif;user-select:none}
        .lce-title{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #2c2e33;cursor:move;border-radius:8px 8px 0 0;background:#25262a}
        .lce-title b{font-weight:600;flex:1}
        .lce-x{background:none;border:none;color:#aab;cursor:pointer;font-size:14px;line-height:1}
        .lce-body{display:flex;gap:6px;padding:8px}
        .lce-col{display:flex;flex-direction:column;gap:3px}
        .lce-btn{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:#2b2d32;border:1px solid #3a3c42;border-radius:4px;color:#cfd2d8;cursor:pointer;padding:0}
        .lce-btn:hover{background:#34373d}
        .lce-btn.on{background:#5a3b12;border-color:#ff9a1f;color:#ffb347}
        .lce-hint{text-align:center;padding:2px 10px 9px;color:#b5b8bf;line-height:1.5}
      `}</style>
      <div className="lce-title" onPointerDown={dragWindow}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ab0ff" strokeWidth="2"><path d="M3 18c5 0 4-12 9-12s4 12 9 12" /></svg>
        <b>Lumi-Curve Editor</b>
        <button className="lce-x" onClick={close} onPointerDown={(e) => e.stopPropagation()} title="Close (Esc)">✕</button>
      </div>
      <div className="lce-body">
        <div className="lce-col">
          {tb('move', I.move, 'Move point / tangent / glow handles', tool === 'move', () => { setTool('move'); setPan(false); })}
          {tb('add', I.add, 'Add points: click & drop, drag to shape the tangent', tool === 'add', () => { setTool('add'); setPan(false); })}
          {tb('delete', I.del, 'Delete a point', tool === 'delete', () => { setTool('delete'); setPan(false); })}
          {tb('moveall', I.all, 'Move the whole curve', tool === 'moveall', () => { setTool('moveall'); setPan(false); })}
          {tb('rotate', I.rotate, 'Rotate the curve', tool === 'rotate', () => { setTool('rotate'); setPan(false); })}
          {tb('scale', I.scale, 'Scale the curve', tool === 'scale', () => { setTool('scale'); setPan(false); })}
          {tb('flipv', I.flipV, 'Flip vertically', false, () => setPts(pts.map((q) => ({ ...q, y: -q.y, inY: -q.inY, outY: -q.outY }))))}
          {tb('fliph', I.flipH, 'Flip horizontally', false, () => setPts(pts.map((q) => ({ ...q, x: -q.x, inX: -q.inX, outX: -q.outX }))))}
          {tb('smooth', I.smooth, 'Fix tangents (smooth every point)', false, () => setPts(smoothTangents(pts, params.closed)))}
          {tb('reset', I.reset, 'Delete all points and start again with two', false, () => { setPts(smoothTangents([{ x: -0.6, y: 0 }, { x: 0.6, y: 0 }], false)); setSel(0); })}
        </div>
        <svg
          ref={svg}
          width={VB}
          height={VB}
          viewBox={`0 0 ${VB} ${VB}`}
          style={{ background: '#000', borderRadius: 3, touchAction: 'none', cursor: 'none', flexShrink: 0 }}
          onPointerDown={pointerDown}
          onWheel={onWheel}
          onPointerLeave={() => { setHover(null); setCursor(null); }}
          onPointerMove={(e) => {
            const p = toLocal(e);
            setCursor(p);
            setHover(tool === 'move' && !pan ? nearest(p.x, p.y) : null);
          }}
        >
          {showPreview && previewUrl && (
            <image href={previewUrl} x={px(-1)} y={py(1)} width={px(1) - px(-1)} height={py(-1) - py(1)} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />
          )}
          <rect x={px(-1)} y={py(1)} width={px(1) - px(-1)} height={py(-1) - py(1)} fill="none" stroke="#555" />
          <line x1={px(0)} y1={py(1)} x2={px(0)} y2={py(-1)} stroke="#2a2a2a" />
          <line x1={px(-1)} y1={py(0)} x2={px(1)} y2={py(0)} stroke="#2a2a2a" />
          <path d={path} fill="none" stroke="#ffb98a" strokeWidth={1.4} opacity={0.9} />
          {pts.map((q, i) => (
            <g key={i}>
              {i === sel && (
                <>
                  <line x1={px(q.x)} y1={py(q.y)} x2={px(q.x + q.inX)} y2={py(q.y + q.inY)} stroke="#e8793a" strokeWidth={1} />
                  <line x1={px(q.x)} y1={py(q.y)} x2={px(q.x + q.outX)} y2={py(q.y + q.outY)} stroke="#e8793a" strokeWidth={1} />
                  <rect x={px(q.x + q.inX) - 2.5} y={py(q.y + q.inY) - 2.5} width={5} height={5} fill="#e8793a" />
                  <rect x={px(q.x + q.outX) - 2.5} y={py(q.y + q.outY) - 2.5} width={5} height={5} fill="#e8793a" />
                </>
              )}
              <rect x={px(q.x) - 3.5} y={py(q.y) - 3.5} width={7} height={7} fill={i === sel ? '#ff7a2a' : '#c0562a'} stroke={hover?.kind === 'pt' && hover.i === i ? '#fff' : 'none'} />
            </g>
          ))}
          {selPt && gh && bh && (
            <>
              <line x1={px(selPt.x)} y1={py(selPt.y)} x2={px(gh.x)} y2={py(gh.y)} stroke="#38d36a" strokeWidth={1} />
              <line x1={px(selPt.x)} y1={py(selPt.y)} x2={px(bh.x)} y2={py(bh.y)} stroke="#3a8cff" strokeWidth={1} />
              <circle cx={px(gh.x)} cy={py(gh.y)} r={4} fill="#38d36a" stroke={hover?.kind === 'green' ? '#fff' : '#031'} />
              <circle cx={px(bh.x)} cy={py(bh.y)} r={4} fill="#3a8cff" stroke={hover?.kind === 'blue' ? '#fff' : '#013'} />
            </>
          )}
          {cross && !pan && (
            <g stroke={snapAt ? '#5dff8a' : '#b8b8b8'} strokeWidth={1} pointerEvents="none">
              <line x1={px(cross.x) - 7} y1={py(cross.y)} x2={px(cross.x) + 7} y2={py(cross.y)} />
              <line x1={px(cross.x)} y1={py(cross.y) - 7} x2={px(cross.x)} y2={py(cross.y) + 7} />
            </g>
          )}
        </svg>
        <div className="lce-col">
          {tb('zoom', I.zoom, 'Zoom in (mouse wheel also zooms)', false, () => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.4) })))}
          {tb('pan', I.pan, 'Pan the view (drag)', pan, () => setPan((p) => !p))}
          {tb('fit', I.fit, 'Fit the light to the window', false, () => setView({ zoom: 1, cx: 0, cy: 0 }))}
          {tb('fitall', I.fitAll, 'Fit the curve to the window', false, () => {
            if (!pts.length) return;
            const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
            const w = Math.max(0.2, Math.max(...xs) - Math.min(...xs)), h = Math.max(0.2, Math.max(...ys) - Math.min(...ys));
            setView({ zoom: Math.min(6, 1.7 / Math.max(w, h)), cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 });
          })}
          {tb('line', I.line, 'Straighten the curve into a line between its end points', false, () => {
            const a = pts[0], b = pts[pts.length - 1];
            setPts(smoothTangents(pts.map((q, i) => ({ ...q, x: a.x + ((b.x - a.x) * i) / Math.max(1, pts.length - 1), y: a.y + ((b.y - a.y) * i) / Math.max(1, pts.length - 1) })), params.closed));
          })}
          {tb('snap', I.snap, 'Snap points to a grid', snapGrid, () => setSnapGrid((s) => !s))}
          {tb('preview', I.preview, 'Show the light as it is rendered behind the curve', showPreview, () => setShowPreview((s) => !s))}
        </div>
      </div>
      <div className="lce-hint">
        {hints[pan ? 'move' : tool].map((l, i) => <div key={i}>{pan ? (i ? '' : 'Drag to pan the view') : l}</div>)}
      </div>
    </div>
  );
};
