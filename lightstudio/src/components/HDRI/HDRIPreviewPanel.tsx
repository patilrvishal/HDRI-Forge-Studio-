import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useLightsStore } from '../../store/lightsStore';
import { cartesianToSpherical, sphericalToCartesian } from '../../utils/math';
import { useSceneStore } from '../../store/sceneStore';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';
import { useHDRIShapesStore } from '../../store/hdriShapesStore';
import { Toggle } from '../UI/Toggle';

import {
  generateAnalyticalHDRI,
  loadActiveHDRILayers,
  gradientToEnvLayer,
  downloadHDRI,
  type EnvLayer,
} from '../../three/HDRIExporter';
import { compositeShapesCanvas, shapesCanvasToEnvLayer } from '../../three/HDRIShapesLayer';
import { promptForCustomHDRI } from '../../utils/loadCustomHDRI';

/** Preview always DISPLAYS at this CSS size (scaled by zoom) regardless of
 *  which resolution is selected - the canvas's actual pixel buffer is set
 *  to the selected resolution, so the browser downscales/upscales it for
 *  display exactly like any other image, and zooming in past 100% reveals
 *  the real extra detail a higher resolution actually renders. */
const DISPLAY_BASE_W = 512;
const DISPLAY_BASE_H = 256;

/** Debounce window - re-render only after the user stops dragging. */
const DEBOUNCE_MS = 300;

const RESOLUTIONS: Array<{ label: string; w: 512 | 1024 | 2048 | 4096 | 8192; h: 256 | 512 | 1024 | 2048 | 4096 }> = [
  { label: '512', w: 512, h: 256 },
  { label: '1K', w: 1024, h: 512 },
  { label: '2K', w: 2048, h: 1024 },
  { label: '4K', w: 4096, h: 2048 },
  { label: '8K', w: 8192, h: 4096 },
];

/**
 * Tone-map linear HDR floats into 8-bit RGBA for on-screen display.
 * Uses exposure + Reinhard + gamma 2.2 - this is DISPLAY ONLY and never
 * touches the exported file, which stays fully linear/unbounded.
 */
function tonemapToImageData(
  pixels: Float32Array,
  width: number,
  height: number,
  exposure: number,
): ImageData {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const si = i * 4;

    let r = pixels[si] * exposure;
    let g = pixels[si + 1] * exposure;
    let b = pixels[si + 2] * exposure;

    // Reinhard tone map - compresses the huge HDR range into 0..1
    r = r / (1 + r);
    g = g / (1 + g);
    b = b / (1 + b);

    // Gamma correction
    out[si] = Math.pow(Math.max(0, r), 1 / 2.2) * 255;
    out[si + 1] = Math.pow(Math.max(0, g), 1 / 2.2) * 255;
    out[si + 2] = Math.pow(Math.max(0, b), 1 / 2.2) * 255;
    out[si + 3] = 255;
  }

  return new ImageData(out, width, height);
}

/** Scan the raw float buffer so the user can see what is actually clipping. */
function analyzePixels(pixels: Float32Array): { max: number; clipped: number; total: number } {
  let max = 0;
  let clipped = 0;
  const total = pixels.length / 4;

  for (let i = 0; i < total; i++) {
    const si = i * 4;
    const lum = 0.2126 * pixels[si] + 0.7152 * pixels[si + 1] + 0.0722 * pixels[si + 2];
    if (lum > max) max = lum;
    if (lum >= 1.0) clipped++;
  }

  return { max, clipped, total };
}

/** Compact slider for the inline Transform mini-panel. */
const MiniSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit = '', onChange }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-sec)' }}>{label}</span>
      <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        {Number.isInteger(step) ? Math.round(value) : value.toFixed(3)}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ width: '100%' }}
    />
  </div>
);

export const HDRIPreviewPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pulled off window instead of context: this panel lives in the bottom dock,
  // which renders OUTSIDE the ThreeSceneProvider that wraps the viewport.
  const getScene = (): { scene: THREE.Scene } | null =>
    ((window as unknown as { __lightforgeScene?: { scene: THREE.Scene } }).__lightforgeScene) ?? null;

  const lights = useLightsStore((s) => s.lights);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const updateLightTransform = useLightsStore((s) => s.updateLightTransform);
  const updateLight = useLightsStore((s) => s.updateLight);
  const selectedLight = lights.find((l) => l.id === selectedLightId) ?? null;
  const environment = useSceneStore((s) => s.environment);
  const hdriAssets = useHDRIAssetStore((s) => s.assets);

  const shapes = useHDRIShapesStore((s) => s.shapes);
  const selectedShapeId = useHDRIShapesStore((s) => s.selectedShapeId);
  const updateShape = useHDRIShapesStore((s) => s.updateShape);
  const selectedShapeData = shapes.find((s) => s.id === selectedShapeId) ?? null;

  const livePreview = useHDRIShapesStore((s) => s.livePreview);
  const setLivePreview = useHDRIShapesStore((s) => s.setLivePreview);
  const draggingRef = useRef(false);
  // Single source of truth = renderSettings.exposure (same value driving the
  // live viewport and Render Settings > Exposure), so this panel always
  // reflects the real current exposure and stays in sync either direction.
  const exposure = useSceneStore((s) => s.renderSettings.exposure);
  const setSceneExposure = useSceneStore((s) => s.setExposure);
  const [resIndex, setResIndex] = useState(2); // default 2K
  const [format, setFormat] = useState<'hdr' | 'exr'>('hdr');
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<{ max: number; clipped: number; total: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomClamp = (z: number) => Math.max(0.5, Math.min(4, z));
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });

  const timerRef = useRef<number | null>(null);
  const layersRef = useRef<EnvLayer[]>([]);
  const pixelsRef = useRef<Float32Array | null>(null);
  const renderedResRef = useRef<{ w: number; h: number } | null>(null);

  /** Scroll-to-zoom, scoped to just the preview container. Attached as a
   *  native listener (not React's onWheel) because React/the browser treats
   *  wheel listeners as passive by default, which silently rejects
   *  preventDefault() and lets the scroll leak out to the rest of the page
   *  instead of staying contained here. */
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => zoomClamp(z + (e.deltaY > 0 ? -0.15 : 0.15)));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  /** Render the preview buffer, then paint it. */
  const renderPreview = useCallback(async (resIndexOverride?: number) => {
    const sm = getScene();
    const canvas = canvasRef.current;
    if (!sm || !canvas) return;

    setRendering(true);
    try {
      const layers = await loadActiveHDRILayers(environment.intensity ?? 1.0);

      // Gradient background acts as its own environment layer, same as a real
      // loaded HDRI, so it shows up in the preview and export instead of only
      // painting the viewport backdrop.
      const gb = useSceneStore.getState().environment.gradientBackground;
      const currentShapes = useHDRIShapesStore.getState().shapes;

      if (currentShapes.length > 0) {
        // Shapes are painted directly onto the gradient's own canvas (true
        // alpha-over) so a black shape actually blocks what's beneath it,
        // instead of being summed as a separate additive layer.
        const canvas = compositeShapesCanvas(currentShapes, gb?.enabled ? gb : null);
        layers.push(shapesCanvasToEnvLayer(canvas, environment.intensity ?? 1.0));
      } else if (gb?.enabled) {
        layers.push(gradientToEnvLayer(gb, environment.intensity ?? 1.0));
      }

      layersRef.current = layers;

      // Render at the SELECTED export resolution, not a fixed preview size,
      // so the resolution buttons actually change what you see, not just
      // what gets exported. The canvas still DISPLAYS at a fixed CSS size
      // (see DISPLAY_BASE_W/H below) - only the underlying pixel buffer
      // grows, exactly like zooming into a higher-res image reveals more
      // real detail instead of just stretching the same pixels.
      //
      // resIndexOverride lets a click handler pass the NEW index directly -
      // setResIndex() only schedules a state update, so reading `resIndex`
      // from this closure right after calling it would still see the OLD
      // value (React batches the update; it hasn't applied by the time this
      // async function actually runs), silently re-rendering at whatever
      // resolution was already selected instead of the one just clicked.
      const res = RESOLUTIONS[resIndexOverride ?? resIndex];
      const pixels = await generateAnalyticalHDRI(
        sm.scene,
        res.w,
        res.h,
        new THREE.Vector3(0, 0, 0),
        layers,
      );
      pixelsRef.current = pixels;
      renderedResRef.current = { w: res.w, h: res.h };

      setStats(analyzePixels(pixels));

      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = res.w;
        canvas.height = res.h;
        ctx.putImageData(tonemapToImageData(pixels, res.w, res.h, exposure), 0, 0);
      }
    } catch (e) {
      console.error('[LightForge] HDRI preview failed:', e);
    } finally {
      setRendering(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment.intensity, resIndex]);

  /** Re-render whenever lights, the environment, or the selected preview
   *  resolution change (debounced). Resolution is included so picking 4K/8K
   *  actually re-renders at that size instead of silently reusing whatever
   *  was last on screen. */
  useEffect(() => {
    // Auto-render is opt-in. The pixel loop runs on the CPU, so firing it on
    // every light tweak makes the whole app feel sluggish. Off by default.
    if (!livePreview) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void renderPreview();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [livePreview, lights, environment, hdriAssets, shapes, resIndex, renderPreview]);

  /** Exposure only re-paints - no need to re-run the expensive pixel loop. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const pixels = pixelsRef.current;
    const res = renderedResRef.current;
    if (!canvas || !pixels || !res) return;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(tonemapToImageData(pixels, res.w, res.h, exposure), 0, 0);
    }
  }, [exposure]);

  const handleExport = useCallback(async () => {
    const sm = getScene();
    if (!sm) return;

    const res = RESOLUTIONS[resIndex];
    setExporting(true);
    try {
      await downloadHDRI(sm.scene, {
        width: res.w,
        height: res.h,
        format,
        environmentGlobalIntensity: environment.intensity ?? 1.0,
        filename: `lightforge-${res.label}`,
      });
    } catch (e) {
      console.error('[LightForge] HDRI export failed:', e);
    } finally {
      setExporting(false);
    }
  }, [resIndex, format, environment.intensity]);

  const clipPct = stats ? ((stats.clipped / stats.total) * 100).toFixed(1) : '0.0';
  const clipWarn = stats ? stats.clipped / stats.total > 0.25 : false;

  /** Click-drag on the preview to reposition the selected shape (u/v). */
  const uvFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): { u: number; v: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { u, v };
  };

  /** Place the selected light at the true equirect direction under (u,v).
   *
   *  This app's spherical.lat is an ELEVATION angle used only to rescale the
   *  horizontal x/z radius - sphericalToCartesian sets Y straight from
   *  `height`, completely independent of lat. Setting lat alone (as an
   *  earlier version of this did) therefore only ever changed horizontal
   *  position - dragging up/down on the canvas never actually moved the
   *  light vertically, which is exactly the "only horizontal moves" bug.
   *
   *  Fixed by computing a real 3D direction from (u,v) - the same
   *  phi=v*PI / theta=(u-0.5)*2PI convention as HDRIShapesLayer's
   *  directionAt and HDRIExporter's pixelToDirection - and placing the
   *  light along that direction at its current distance from the origin,
   *  then re-deriving lat/lng/height from the resulting x/y/z via
   *  cartesianToSpherical so the light lands exactly on the clicked point,
   *  vertically and horizontally, not just in azimuth. */
  const placeLightFromUV = (uv: { u: number; v: number }) => {
    if (!selectedLight) return;
    const s = selectedLight.transform.spherical;
    const p = selectedLight.transform.position;
    const dist = Math.max(0.5, Math.hypot(p.x, p.y, p.z)) || Math.max(0.5, s.radius);

    const phi = uv.v * Math.PI;
    const theta = (uv.u - 0.5) * 2 * Math.PI;
    const sinPhi = Math.sin(phi);
    const dir = { x: sinPhi * Math.cos(theta), y: Math.cos(phi), z: sinPhi * Math.sin(theta) };

    const position = { x: dir.x * dist, y: dir.y * dist, z: dir.z * dist };
    const sph = cartesianToSpherical(position.x, position.y, position.z);
    updateLightTransform(selectedLight.id, {
      spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height },
      position,
    });
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Right button is reserved for panning (handled on the container) - only
    // the left button places a light/shape.
    if (e.button !== 0) return;
    if (selectedLight) {
      const uv = uvFromEvent(e);
      if (!uv) return;
      draggingRef.current = true;
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      placeLightFromUV(uv);
      return;
    }
    if (!selectedShapeId || selectedShapeData?.locked) return;
    const uv = uvFromEvent(e);
    if (!uv) return;
    draggingRef.current = true;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    updateShape(selectedShapeId, uv);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    if (selectedLight) {
      const uv = uvFromEvent(e);
      if (!uv) return;
      placeLightFromUV(uv);
      return;
    }
    if (!selectedShapeId || selectedShapeData?.locked) return;
    const uv = uvFromEvent(e);
    if (!uv) return;
    updateShape(selectedShapeId, uv);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    try {
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore - capture may already be released
    }
  };

  /** Right-click-hold-drag pans the preview by scrolling its container -
   *  only meaningful once zoomed in past the point the canvas overflows the
   *  frame, but harmless (no-op) otherwise. */
  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    e.preventDefault();
    panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore - can happen for a pointer the browser never registered as active
    }
  };

  const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current.active) return;
    const container = previewContainerRef.current;
    if (!container) return;
    const dx = e.clientX - panRef.current.lastX;
    const dy = e.clientY - panRef.current.lastY;
    panRef.current.lastX = e.clientX;
    panRef.current.lastY = e.clientY;
    container.scrollLeft -= dx;
    container.scrollTop -= dy;
  };

  const handleContainerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current.active) return;
    panRef.current.active = false;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore - capture may already be released
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, padding: 10, overflow: 'auto' }}>
      {/* Preview canvas */}
      <div
        ref={previewContainerRef}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: zoom <= 1 ? 'center' : 'flex-start',
          justifyContent: zoom <= 1 ? 'center' : 'flex-start',
          background: '#0a0a0c',
          border: '1px solid var(--border)',
          borderRadius: 4,
          position: 'relative',
          minWidth: 0,
          overflow: 'auto',
        }}
        onPointerDown={handleContainerPointerDown}
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerUp}
        onPointerLeave={handleContainerPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          style={{
            width: DISPLAY_BASE_W * zoom,
            height: DISPLAY_BASE_H * zoom,
            maxWidth: zoom <= 1 ? '100%' : 'none',
            maxHeight: zoom <= 1 ? '100%' : 'none',
            flexShrink: 0,
            imageRendering: 'auto',
            cursor: selectedLight || (selectedShapeId && !selectedShapeData?.locked) ? 'crosshair' : 'default',
          }}
        />

        {/* Zoom controls */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: 'rgba(20,20,26,0.85)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: 2,
          }}
        >
          <button
            className="btn-icon"
            style={{ width: 20, height: 20 }}
            onClick={() => setZoom((z) => zoomClamp(z - 0.25))}
            title="Zoom out"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
          </button>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', minWidth: 32, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="btn-icon"
            style={{ width: 20, height: 20 }}
            onClick={() => setZoom((z) => zoomClamp(z + 0.25))}
            title="Zoom in"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <line x1="1" y1="5" x2="9" y2="5" />
              <line x1="5" y1="1" x2="5" y2="9" />
            </svg>
          </button>
          <button
            className="btn-icon"
            style={{ width: 20, height: 20 }}
            onClick={() => setZoom(1)}
            title="Reset zoom"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
            </svg>
          </button>
        </div>

        {rendering && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: 8,
              fontSize: 10,
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            rendering...
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ width: 190, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, overflowY: 'auto', overflowX: 'hidden', maxHeight: '100%', paddingRight: 4 }}>
        <div className="section-header">HDRI Preview</div>

        {/* Custom HDRI - loads a .hdr/.hdri/.exr and activates it as the
            scene's environment. Same flow as the Environment panel's
            "+ Add HDRI" and the Create menu's "Custom HDRI..." entry. */}
        <button
          className="btn-sm"
          onClick={() => promptForCustomHDRI()}
          style={{ width: '100%', fontSize: 10, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="5" cy="5" r="4" />
            <path d="M5 1v8M1 5h8" opacity="0.5" />
          </svg>
          Custom HDRI
        </button>

        {/* Live preview toggle — off by default to keep the app responsive */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ fontSize: 11, color: 'var(--text-sec)' }}>Live Preview</span>
          <Toggle
            checked={livePreview}
            onChange={(next) => {
              setLivePreview(next);
              if (next) void renderPreview();
            }}
            variant="glossy"
          />
        </div>
        {!livePreview && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: -4 }}>
            Auto-refresh is off. Use Refresh Preview for a one-off render.
          </div>
        )}

        {shapes.length > 0 && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
            {shapes.length} HDRI {shapes.length === 1 ? 'shape' : 'shapes'} active — manage them in the
            Light List panel. {selectedShapeId ? 'Drag directly on the preview to reposition the selected one.' : 'Select one there to drag it here.'}
          </div>
        )}

        {/* Inline Transform - lets you push a light or shape's position/
            rotation/scale straight from the preview, without switching to
            the Properties panel. Calls the exact same store actions that
            panel uses, so edits here sync to the live 3D viewport the same
            way (real-time, for lights already; shapes bake into the same
            env layer this preview renders from). */}
        {!selectedLight && selectedShapeId && selectedShapeData && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
            <div className="section-header" style={{ marginBottom: 6 }}>Transform — {selectedShapeData.name}</div>
            <MiniSlider label="Position X" value={selectedShapeData.u} min={0} max={1} step={0.001}
              onChange={(v) => updateShape(selectedShapeData.id, { u: v })} />
            <MiniSlider label="Position Y" value={selectedShapeData.v} min={0} max={1} step={0.001}
              onChange={(v) => updateShape(selectedShapeData.id, { v })} />
            {selectedShapeData.type !== 'circle' && (
              <MiniSlider label="Rotation" value={selectedShapeData.rotation} min={0} max={360} step={1} unit="°"
                onChange={(v) => updateShape(selectedShapeData.id, { rotation: v })} />
            )}
            <MiniSlider label="Scale X" value={selectedShapeData.width} min={0.02} max={1} step={0.01}
              onChange={(v) => updateShape(selectedShapeData.id, { width: v })} />
            <MiniSlider label="Scale Y" value={selectedShapeData.height} min={0.02} max={1} step={0.01}
              onChange={(v) => updateShape(selectedShapeData.id, { height: v })} />
          </div>
        )}

        {selectedLight && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
            <div className="section-header" style={{ marginBottom: 6 }}>Transform — {selectedLight.name}</div>
            <MiniSlider label="Position X (Lng)" value={selectedLight.transform.spherical.lng} min={0} max={360} step={1} unit="°"
              onChange={(v) => {
                const s = selectedLight.transform.spherical;
                const next = { ...s, lng: v };
                updateLightTransform(selectedLight.id, { spherical: next, position: sphericalToCartesian(next.lat, next.lng, next.radius, next.height) });
              }} />
            <MiniSlider label="Position Y (Lat)" value={selectedLight.transform.spherical.lat} min={-90} max={90} step={1} unit="°"
              onChange={(v) => {
                const s = selectedLight.transform.spherical;
                const next = { ...s, lat: v };
                updateLightTransform(selectedLight.id, { spherical: next, position: sphericalToCartesian(next.lat, next.lng, next.radius, next.height) });
              }} />
            <MiniSlider label="Rotation X" value={selectedLight.transform.rotation.x} min={-180} max={180} step={1} unit="°"
              onChange={(v) => updateLightTransform(selectedLight.id, { rotation: { ...selectedLight.transform.rotation, x: v, enabled: true } })} />
            <MiniSlider label="Rotation Y" value={selectedLight.transform.rotation.y} min={-180} max={180} step={1} unit="°"
              onChange={(v) => updateLightTransform(selectedLight.id, { rotation: { ...selectedLight.transform.rotation, y: v, enabled: true } })} />
            {(selectedLight.type === 'area' || selectedLight.type === 'overhead') && (
              <>
                <MiniSlider label="Scale X (Width)" value={selectedLight.areaWidth} min={0.1} max={20} step={0.1}
                  onChange={(v) => updateLight(selectedLight.id, { areaWidth: v })} />
                <MiniSlider label="Scale Y (Height)" value={selectedLight.areaHeight} min={0.1} max={20} step={0.1}
                  onChange={(v) => updateLight(selectedLight.id, { areaHeight: v })} />
              </>
            )}
          </div>
        )}

        {/* Exposure - live-updates both this preview swatch and the actual
            viewport render (same value as Render Settings > Exposure).
            Never touches the exported HDRI/EXR file, which always stays
            fully linear/unbounded regardless of this setting. */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: 'var(--text-sec)' }}>View Exposure</span>
            <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {exposure.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0.01}
            max={5}
            step={0.01}
            value={exposure}
            onChange={(e) => setSceneExposure(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
            Also updates the live viewport and is baked into the exported file as a linear scale
          </div>
        </div>

        {/* Live stats - this is what tells you if the export is blown out */}
        <div
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            padding: 6,
            background: 'var(--bg-deep, #0a0a0c)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-dim)' }}>Max</span>
            <span style={{ color: 'var(--text-sec)' }}>{stats ? stats.max.toFixed(1) : '-'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-dim)' }}>Clipped</span>
            <span style={{ color: clipWarn ? '#e8484a' : 'var(--text-sec)' }}>{clipPct}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-dim)' }}>Env layers</span>
            <span style={{ color: 'var(--text-sec)' }}>{layersRef.current.length}</span>
          </div>
        </div>

        {clipWarn && (
          <div style={{ fontSize: 9, color: '#e8484a', lineHeight: 1.4 }}>
            Over a quarter of the image is clipping. Lower the light brightness or the
            environment intensity.
          </div>
        )}

        {/* Preview / Export resolution - drives both: the preview canvas
            re-renders its actual pixel buffer at whichever size is picked
            here, not just the exported file. */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 4 }}>
            Preview / Export Resolution
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {RESOLUTIONS.map((r, i) => (
              <button
                key={r.label}
                onClick={() => {
                  setResIndex(i);
                  void renderPreview(i);
                }}
                style={{
                  flex: '1 0 40px',
                  fontSize: 10,
                  padding: '4px 0',
                  background: resIndex === i ? 'var(--accent)' : 'transparent',
                  color: resIndex === i ? '#fff' : 'var(--text-sec)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          {RESOLUTIONS[resIndex].w >= 4096 && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 4 }}>
              {RESOLUTIONS[resIndex].label} renders every pixel analytically on the CPU - expect it to
              take noticeably longer, especially with Live Preview on.
            </div>
          )}
        </div>

        {/* Format */}
        <div style={{ display: 'flex', gap: 3 }}>
          {(['hdr', 'exr'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              style={{
                flex: 1,
                fontSize: 10,
                padding: '4px 0',
                background: format === f ? 'var(--accent)' : 'transparent',
                color: format === f ? '#fff' : 'var(--text-sec)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Export */}
        <button
          onClick={() => void handleExport()}
          disabled={exporting}
          style={{
            padding: '7px 0',
            fontSize: 11,
            background: exporting ? 'var(--border)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: exporting ? 'default' : 'pointer',
          }}
        >
          {exporting ? 'Exporting...' : `Export ${RESOLUTIONS[resIndex].label} ${format.toUpperCase()}`}
        </button>

        <button
          onClick={() => void renderPreview()}
          style={{
            padding: '5px 0',
            fontSize: 10,
            background: 'transparent',
            color: 'var(--text-sec)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Refresh Preview
        </button>
      </div>
    </div>
  );
};
