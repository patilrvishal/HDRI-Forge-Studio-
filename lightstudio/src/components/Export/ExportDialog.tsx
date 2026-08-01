import React, { useState, useCallback, useMemo } from 'react';
import type { RenderPipeline } from '../../three/engine';
import {
  ImageExporter,
  DEFAULT_EXPORT_OPTIONS,
  RESOLUTION_LABELS,
} from '../../three/ImageExporter';
import type {
  ImageExportOptions,
  ExportFormat,
  ResolutionPreset,
} from '../../three/ImageExporter';

interface ExportDialogProps {
  renderPipeline: RenderPipeline | null;
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ renderPipeline, onClose }) => {
  const [options, setOptions] = useState<ImageExportOptions>({ ...DEFAULT_EXPORT_OPTIONS });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  // ── Estimated dimensions ────────────────────────────────────────────────
  const estimatedDimensions = useMemo(() => {
    // Get approximate viewport size (container width)
    const container = renderPipeline
      ? (renderPipeline as unknown as { _sm: { container: HTMLElement | null } })._sm.container
      : null;
    const vw = container?.clientWidth ?? 1280;
    const vh = container?.clientHeight ?? 720;
    return ImageExporter.getEstimatedDimensions(options, vw, vh);
  }, [options, renderPipeline]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const updateOption = useCallback(<K extends keyof ImageExportOptions>(
    key: K,
    value: ImageExportOptions[K],
  ) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
    setExportError(null);
  }, []);

  const handleExport = useCallback(async () => {
    if (!renderPipeline) {
      setExportError('No render pipeline available.');
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      await ImageExporter.exportImage(renderPipeline, options);
      const dims = ImageExporter.getEstimatedDimensions(
        options,
        1280,
        720,
      );
      setLastExport(
        `${options.format.toUpperCase()} ${dims.width}x${dims.height}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  }, [renderPipeline, options]);

  const handleQuickScreenshot = useCallback(() => {
    if (!renderPipeline) return;
    const dataURL = ImageExporter.quickCapture(renderPipeline);
    ImageExporter.downloadDataURL(dataURL, `lightforge_screenshot_${Date.now()}.png`);
    onClose();
  }, [renderPipeline, onClose]);

  const formatOptions: { value: ExportFormat; label: string; desc: string }[] = [
    { value: 'png', label: 'PNG', desc: 'Lossless, supports transparency' },
    { value: 'jpeg', label: 'JPEG', desc: 'Smaller file size, lossy' },
  ];

  const resolutionOptions: { value: ResolutionPreset; label: string }[] = [
    { value: '1x', label: RESOLUTION_LABELS['1x'] },
    { value: '2x', label: RESOLUTION_LABELS['2x'] },
    { value: '4k', label: RESOLUTION_LABELS['4k'] },
    { value: 'custom', label: RESOLUTION_LABELS['custom'] },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="export-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="export-dialog-header">
          <span className="export-dialog-title">Export Image</span>
          <button
            className="btn-icon"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="export-dialog-body">
          {/* Quick screenshot */}
          <div className="export-quick-row">
            <button
              className="btn-sm"
              onClick={handleQuickScreenshot}
              disabled={isExporting}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="2" width="8" height="6" rx="1" />
                <circle cx="5" cy="5" r="1.5" />
                <path d="M3 2V1h4v1" />
              </svg>
              Quick Screenshot
            </button>
            <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
              Saves current viewport as PNG
            </span>
          </div>

          <div className="export-sep" />

          {/* Format */}
          <div className="export-section">
            <div className="export-section-label">Format</div>
            <div className="export-format-options">
              {formatOptions.map((fmt) => (
                <button
                  key={fmt.value}
                  className={`export-format-btn ${options.format === fmt.value ? 'active' : ''}`}
                  onClick={() => updateOption('format', fmt.value)}
                >
                  <span className="export-format-name">{fmt.label}</span>
                  <span className="export-format-desc">{fmt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="export-section">
            <div className="export-section-label">Resolution</div>
            <div className="export-res-grid">
              {resolutionOptions.map((res) => (
                <button
                  key={res.value}
                  className={`export-res-btn ${options.resolution === res.value ? 'active' : ''}`}
                  onClick={() => updateOption('resolution', res.value)}
                >
                  {res.label}
                </button>
              ))}
            </div>

            {/* Estimated dimensions */}
            <div className="export-dim-info">
              Output: <strong>{estimatedDimensions.label}</strong> pixels
            </div>
          </div>

          {/* Custom resolution */}
          {options.resolution === 'custom' && (
            <div className="export-section">
              <div className="export-section-label">Custom Size</div>
              <div className="export-custom-size">
                <div className="export-field">
                  <label>Width</label>
                  <input
                    type="number"
                    className="kf-input"
                    style={{ width: 72 }}
                    value={options.customWidth}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v > 0) updateOption('customWidth', v);
                    }}
                    min={1}
                    max={8192}
                  />
                </div>
                <span style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 14 }}>x</span>
                <div className="export-field">
                  <label>Height</label>
                  <input
                    type="number"
                    className="kf-input"
                    style={{ width: 72 }}
                    value={options.customHeight}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v > 0) updateOption('customHeight', v);
                    }}
                    min={1}
                    max={8192}
                  />
                </div>
              </div>
            </div>
          )}

          {/* JPEG Quality */}
          {options.format === 'jpeg' && (
            <div className="export-section">
              <div className="export-section-label">
                Quality
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                  {Math.round(options.jpegQuality * 100)}%
                </span>
              </div>
              <div className="slider-row" style={{ margin: 0 }}>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={options.jpegQuality}
                  onChange={(e) => updateOption('jpegQuality', parseFloat(e.target.value))}
                />
              </div>
            </div>
          )}

          {/* Transparent background (PNG only) */}
          {options.format === 'png' && (
            <div className="export-section">
              <div className="export-toggle-row">
                <span className="export-section-label" style={{ marginBottom: 0 }}>Transparent Background</span>
                <div
                  className="toggle-track"
                  style={options.transparent ? { background: 'var(--accent)' } : {}}
                  onClick={() => updateOption('transparent', !options.transparent)}
                >
                  <div />
                </div>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
                Removes the scene background, exports with alpha channel
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {exportError && (
          <div className="export-error">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="5" cy="5" r="4" />
              <path d="M5 3v2.5M5 7v.5" />
            </svg>
            {exportError}
          </div>
        )}

        {/* Success */}
        {lastExport && !exportError && (
          <div className="export-success">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 5l2 2 4-4" />
            </svg>
            Exported as {lastExport}
          </div>
        )}

        {/* Footer */}
        <div className="export-dialog-footer">
          <button className="btn-sm" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                Exporting...
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M5 1v6M2 5l3 3 3-3" />
                  <path d="M1 8h8" />
                </svg>
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};