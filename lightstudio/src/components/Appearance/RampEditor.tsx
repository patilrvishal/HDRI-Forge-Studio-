import React, { useCallback, useRef, useState } from 'react';
import type { RampStop } from '../../appearance/types';
import { evalRamp, evalColorRamp } from '../../appearance/evaluate';
import { Slider } from '../UI/Slider';
import { ColorPicker } from '../UI/ColorPicker';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface RampProps {
  stops: RampStop[];
  onChange: (s: RampStop[]) => void;
  /** 'value' = greyscale ramp, 'color' = colour ramp. */
  mode: 'value' | 'color';
  label?: string;
  /** Upper end of the value axis (value ramps). */
  vmax?: number;
}

/**
 * Gradient-style ramp editor. Click the bar to add a stop, drag stops to move
 * them, select one to edit its position and value / colour, double-click to delete.
 */
export const RampEditor: React.FC<RampProps> = ({ stops, onChange, mode, label, vmax = 1 }) => {
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const sorted = [...stops].map((s, i) => ({ ...s, i })).sort((a, b) => a.pos - b.pos);
  const selected = stops[Math.min(sel, stops.length - 1)];
  const selIdx = Math.min(sel, stops.length - 1);

  const css = (() => {
    const parts: string[] = [];
    const tmp: [number, number, number] = [1, 1, 1];
    const N = 24;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      let r: number, g: number, b: number;
      if (mode === 'color') {
        evalColorRamp(sorted, t, tmp);
        [r, g, b] = tmp;
      } else {
        const v = Math.min(1, evalRamp(sorted, t) / vmax);
        r = g = b = v;
      }
      const s = (c: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2));
      parts.push(`rgb(${s(r)},${s(g)},${s(b)}) ${(t * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${parts.join(',')})`;
  })();

  const posFromEvent = useCallback((e: { clientX: number }) => {
    const r = bar.current!.getBoundingClientRect();
    return clamp01((e.clientX - r.left) / Math.max(1, r.width));
  }, []);

  const startDrag = (idx: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setSel(idx);
    const move = (ev: PointerEvent) => {
      const pos = posFromEvent(ev);
      onChange(stops.map((s, i) => (i === idx ? { ...s, pos } : s)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addAt = (e: React.MouseEvent) => {
    const pos = posFromEvent(e);
    const stop: RampStop =
      mode === 'color'
        ? (() => {
            const t: [number, number, number] = [1, 1, 1];
            evalColorRamp(sorted, pos, t);
            const hex = '#' + t.map((c) => Math.round(255 * Math.pow(Math.min(1, c), 1 / 2.2)).toString(16).padStart(2, '0')).join('');
            return { pos, value: 1, color: hex };
          })()
        : { pos, value: evalRamp(sorted, pos) };
    onChange([...stops, stop]);
    setSel(stops.length);
  };

  const remove = (idx: number) => {
    if (stops.length <= 2) return;
    onChange(stops.filter((_, i) => i !== idx));
    setSel(0);
  };

  return (
    <div style={{ margin: '4px 0 8px' }}>
      {label && <div className="field-label" style={{ marginBottom: 3, fontSize: 10 }}>{label}</div>}
      <div
        ref={bar}
        onClick={addAt}
        title="Click to add a stop"
        style={{ position: 'relative', height: 22, borderRadius: 4, border: '1px solid var(--border, #444)', background: css, cursor: 'copy' }}
      >
        {sorted.map((s) => (
          <div
            key={s.i}
            onPointerDown={(e) => startDrag(s.i, e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => { e.stopPropagation(); remove(s.i); }}
            title="Drag to move - double-click to delete"
            style={{
              position: 'absolute',
              left: `calc(${s.pos * 100}% - 5px)`,
              bottom: -7,
              width: 10,
              height: 12,
              background: s.i === selIdx ? 'var(--accent-bright, #4af)' : '#ddd',
              clipPath: 'polygon(50% 0, 100% 45%, 100% 100%, 0 100%, 0 45%)',
              cursor: 'ew-resize',
            }}
          />
        ))}
      </div>
      {selected && (
        <div style={{ marginTop: 10 }}>
          <Slider
            label="Stop pos"
            value={selected.pos}
            min={0}
            max={1}
            step={0.005}
            onChange={(v) => onChange(stops.map((s, i) => (i === selIdx ? { ...s, pos: v } : s)))}
          />
          {mode === 'value' ? (
            <Slider
              label="Value"
              value={selected.value}
              min={0}
              max={vmax}
              step={0.005}
              onChange={(v) => onChange(stops.map((s, i) => (i === selIdx ? { ...s, value: v } : s)))}
            />
          ) : (
            <ColorPicker
              label="Stop colour"
              color={selected.color ?? '#ffffff'}
              onChange={(c) => onChange(stops.map((s, i) => (i === selIdx ? { ...s, color: c } : s)))}
            />
          )}
          <button className="btn-sm" disabled={stops.length <= 2} onClick={() => remove(selIdx)}>Delete stop</button>
        </div>
      )}
    </div>
  );
};
