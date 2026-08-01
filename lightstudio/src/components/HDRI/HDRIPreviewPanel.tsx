import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useLightsStore } from '../../store/lightsStore';
import { useSceneStore } from '../../store/sceneStore';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';

import {
  generateAnalyticalHDRI,
  loadActiveHDRILayers,
  gradientToEnvLayer,
  downloadHDRI,
  type EnvLayer,
} from '../../three/HDRIExporter';

/** Preview is always rendered small so it stays interactive. */
const PREVIEW_W = 512;
const PREVIEW_H = 256;

/** Debounce window â€” re-render only after the user stops dragging. */
const DEBOUNCE_MS = 300;

const RESOLUTIONS: Array<{ label: string; w: 512 | 1024 | 2048 | 4096; h: 256 | 512 | 1024 | 2048 }> = [
  { label: '512', w: 512, h: 256 },
  { label: '1K', w: 1024, h: 512 },
  { label: '2K', w: 2048, h: 1024 },
  { label: '4K', w: 4096, h: 2048 },
];

/**
 * Tone-map linear HDR floats into 8-bit RGBA for on-screen display.
 * Uses exposure + Reinhard + gamma 2.2 â€” this is DISPLAY ONLY and never
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

    // Reinhard tone map â€” compresses the huge HDR range into 0..1
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

export const HDRIPreviewPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pulled off window instead of context: this panel lives in the bottom dock,
  // which renders OUTSIDE the ThreeSceneProvider that wraps the viewport.
  const getScene = (): { scene: THREE.Scene } | null =>
    ((window as unknown as { __lightforgeScene?: { scene: THREE.Scene } }).__lightforgeScene) ?? null;

  const lights = useLightsStore((s) => s.lights);
  const environment = useSceneStore((s) => s.environment);
  const hdriAssets = useHDRIAssetStore((s) => s.assets);

  const [livePreview, setLivePreview] = useState(false);
  const [exposure, setExposure] = useState(1.0);
  const [resIndex, setResIndex] = useState(2); // default 2K
  const [format, setFormat] = useState<'hdr' | 'exr'>('hdr');
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<{ max: number; clipped: number; total: number } | null>(null);

  const timerRef = useRef<number | null>(null);
  const layersRef = useRef<EnvLayer[]>([]);
  const pixelsRef = useRef<Float32Array | null>(null);

  /** Render the preview buffer, then paint it. */
  const renderPreview = useCallback(async () => {
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
      if (gb?.enabled) {
        layers.push(gradientToEnvLayer(gb, environment.intensity ?? 1.0));
      }

      layersRef.current = layers;

      const pixels = await generateAnalyticalHDRI(
        sm.scene,
        PREVIEW_W,
        PREVIEW_H,
        new THREE.Vector3(0, 0, 0),
        layers,
      );
      pixelsRef.current = pixels;

      setStats(analyzePixels(pixels));

      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = PREVIEW_W;
        canvas.height = PREVIEW_H;
        ctx.putImageData(tonemapToImageData(pixels, PREVIEW_W, PREVIEW_H, exposure), 0, 0);
      }
    } catch (e) {
      console.error('[LightForge] HDRI preview failed:', e);
    } finally {
      setRendering(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment.intensity]);

  /** Re-render whenever lights or the environment change (debounced). */
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
  }, [livePreview, lights, environment, hdriAssets, renderPreview]);

  /** Exposure only re-paints â€” no need to re-run the expensive pixel loop. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const pixels = pixelsRef.current;
    if (!canvas || !pixels) return;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(tonemapToImageData(pixels, PREVIEW_W, PREVIEW_H, exposure), 0, 0);
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

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, padding: 10, overflow: 'auto' }}>
      {/* Preview canvas */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0c',
          border: '1px solid var(--border)',
          borderRadius: 4,
          position: 'relative',
          minWidth: 0,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            imageRendering: 'auto',
          }}
        />
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

        {/* Live preview toggle — off by default to keep the app responsive */}
        <button
          onClick={() => {
            const next = !livePreview;
            setLivePreview(next);
            if (next) void renderPreview();
          }}
          style={{
            padding: '6px 0',
            fontSize: 11,
            background: livePreview ? 'var(--accent)' : 'transparent',
            color: livePreview ? '#fff' : 'var(--text-sec)',
            border: '1px solid ' + (livePreview ? 'var(--accent)' : 'var(--border)'),
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {livePreview ? 'Live Preview: ON' : 'Live Preview: OFF'}
        </button>
        {!livePreview && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: -4 }}>
            Auto-refresh is off. Use Refresh Preview for a one-off render.
          </div>
        )}

        {/* Exposure â€” display only */}
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
            onChange={(e) => setExposure(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
            Display only â€” not baked into the file
          </div>
        </div>

        {/* Live stats â€” this is what tells you if the export is blown out */}
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
            <span style={{ color: 'var(--text-sec)' }}>{stats ? stats.max.toFixed(1) : 'â€”'}</span>
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

        {/* Export resolution */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 4 }}>
            Export Resolution
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {RESOLUTIONS.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setResIndex(i)}
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
