import React, { useRef } from 'react';
import type { CurvePoint, LumiCurveParams } from '../../appearance/types';
import { sampleCurve } from '../../appearance/evaluate';

interface Props {
  params: LumiCurveParams;
  aspect: number;
  onChange: (patch: Partial<LumiCurveParams>) => void;
}

/**
 * Lumi-Curve path editor. Drag points to shape the curve, click empty space to
 * append a point, double-click a point to remove it, Alt+wheel over a point to
 * change its thickness.
 */
export const CurveEditor: React.FC<Props> = ({ params, aspect, onChange }) => {
  const W = 260;
  const H = Math.max(80, Math.min(260, Math.round(W / Math.max(0.25, aspect))));
  const svg = useRef<SVGSVGElement>(null);
  const pts = params.points;

  const toLocal = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(-1.3, Math.min(1.3, ((e.clientX - r.left) / r.width) * 2 - 1)),
      y: Math.max(-1.3, Math.min(1.3, 1 - ((e.clientY - r.top) / r.height) * 2)),
    };
  };
  const px = (x: number) => ((x + 1) / 2) * W;
  const py = (y: number) => ((1 - y) / 2) * H;

  const drag = (idx: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev);
      onChange({ points: pts.map((q, i) => (i === idx ? { ...q, x: p.x, y: p.y } : q)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const poly = sampleCurve(params);
  const path = poly.map((q, i) => `${i ? 'L' : 'M'}${px(q.x).toFixed(1)},${py(q.y).toFixed(1)}`).join(' ');

  return (
    <div style={{ margin: '6px 0' }}>
      <svg
        ref={svg}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#111', borderRadius: 4, border: '1px solid var(--border, #444)', touchAction: 'none', cursor: 'crosshair' }}
        onClick={(e) => {
          const p = toLocal(e);
          const np: CurvePoint = { x: p.x, y: p.y, w: 1 };
          onChange({ points: [...pts, np] });
        }}
      >
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke="#333" />
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#222" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#222" />
        <path d={path} fill="none" stroke="#9cf" strokeWidth={2} />
        {pts.map((q, i) => (
          <circle
            key={i}
            cx={px(q.x)}
            cy={py(q.y)}
            r={6}
            fill={i === 0 ? '#5f5' : i === pts.length - 1 ? '#f95' : '#fff'}
            stroke="#000"
            onPointerDown={(e) => drag(i, e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (pts.length > 2) onChange({ points: pts.filter((_, k) => k !== i) });
            }}
            onWheel={(e) => {
              if (!e.altKey) return;
              const w = Math.max(0.05, Math.min(2, q.w + (e.deltaY < 0 ? 0.1 : -0.1)));
              onChange({ points: pts.map((z, k) => (k === i ? { ...z, w } : z)) });
            }}
            style={{ cursor: 'grab' }}
          />
        ))}
      </svg>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>
        Drag points - click to add - double-click a point to delete - Alt+wheel on a point = thickness
      </div>
    </div>
  );
};
