import React, { useRef, useState } from 'react';
import type { CurvePoint, LumiCurveParams } from '../../appearance/types';
import { sampleCurve, smoothTangents } from '../../appearance/evaluate';

interface Props {
  params: LumiCurveParams;
  aspect: number;
  onChange: (patch: Partial<LumiCurveParams>) => void;
}

type Tool = 'move' | 'insert' | 'extend' | 'delete' | 'rotate' | 'scale';

const TOOLS: [Tool, string, string][] = [
  ['move', 'Move', 'Move points and tangent handles (the crosshair snaps to the nearest one)'],
  ['insert', 'Insert', 'Click on the curve to insert a point'],
  ['extend', 'Extend', 'Click away from the curve to add a point at its end'],
  ['delete', 'Delete', 'Click a point to remove it'],
  ['rotate', 'Rotate', 'Drag to rotate the curve around where you started'],
  ['scale', 'Scale', 'Drag to scale the curve (Shift = horizontal only, Ctrl = vertical only)'],
];

/**
 * Lumi-Curve editor: centre line points with Bezier tangent handles, the green / blue falloff
 * offsets drawn either side, and the edit tools (move, insert, extend, delete, rotate, scale,
 * flip, fix tangents, delete all).
 */
export const CurveEditor: React.FC<Props> = ({ params, aspect, onChange }) => {
  const W = 300;
  const H = Math.max(90, Math.min(300, Math.round(W / Math.max(0.25, aspect))));
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [snap, setSnap] = useState<string | null>(null);
  const pts = params.points;

  const px = (x: number) => ((x + 1) / 2) * W;
  const py = (y: number) => ((1 - y) / 2) * H;
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 };
  };

  /** Nearest control point or handle within reach, for snap selection. */
  const nearest = (lx: number, ly: number): { kind: 'pt' | 'in' | 'out'; i: number } | null => {
    let best: { kind: 'pt' | 'in' | 'out'; i: number } | null = null;
    let bd = 0.08 * 0.08 * 4;
    pts.forEach((q, i) => {
      const cands: ['pt' | 'in' | 'out', number, number][] = [['pt', q.x, q.y], ['in', q.x + q.inX, q.y + q.inY], ['out', q.x + q.outX, q.y + q.outY]];
      for (const [kind, x, y] of cands) {
        const d = (x - lx) ** 2 + (y - ly) ** 2;
        if (d < bd) { bd = d; best = { kind, i }; }
      }
    });
    return best;
  };

  const setPts = (next: CurvePoint[]) => onChange({ points: next });

  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = toLocal(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

    if (tool === 'move') {
      const hit = nearest(start.x, start.y);
      if (!hit) return;
      const move = (ev: PointerEvent) => {
        const p = toLocal(ev);
        setPts(pts.map((q, i) => {
          if (i !== hit.i) return q;
          if (hit.kind === 'pt') return { ...q, x: p.x, y: p.y };
          if (hit.kind === 'in') return { ...q, inX: p.x - q.x, inY: p.y - q.y };
          return { ...q, outX: p.x - q.x, outY: p.y - q.y };
        }));
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (tool === 'delete') {
      const hit = nearest(start.x, start.y);
      if (hit && pts.length > 2) setPts(pts.filter((_, i) => i !== hit.i));
      return;
    }
    if (tool === 'extend') {
      const last = pts[pts.length - 1];
      const np: CurvePoint = { x: start.x, y: start.y, inX: (last.x - start.x) / 3, inY: (last.y - start.y) / 3, outX: (start.x - last.x) / 3, outY: (start.y - last.y) / 3 };
      setPts(smoothTangents([...pts, np], params.closed));
      return;
    }
    if (tool === 'insert') {
      // insert into the segment whose sampled curve passes closest to the click
      const poly = sampleCurve(params);
      let bi = 0, bd = Infinity;
      poly.forEach((q, i) => { const d = (q.x - start.x) ** 2 + (q.y - start.y) ** 2; if (d < bd) { bd = d; bi = i; } });
      const segs = params.closed ? pts.length : pts.length - 1;
      const seg = Math.min(segs - 1, Math.floor(poly[bi].t * segs - 1e-9));
      const next = [...pts];
      next.splice(seg + 1, 0, { x: poly[bi].x, y: poly[bi].y, inX: 0, inY: 0, outX: 0, outY: 0 });
      setPts(smoothTangents(next, params.closed));
      return;
    }
    // rotate / scale act on the whole curve
    const base = pts.map((q) => ({ ...q }));
    const cx = base.reduce((s, q) => s + q.x, 0) / base.length, cy = base.reduce((s, q) => s + q.y, 0) / base.length;
    const pivot = tool === 'rotate' ? start : { x: cx, y: cy };
    const a0 = Math.atan2(start.y - pivot.y, start.x - pivot.x), d0 = Math.max(0.02, Math.hypot(start.x - pivot.x, start.y - pivot.y));
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev);
      if (tool === 'rotate') {
        const da = Math.atan2(p.y - pivot.y, p.x - pivot.x) - a0;
        const cs = Math.cos(da), sn = Math.sin(da);
        const rot = (x: number, y: number) => ({ x: cs * x - sn * y, y: sn * x + cs * y });
        setPts(base.map((q) => {
          const c = rot(q.x - pivot.x, q.y - pivot.y), i = rot(q.inX, q.inY), o = rot(q.outX, q.outY);
          return { x: pivot.x + c.x, y: pivot.y + c.y, inX: i.x, inY: i.y, outX: o.x, outY: o.y };
        }));
      } else {
        const k = Math.hypot(p.x - pivot.x, p.y - pivot.y) / d0;
        const kx = ev.ctrlKey ? 1 : k, ky = ev.shiftKey ? 1 : k;
        setPts(base.map((q) => ({ x: pivot.x + (q.x - pivot.x) * kx, y: pivot.y + (q.y - pivot.y) * ky, inX: q.inX * kx, inY: q.inY * ky, outX: q.outX * kx, outY: q.outY * ky })));
      }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const poly = sampleCurve(params);
  const path = poly.map((q, i) => `${i ? 'L' : 'M'}${px(q.x).toFixed(1)},${py(q.y).toFixed(1)}`).join(' ');
  // green / blue offset lines along the curve normal (visual guide of the falloff distance)
  const offsetPath = (dist: number, sign: number) =>
    poly.map((q, i) => {
      const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
      const dx = (b.x - a.x) * aspect, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * sign, ny = (dx / l) * sign;
      const m = Math.min(aspect, 1);
      return `${i ? 'L' : 'M'}${px(q.x + (nx * dist * m) / aspect).toFixed(1)},${py(q.y + ny * dist * m).toFixed(1)}`;
    }).join(' ');

  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
        {TOOLS.map(([t, label, hint]) => (
          <button key={t} className="btn-sm" title={hint} onClick={() => setTool(t)} style={{ outline: tool === t ? '1px solid var(--accent-bright, #4af)' : 'none', fontSize: 10 }}>
            {label}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#111', borderRadius: 4, border: '1px solid var(--border, #444)', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={drag}
        onPointerMove={(e) => {
          if (tool !== 'move' && tool !== 'delete') { if (snap) setSnap(null); return; }
          const p = toLocal(e);
          const h = nearest(p.x, p.y);
          setSnap(h ? `${h.kind}${h.i}` : null);
        }}
      >
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke="#333" />
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#222" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#222" />
        <path d={offsetPath(params.greenOffset, 1)} fill="none" stroke="#3c6" strokeWidth={1} strokeDasharray="3 3" />
        <path d={offsetPath(params.symmetrical ? params.greenOffset : params.blueOffset, -1)} fill="none" stroke="#48f" strokeWidth={1} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="#fa4" strokeWidth={2} />
        {pts.map((q, i) => (
          <g key={i}>
            <line x1={px(q.x)} y1={py(q.y)} x2={px(q.x + q.inX)} y2={py(q.y + q.inY)} stroke="#888" />
            <line x1={px(q.x)} y1={py(q.y)} x2={px(q.x + q.outX)} y2={py(q.y + q.outY)} stroke="#888" />
            <rect x={px(q.x + q.inX) - 3} y={py(q.y + q.inY) - 3} width={6} height={6} fill={snap === `in${i}` ? '#fff' : '#bbb'} />
            <rect x={px(q.x + q.outX) - 3} y={py(q.y + q.outY) - 3} width={6} height={6} fill={snap === `out${i}` ? '#fff' : '#bbb'} />
            <circle cx={px(q.x)} cy={py(q.y)} r={5} fill={snap === `pt${i}` ? '#fff' : '#fa4'} stroke="#000" />
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
        <button className="btn-sm" title="Flip horizontally" onClick={() => setPts(pts.map((q) => ({ x: -q.x, y: q.y, inX: -q.inX, inY: q.inY, outX: -q.outX, outY: q.outY })))}>Flip H</button>
        <button className="btn-sm" title="Flip vertically" onClick={() => setPts(pts.map((q) => ({ x: q.x, y: -q.y, inX: q.inX, inY: -q.inY, outX: q.outX, outY: -q.outY })))}>Flip V</button>
        <button className="btn-sm" title="Smooth every tangent (1/3 of the distance to the neighbouring points)" onClick={() => setPts(smoothTangents(pts, params.closed))}>Fix tangents</button>
        <button className="btn-sm" title="Delete all points and start again with two" onClick={() => setPts(smoothTangents([{ x: -0.6, y: 0 }, { x: 0.6, y: 0 }], false))}>Delete all</button>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>
        Orange = centre line. Green and blue dashes show the falloff offsets each side. Squares are tangent handles.
      </div>
    </div>
  );
};
