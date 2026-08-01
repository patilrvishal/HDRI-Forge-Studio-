import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { RenderPipeline } from '../../three/engine';
import { RenderJob, type RenderJobState, type RenderJobOptions, type RenderJobResult } from '../../three/RenderJob';
import type { SceneManager } from '../../three/engine';

interface FinalRenderPanelProps {
  renderPipeline: RenderPipeline | null;
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
  onClose: () => void;
}

const RESOLUTION_PRESETS = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '2K', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
  { label: '8K', width: 7680, height: 4320 },
];

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG', desc: 'Lossless' },
  { value: 'jpeg', label: 'JPEG', desc: 'Smaller file' },
  { value: 'webp', label: 'WebP', desc: 'Modern format' },
] as const;

const MULTI_ANGLE_PRESETS = [
  { name: 'Front', position: [0, 1.5, 8] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] },
  { name: '3/4 Front', position: [5, 3, 5] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] },
  { name: 'Side', position: [8, 1.5, 0] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] },
  { name: '3/4 Rear', position: [-5, 3, -5] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] },
  { name: 'Rear', position: [0, 1.5, -8] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] },
];

type Tab = 'single' | 'multi' | 'history';

export interface ExportHistoryEntry {
  dataURL: string;
  width: number;
  height: number;
  format: string;
  timestamp: number;
  durationMs: number;
  label?: string;
}

export const FinalRenderPanel: React.FC<FinalRenderPanelProps> = ({
  renderPipeline,
  sceneManagerRef,
  onClose,
}) => {
  const [tab, setTab] = useState<Tab>('single');
  const [resolution, setResolution] = useState('4K');
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [jpegQuality, setJpegQuality] = useState(92);
  const [transparent, setTransparent] = useState(false);
  const [customWidth, setCustomWidth] = useState(3840);
  const [customHeight, setCustomHeight] = useState(2160);
  const [selectedAngles, setSelectedAngles] = useState<Set<string>>(new Set(['Front', '3/4 Front', 'Side', 'Rear']));

  const [renderState, setRenderState] = useState<RenderJobState | null>(null);
  const [multiProgress, setMultiProgress] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportHistoryEntry[]>(() => {
    try {
      const stored = sessionStorage.getItem('lightforge_export_history');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const renderJobRef = useRef<RenderJob | null>(null);
  const multiResultsRef = useRef<RenderJobResult[]>([]);

  // Cleanup render job on unmount
  useEffect(() => {
    return () => { renderJobRef.current = null; };
  }, []);

  // Persist history
  useEffect(() => {
    try {
      sessionStorage.setItem('lightforge_export_history', JSON.stringify(history.slice(0, 20)));
    } catch { /* ignore */ }
  }, [history]);

  const getDimensions = useCallback((): { width: number; height: number } => {
    if (resolution === 'custom') return { width: customWidth, height: customHeight };
    const preset = RESOLUTION_PRESETS.find((p) => p.label === resolution);
    return preset ? { width: preset.width, height: preset.height } : { width: 3840, height: 2160 };
  }, [resolution, customWidth, customHeight]);

  const dims = useMemo(() => getDimensions(), [getDimensions]);

  const handleSingleRender = useCallback(async () => {
    if (!renderPipeline) return;
    const job = new RenderJob(renderPipeline);
    renderJobRef.current = job;
    setPreviewUrl(null);

    const unsub = job.subscribe(setRenderState);
    try {
      const result = await job.execute({
        width: dims.width,
        height: dims.height,
        format,
        jpegQuality: jpegQuality / 100,
        transparent,
      });
      setPreviewUrl(result.dataURL);
      setHistory((prev) => [{ ...result, label: `${dims.width}x${dims.height}` }, ...prev].slice(0, 20));
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Render cancelled')) {
        console.error('Render failed:', err);
      }
    }
    unsub();
    renderJobRef.current = null;
  }, [renderPipeline, dims, format, jpegQuality, transparent]);

  const handleMultiRender = useCallback(async () => {
    if (!renderPipeline || selectedAngles.size === 0) return;
    const job = new RenderJob(renderPipeline);
    renderJobRef.current = job;
    multiResultsRef.current = [];
    setPreviewUrl(null);

    const angles = MULTI_ANGLE_PRESETS.filter((a) => selectedAngles.has(a.name));
    const allResults: ExportHistoryEntry[] = [];

    try {
      const results = await job.executeMultiAngle(
        { width: dims.width, height: dims.height, format, jpegQuality: jpegQuality / 100, transparent },
        angles,
        (current, total, name) => setMultiProgress(`Rendering ${current}/${total} — ${name}...`),
      );
      for (const r of results) {
        allResults.push({ ...r, label: (r as { angleName?: string }).angleName ?? 'Unknown' });
      }
      if (results.length > 0) setPreviewUrl(results[results.length - 1].dataURL);
      setHistory((prev) => [...allResults.reverse(), ...prev].slice(0, 20));
      setMultiProgress(`Done! ${results.length} angles rendered.`);
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Render cancelled')) {
        console.error('Multi-angle render failed:', err);
        setMultiProgress('');
      }
    }
    renderJobRef.current = null;
  }, [renderPipeline, dims, format, jpegQuality, transparent, selectedAngles]);

  const handleCancel = useCallback(() => {
    renderJobRef.current?.cancel();
  }, []);

  const handleDownload = useCallback(() => {
    if (renderState?.result) {
      const r = renderState.result;
      RenderJob.downloadResult(r, `lightforge_${dims.width}x${dims.height}.${r.format === 'jpeg' ? 'jpg' : r.format}`);
    }
  }, [renderState, dims]);

  const handleDownloadAllMulti = useCallback(() => {
    for (const r of multiResultsRef.current) {
      const name = (r as { angleName?: string }).angleName ?? 'angle';
      RenderJob.downloadResult(r, `lightforge_${name}_${r.width}x${r.height}.${r.format === 'jpeg' ? 'jpg' : r.format}`);
    }
  }, []);

  const toggleAngle = useCallback((name: string) => {
    setSelectedAngles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const isRendering = renderState?.status === 'rendering';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="export-dialog"
        style={{ width: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="export-dialog-header">
          <span className="export-dialog-title">Final Render</span>
          <button className="btn-icon" onClick={onClose} title="Close" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {(['single', 'multi', 'history'] as Tab[]).map((t) => (
            <div
              key={t}
              className={`tab-item ${tab === t ? 'active' : ''}`}
              style={{ flex: 1, textAlign: 'center', padding: '6px 0', cursor: 'pointer', fontSize: 11 }}
              onClick={() => setTab(t)}
            >
              {t === 'single' ? 'Single Render' : t === 'multi' ? 'Multi-Angle' : 'History'}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="export-dialog-body" style={{ flex: 1, overflow: 'auto' }}>
          {/* ── SINGLE RENDER TAB ── */}
          {tab === 'single' && (
            <>
              {/* Resolution */}
              <div className="export-section">
                <div className="export-section-label">Resolution</div>
                <div className="export-res-grid">
                  {RESOLUTION_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className={`export-res-btn ${resolution === p.label ? 'active' : ''}`}
                      onClick={() => setResolution(p.label)}
                    >
                      {p.label}
                      <span style={{ fontSize: 9, opacity: 0.6 }}>{p.width}x{p.height}</span>
                    </button>
                  ))}
                  <button
                    className={`export-res-btn ${resolution === 'custom' ? 'active' : ''}`}
                    onClick={() => setResolution('custom')}
                  >
                    Custom
                  </button>
                </div>
                {resolution === 'custom' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <div className="export-field">
                      <label>W</label>
                      <input type="number" className="kf-input" style={{ width: 72 }} value={customWidth} min={1} max={8192}
                        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) setCustomWidth(v); }} />
                    </div>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 14 }}>x</span>
                    <div className="export-field">
                      <label>H</label>
                      <input type="number" className="kf-input" style={{ width: 72 }} value={customHeight} min={1} max={8192}
                        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) setCustomHeight(v); }} />
                    </div>
                  </div>
                )}
                <div className="export-dim-info">Output: <strong>{dims.width} x {dims.height}</strong> pixels</div>
              </div>

              {/* Format */}
              <div className="export-section">
                <div className="export-section-label">Format</div>
                <div className="export-format-options">
                  {FORMAT_OPTIONS.map((f) => (
                    <button key={f.value} className={`export-format-btn ${format === f.value ? 'active' : ''}`}
                      onClick={() => setFormat(f.value as 'png' | 'jpeg' | 'webp')}>
                      <span className="export-format-name">{f.label}</span>
                      <span className="export-format-desc">{f.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* JPEG Quality */}
              {format !== 'png' && (
                <div className="export-section">
                  <div className="export-section-label">
                    Quality <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{jpegQuality}%</span>
                  </div>
                  <input type="range" min={10} max={100} step={1} value={jpegQuality}
                    onChange={(e) => setJpegQuality(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
                </div>
              )}

              {/* Transparent */}
              {format === 'png' && (
                <div className="export-section">
                  <div className="export-toggle-row">
                    <span className="export-section-label" style={{ marginBottom: 0 }}>Transparent Background</span>
                    <div className="toggle-track" style={transparent ? { background: 'var(--accent)' } : {}}
                      onClick={() => setTransparent(!transparent)}>
                      <div />
                    </div>
                  </div>
                </div>
              )}

              {/* Progress */}
              {isRendering && renderState && (
                <div className="export-section">
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div className="progress-bar-fill" style={{ width: `${renderState.progress}%`, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, textAlign: 'center' }}>
                    Rendering... {Math.round(renderState.progress)}%
                  </div>
                </div>
              )}

              {/* Preview */}
              {previewUrl && !isRendering && (
                <div className="export-section">
                  <div className="export-section-label">Preview</div>
                  <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <img src={previewUrl} alt="Render preview" style={{ width: '100%', display: 'block' }} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── MULTI-ANGLE TAB ── */}
          {tab === 'multi' && (
            <>
              <div className="export-section">
                <div className="export-section-label">Select Angles</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {MULTI_ANGLE_PRESETS.map((a) => (
                    <button
                      key={a.name}
                      className={`export-res-btn ${selectedAngles.has(a.name) ? 'active' : ''}`}
                      style={{ fontSize: 10, padding: '4px 10px' }}
                      onClick={() => toggleAngle(a.name)}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="export-section">
                <div className="export-section-label">Resolution</div>
                <div className="export-res-grid">
                  {RESOLUTION_PRESETS.filter((p) => p.label !== '8K').map((p) => (
                    <button key={p.label} className={`export-res-btn ${resolution === p.label ? 'active' : ''}`}
                      onClick={() => setResolution(p.label)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="export-dim-info">Output: <strong>{dims.width} x {dims.height}</strong> per angle</div>
              </div>

              {isRendering && (
                <div className="export-section">
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div className="progress-bar-fill" style={{ width: `${renderState?.progress ?? 0}%`, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, textAlign: 'center' }}>
                    {multiProgress}
                  </div>
                </div>
              )}

              {previewUrl && !isRendering && (
                <div className="export-section">
                  <div className="export-section-label">Last Rendered</div>
                  <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <img src={previewUrl} alt="Multi-angle preview" style={{ width: '100%', display: 'block' }} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── HISTORY TAB ── */}
          {tab === 'history' && (
            <div className="export-section">
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)', fontSize: 11 }}>
                  No exports yet. Render an image to see it here.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.map((entry, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 4, borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-base)', border: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => setPreviewUrl(entry.dataURL)}>
                      <img src={entry.dataURL} alt="" style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--text)' }}>{entry.label ?? 'Render'}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                          {entry.width}x{entry.height} · {entry.format.toUpperCase()} · {(entry.durationMs / 1000).toFixed(1)}s
                        </div>
                      </div>
                      <button className="btn-sm" style={{ padding: '2px 8px', fontSize: 9, flexShrink: 0 }}
                        onClick={(e) => { e.stopPropagation(); RenderJob.downloadResult(entry as RenderJobResult); }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                          <path d="M5 1v6M2 5l3 3 3-3" /><path d="M1 8h8" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="export-dialog-footer">
          <button className="btn-sm" onClick={onClose} disabled={isRendering}>Close</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {isRendering ? (
              <button className="btn-sm" onClick={handleCancel} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                Cancel
              </button>
            ) : tab === 'single' && previewUrl ? (
              <button className="btn-primary" onClick={handleDownload}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M5 1v6M2 5l3 3 3-3" /><path d="M1 8h8" />
                </svg>
                Download
              </button>
            ) : tab === 'multi' && previewUrl && !isRendering ? (
              <button className="btn-primary" onClick={handleDownloadAllMulti}>
                Download All
              </button>
            ) : (
              <button className="btn-primary" onClick={tab === 'multi' ? handleMultiRender : handleSingleRender}
                disabled={!renderPipeline || (tab === 'multi' && selectedAngles.size === 0)}>
                {tab === 'multi' ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <rect x="1" y="1" width="3" height="4" rx="0.5" /><rect x="6" y="1" width="3" height="4" rx="0.5" />
                      <rect x="1" y="6" width="3" height="3" rx="0.5" /><rect x="6" y="5" width="3" height="4" rx="0.5" />
                    </svg>
                    Render {selectedAngles.size} Angles
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <circle cx="5" cy="5" r="3.5" /><path d="M5 3v2.5" />
                    </svg>
                    Render
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};