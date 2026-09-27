import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useLightsStore } from '../../store/lightsStore';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';
import { useObjectHdriStore } from '../../store/objectHdriStore';
import { useAppearanceStore } from '../../appearance/appearanceStore';
import { generateAnalyticalHDRI, loadActiveHDRILayers } from '../../three/HDRIExporter';
import { cartesianToSpherical } from '../../utils/math';
import { scaledLightPatch } from '../../three/lightScale';
import { paintSunToDirection, hasSunTarget } from '../../hdriedit/paintSun';
import { linearToSrgbChannel } from '../../appearance/evaluate';
import { newAppearance, newLayer } from '../../appearance/content';
import { collectLightFrames, dirToUv, insideRect, planeOffsets, rectPointUv, uvToDir, type LightFrame } from './canvasGeometry';
import type { Light } from '../../types/Light';
import type { CurvePoint } from '../../appearance/types';

const CW = 1024, CH = 512;
const BW = 512, BH = 256;

type Tool = 'select' | 'sun' | 'curve';

const getScene = (): THREE.Scene | null =>
  (window as unknown as { __lightforgeScene?: { scene: THREE.Scene } }).__lightforgeScene?.scene ?? null;

/** Ramer-Douglas-Peucker simplification of a polyline. */
function simplify(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = simplify(pts.slice(0, idx + 1), eps), r = simplify(pts.slice(idx), eps);
    return [...l.slice(0, -1), ...r];
  }
  return [a, b];
}

/**
 * Canvas: the flat (equirectangular) map of the lighting. Lights sit on it as outlines; drag
 * to move, drag a corner to resize (hold Shift to keep the light's total energy constant),
 * paint the sun, or draw a Lumi-Curve straight onto the map.
 */
export const CanvasPanel: React.FC = () => {
  const lights = useLightsStore((s) => s.lights);
  const selectedId = useLightsStore((s) => s.selectedLightId);
  const assets = useHDRIAssetStore((s) => s.assets);
  const objVersion = useObjectHdriStore((s) => s.version);
  const imagesVersion = useAppearanceStore((s) => s.imagesVersion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [bake, setBake] = useState<Float32Array | null>(null);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState('');
  const dragRef = useRef<null | { kind: 'move' | 'corner' | 'curve'; id: string; corner?: [number, number]; pts?: { x: number; y: number }[] }>(null);
  const curveRef = useRef<{ x: number; y: number }[]>([]);
  const bakeGen = useRef(0);

  // Bake the map (debounced): what the lights + HDRIs add up to as seen from the origin.
  const sig = useMemo(() => JSON.stringify([lights.map((l) => [l.id, l.color, l.brightness, l.opacity, l.visible, l.areaWidth, l.areaHeight, l.transform.position, l.appearance, l.areaTex, l.type]), assets.map((a) => [a.id, a.active, a.intensity, a.rotation, a.edits, a.sky]), objVersion, imagesVersion]), [lights, assets, objVersion, imagesVersion]);
  useEffect(() => {
    const gen = ++bakeGen.current;
    const t = window.setTimeout(async () => {
      const scene = getScene();
      if (!scene) return;
      try {
        const layers = await loadActiveHDRILayers(1);
        const px = await generateAnalyticalHDRI(scene, BW, BH, new THREE.Vector3(0, 0, 0), layers, { includeAreaModeLights: true });
        if (gen === bakeGen.current) setBake(px);
      } catch (e) {
        console.warn('[canvas] bake failed', e);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [sig]);

  // Draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = CW; c.height = CH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d0e12';
    ctx.fillRect(0, 0, CW, CH);
    if (bake) {
      const id = ctx.createImageData(BW, BH);
      for (let i = 0; i < BW * BH; i++) {
        for (let k = 0; k < 3; k++) {
          const v = Math.max(0, bake[i * 4 + k]);
          id.data[i * 4 + k] = Math.round(linearToSrgbChannel(v / (1 + v * 0.25)) * 255);
        }
        id.data[i * 4 + 3] = 255;
      }
      const tmp = document.createElement('canvas');
      tmp.width = BW; tmp.height = BH;
      tmp.getContext('2d')!.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, CW, CH);
    }
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 12; i++) { ctx.beginPath(); ctx.moveTo((i / 12) * CW, 0); ctx.lineTo((i / 12) * CW, CH); ctx.stroke(); }
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, (i / 6) * CH); ctx.lineTo(CW, (i / 6) * CH); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.moveTo(0, CH / 2); ctx.lineTo(CW, CH / 2); ctx.stroke();

    const scene = getScene();
    if (!scene) return;
    const frames = collectLightFrames(scene);
    for (const l of lights) {
      const f = frames.get(l.id);
      if (!f) continue;
      const sel = l.id === selectedId;
      drawLight(ctx, l, f, sel);
    }
    // in-progress curve
    if (curveRef.current.length > 1) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 3;
      ctx.beginPath();
      curveRef.current.forEach((p, i) => (i ? ctx.lineTo(p.x * CW, p.y * CH) : ctx.moveTo(p.x * CW, p.y * CH)));
      ctx.stroke();
    }
  }, [bake, lights, selectedId, tick]);

  const uvOf = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const pickLight = useCallback((u: number, v: number): { id: string; corner?: [number, number] } | null => {
    const scene = getScene();
    if (!scene) return null;
    const frames = collectLightFrames(scene);
    const d = uvToDir(u, v);
    // corner handles of the selected light first
    const sel = frames.get(useLightsStore.getState().selectedLightId ?? '');
    if (sel?.isRect) {
      for (const cx of [-1, 1]) for (const cy of [-1, 1]) {
        const [cu, cv] = rectPointUv(sel, (cx * sel.width) / 2, (cy * sel.height) / 2);
        if (Math.abs(cu - u) * CW < 12 && Math.abs(cv - v) * CH < 12) return { id: sel.id, corner: [cx, cy] };
      }
    }
    let best: string | null = null;
    let bestD = 1e9;
    for (const [id, f] of frames) {
      if (f.isRect && insideRect(f, d)) return { id };
      const [fu, fv] = dirToUv(f.pos);
      let du = Math.abs(fu - u); if (du > 0.5) du = 1 - du;
      const dist = Math.hypot(du * CW, (fv - v) * CH);
      if (dist < 16 && dist < bestD) { best = id; bestD = dist; }
    }
    return best ? { id: best } : null;
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [u, v] = uvOf(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'sun') {
      const r = paintSunToDirection(uvToDir(u, v));
      setStatus(r === 'sky' ? 'Sun placed on the procedural sky.' : r === 'light' ? 'Sun placed on the light\'s Sky.' : hasSunTarget() ? 'Aim inside the selected light for its Sky content.' : 'No Sky to paint: add a Procedural Sky, or a light with Sky content.');
      dragRef.current = { kind: 'move', id: '__sun__' };
      return;
    }
    if (tool === 'curve') {
      curveRef.current = [{ x: u, y: v }];
      dragRef.current = { kind: 'curve', id: '' };
      return;
    }
    const hit = pickLight(u, v);
    if (hit) {
      useLightsStore.getState().selectLight(hit.id);
      dragRef.current = { kind: hit.corner ? 'corner' : 'move', id: hit.id, corner: hit.corner };
    } else {
      dragRef.current = null;
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const [u, v] = uvOf(e);
    if (d.kind === 'curve') {
      const last = curveRef.current[curveRef.current.length - 1];
      if (Math.hypot((u - last.x) * CW, (v - last.y) * CH) > 3) { curveRef.current.push({ x: u, y: v }); setTick((t) => t + 1); }
      return;
    }
    if (d.id === '__sun__') { paintSunToDirection(uvToDir(u, v)); return; }
    const st = useLightsStore.getState();
    const l = st.lights.find((x) => x.id === d.id);
    if (!l) return;
    const dir = uvToDir(u, v);
    if (d.kind === 'move') {
      const R = Math.hypot(l.transform.position.x, l.transform.position.y, l.transform.position.z) || 5;
      const p = dir.clone().multiplyScalar(R);
      const sph = cartesianToSpherical(p.x, p.y, p.z);
      st.updateLightTransform(l.id, {
        position: { x: p.x, y: p.y, z: p.z },
        spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height },
        aimTarget: undefined,
        rotation: { ...l.transform.rotation, enabled: false },
      } as never);
    } else if (d.kind === 'corner') {
      const scene = getScene();
      const f = scene ? collectLightFrames(scene).get(l.id) : null;
      if (!f) return;
      const o = planeOffsets(f, dir);
      if (!o) return;
      // Runtime size may include a dolly factor; convert back to the stored size.
      const k = f.width / Math.max(1e-6, l.areaWidth ?? 2);
      const w = (Math.abs(o.lx) * 2) / k, h = (Math.abs(o.ly) * 2) / k;
      // Shift = Energy-Conserving Light Scaling
      st.updateLight(l.id, scaledLightPatch(l, l.objectKey ? (l.areaWidth ?? 2) : w, l.objectKey ? (l.areaHeight ?? 2) : h, e.shiftKey));
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === 'curve') {
      const pts = simplify(curveRef.current, 0.004);
      curveRef.current = [];
      setTick((t) => t + 1);
      if (pts.length >= 2) createCurveLight(pts);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = useLightsStore.getState();
    const l = st.lights.find((x) => x.id === st.selectedLightId);
    if (!l || l.objectKey || !(l.type === 'area' || l.type === 'overhead')) return;
    const [u, v] = uvOf(e);
    const hit = pickLight(u, v);
    if (!hit || hit.id !== l.id) return;
    const k = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    st.updateLight(l.id, scaledLightPatch(l, (l.areaWidth ?? 2) * k, (l.areaHeight ?? 2) * k, e.shiftKey));
  };

  /** Lumi-Curve drawn on the map becomes an area light whose appearance is that curve. */
  const createCurveLight = (pts: { x: number; y: number }[]) => {
    const dirs = pts.map((p) => uvToDir(p.x, p.y));
    const c = dirs.reduce((a, b) => a.add(b), new THREE.Vector3()).normalize();
    if (c.lengthSq() < 0.5) return;
    const worldUp = Math.abs(c.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    // Frame that matches how area lights face the origin: -Z toward origin, X = up x Z.
    const z = c.clone(); // pointing outward; the light's local +Z is -normal = toward the map point
    const right = new THREE.Vector3().crossVectors(worldUp, z).normalize();
    const up = new THREE.Vector3().crossVectors(z, right).normalize();
    const R = 5;
    const local = dirs.map((d) => {
      const cosc = Math.max(0.05, d.dot(c));
      return { x: (d.dot(right) / cosc) * R, y: (d.dot(up) / cosc) * R };
    });
    const minx = Math.min(...local.map((p) => p.x)), maxx = Math.max(...local.map((p) => p.x));
    const miny = Math.min(...local.map((p) => p.y)), maxy = Math.max(...local.map((p) => p.y));
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const hw = Math.max(0.3, (maxx - minx) / 2 * 1.25), hh = Math.max(0.3, (maxy - miny) / 2 * 1.25);
    const centre = c.clone().multiplyScalar(R).addScaledVector(right, cx).addScaledVector(up, cy).normalize().multiplyScalar(R);
    // the panel's x runs to the viewer's right = the light's -X = the map's +right axis reversed; see LightAppearanceSection
    const points: CurvePoint[] = local.map((p) => ({ x: Math.max(-1.3, Math.min(1.3, -((p.x - cx) / hw))), y: Math.max(-1.3, Math.min(1.3, (p.y - cy) / hh)), w: 1 }));
    const app = newAppearance('lumicurve', 'Lumi-Curve');
    const layer = newLayer('lumicurve', { name: 'Master' });
    if (layer.content.type === 'lumicurve') { layer.content.p.points = points; layer.content.p.smooth = true; layer.content.p.thickness = 0.1; layer.content.p.glow = 0.4; }
    app.master = layer;
    const st = useLightsStore.getState();
    st.addLight('area');
    const created = useLightsStore.getState().lights.slice(-1)[0];
    const sph = cartesianToSpherical(centre.x, centre.y, centre.z);
    st.updateLight(created.id, {
      name: 'Lumi-Curve',
      appearance: app,
      areaWidth: +(hw * 2).toFixed(2),
      areaHeight: +(hh * 2).toFixed(2),
      brightness: 300,
      transform: { ...created.transform, position: { x: centre.x, y: centre.y, z: centre.z }, spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height }, rotation: { ...created.transform.rotation, enabled: false } },
    } as Partial<Light>);
    st.selectLight(created.id);
    setStatus('Lumi-Curve light created. Edit its path and look under Light Appearance.');
    setTool('select');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 8px', flexWrap: 'wrap' }}>
        {([['select', 'Select / Move'], ['sun', 'Paint Sun'], ['curve', 'Draw Lumi-Curve']] as [Tool, string][]).map(([t, label]) => (
          <button key={t} className="btn-sm" onClick={() => setTool(t)} style={{ outline: tool === t ? '1px solid var(--accent-bright, #4af)' : 'none', opacity: tool === t ? 1 : 0.75 }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          Drag a light to move it · drag a corner to resize · <b>Shift</b> = keep total energy · wheel scales the selected light
        </span>
        {status && <span style={{ fontSize: 10, color: 'var(--text-sec)' }}>{status}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 6px' }}>
        <canvas
          ref={canvasRef}
          width={CW}
          height={CH}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onWheel={onWheel}
          style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: '2 / 1', borderRadius: 4, border: '1px solid var(--border, #333)', cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
        />
      </div>
    </div>
  );
};

function drawLight(ctx: CanvasRenderingContext2D, l: Light, f: LightFrame, sel: boolean) {
  const col = sel ? '#4af' : l.visible ? '#ffd24a' : '#777';
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 3 : 2;
  if (f.isRect) {
    const N = 12;
    ctx.beginPath();
    let prevU = 0;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    let first = true;
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const ax = ((corners[s][0] + (corners[s + 1][0] - corners[s][0]) * t) * f.width) / 2;
        const ay = ((corners[s][1] + (corners[s + 1][1] - corners[s][1]) * t) * f.height) / 2;
        const [u, v] = rectPointUv(f, ax, ay);
        if (first || Math.abs(u - prevU) > 0.5) ctx.moveTo(u * CW, v * CH); else ctx.lineTo(u * CW, v * CH);
        prevU = u; first = false;
      }
    }
    ctx.stroke();
    if (sel) {
      for (const cx of [-1, 1]) for (const cy of [-1, 1]) {
        const [u, v] = rectPointUv(f, (cx * f.width) / 2, (cy * f.height) / 2);
        ctx.fillRect(u * CW - 5, v * CH - 5, 10, 10);
      }
    }
  }
  const [cu, cv] = dirToUv(f.pos);
  ctx.beginPath(); ctx.arc(cu * CW, cv * CH, sel ? 7 : 5, 0, Math.PI * 2); ctx.fill();
  ctx.font = '12px sans-serif';
  ctx.fillText(l.name, cu * CW + 9, cv * CH - 8);
}
