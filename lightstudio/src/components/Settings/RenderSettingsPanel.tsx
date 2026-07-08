import React, { useCallback } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { Toggle } from '../UI/Toggle';
import { Slider } from '../UI/Slider';
import { Dropdown } from '../UI/Dropdown';
import { NumericInput } from '../UI/NumericInput';

const TONEMAP_OPTIONS = [
  { value: 'aces', label: 'ACES Filmic' },
  { value: 'reinhard', label: 'Reinhard' },
  { value: 'linear', label: 'Linear' },
];

const QUALITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const AA_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fxaa', label: 'FXAA' },
  { value: 'smaa', label: 'SMAA' },
  { value: 'taa', label: 'TAA' },
];

const SHADOW_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low (512)' },
  { value: 'medium', label: 'Medium (1024)' },
  { value: 'high', label: 'High (2048)' },
];

const EXPORT_FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'exr', label: 'EXR' },
];

const RESOLUTION_OPTIONS = [
  { value: '1k', label: '1K (1280×720)' },
  { value: '2k', label: '2K (1920×1080)' },
  { value: '4k', label: '4K (3840×2160)' },
  { value: 'custom', label: 'Custom' },
];

interface RenderSettingsPanelProps {
  onClose: () => void;
}

export const RenderSettingsPanel: React.FC<RenderSettingsPanelProps> = ({ onClose }) => {
  const rs = useSceneStore((s) => s.renderSettings);
  const setRenderSettings = useSceneStore((s) => s.setRenderSettings);
  const setBloom = useSceneStore((s) => s.setBloom);
  const setAO = useSceneStore((s) => s.setAO);
  const setExposure = useSceneStore((s) => s.setExposure);
  const setVignette = useSceneStore((s) => s.setVignette);
  const setColorGrading = useSceneStore((s) => s.setColorGrading);

  // ── Render quality ────────────────────────────────────────────────────────
  const handleQualityChange = useCallback(
    (v: string) => setRenderSettings({ quality: v as typeof rs.quality }),
    [setRenderSettings],
  );

  const handleToneMapChange = useCallback(
    (v: string) => setRenderSettings({ tonemapping: v as typeof rs.tonemapping }),
    [setRenderSettings],
  );

  const handleAAChange = useCallback(
    (v: string) => setRenderSettings({ antialiasing: v as typeof rs.antialiasing }),
    [setRenderSettings],
  );

  const handleShadowChange = useCallback(
    (v: string) => setRenderSettings({ shadowQuality: v as typeof rs.shadowQuality }),
    [setRenderSettings],
  );

  // ── Export settings ───────────────────────────────────────────────────────
  const handleFormatChange = useCallback(
    (v: string) => setRenderSettings({ exportFormat: v as typeof rs.exportFormat }),
    [setRenderSettings],
  );

  const handleResChange = useCallback(
    (v: string) => setRenderSettings({ renderResolution: v as typeof rs.renderResolution }),
    [setRenderSettings],
  );

  // ── Bloom ─────────────────────────────────────────────────────────────────
  const handleBloomToggle = useCallback(
    () => setBloom({ enabled: !rs.bloom.enabled }),
    [setBloom, rs.bloom.enabled],
  );
  const handleBloomIntensity = useCallback(
    (v: number) => setBloom({ intensity: v }),
    [setBloom],
  );
  const handleBloomThreshold = useCallback(
    (v: number) => setBloom({ threshold: v }),
    [setBloom],
  );
  const handleBloomRadius = useCallback(
    (v: number) => setBloom({ radius: v }),
    [setBloom],
  );

  // ── AO ────────────────────────────────────────────────────────────────────
  const handleAOToggle = useCallback(
    () => setAO({ enabled: !rs.ao.enabled }),
    [setAO, rs.ao.enabled],
  );
  const handleAORadius = useCallback(
    (v: number) => setAO({ radius: v }),
    [setAO],
  );
  const handleAOIntensity = useCallback(
    (v: number) => setAO({ intensity: v }),
    [setAO],
  );

  // ── Vignette ──────────────────────────────────────────────────────────────
  const handleVignetteToggle = useCallback(
    () => setVignette({ enabled: !rs.vignette.enabled }),
    [setVignette, rs.vignette.enabled],
  );
  const handleVignetteIntensity = useCallback(
    (v: number) => setVignette({ intensity: v }),
    [setVignette],
  );

  // ── Color grading ─────────────────────────────────────────────────────────
  const handleCGToggle = useCallback(
    () => setColorGrading({ enabled: !rs.colorGrading.enabled }),
    [setColorGrading, rs.colorGrading.enabled],
  );
  const handleCGBrightness = useCallback(
    (v: number) => setColorGrading({ brightness: v }),
    [setColorGrading],
  );
  const handleCGContrast = useCallback(
    (v: number) => setColorGrading({ contrast: v }),
    [setColorGrading],
  );
  const handleCGSaturation = useCallback(
    (v: number) => setColorGrading({ saturation: v }),
    [setColorGrading],
  );

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const handleAutoSaveToggle = useCallback(
    () => setRenderSettings({ autoSave: !rs.autoSave }),
    [setRenderSettings, rs.autoSave],
  );

  const handleAutoSaveInterval = useCallback(
    (v: number) => setRenderSettings({ autoSaveInterval: v }),
    [setRenderSettings],
  );

  // ── Reset to defaults ─────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    useSceneStore.getState().resetScene();
    onClose();
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="render-settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="rs-header">
          <span className="rs-title">Render Settings</span>
          <button className="btn-icon" onClick={onClose} aria-label="Close settings">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="rs-body">
          {/* ─── Render Quality ─────────────────────────────────── */}
          <Section title="Render Quality">
            <Dropdown label="Quality" value={rs.quality} options={QUALITY_OPTIONS} onChange={handleQualityChange} />
            <Dropdown label="Tone Map" value={rs.tonemapping} options={TONEMAP_OPTIONS} onChange={handleToneMapChange} />
            <Slider label="Exposure" value={rs.exposure} min={0.1} max={5} step={0.05} onChange={setExposure} unit=" EV" />
            <Dropdown label="AA" value={rs.antialiasing} options={AA_OPTIONS} onChange={handleAAChange} />
            <Dropdown label="Shadows" value={rs.shadowQuality} options={SHADOW_OPTIONS} onChange={handleShadowChange} />
          </Section>

          {/* ─── Bloom ─────────────────────────────────────────── */}
          <Section title="Bloom">
            <Toggle label="Enable" checked={rs.bloom.enabled} onChange={handleBloomToggle} />
            {rs.bloom.enabled && (
              <>
                <Slider label="Intensity" value={rs.bloom.intensity} min={0} max={3} step={0.05} onChange={handleBloomIntensity} />
                <Slider label="Threshold" value={rs.bloom.threshold} min={0} max={2} step={0.05} onChange={handleBloomThreshold} />
                <Slider label="Radius" value={rs.bloom.radius} min={0} max={2} step={0.05} onChange={handleBloomRadius} />
              </>
            )}
          </Section>

          {/* ─── Ambient Occlusion ─────────────────────────────── */}
          <Section title="Ambient Occlusion">
            <Toggle label="Enable" checked={rs.ao.enabled} onChange={handleAOToggle} />
            {rs.ao.enabled && (
              <>
                <Slider label="Radius" value={rs.ao.radius} min={0.01} max={2} step={0.01} onChange={handleAORadius} />
                <Slider label="Intensity" value={rs.ao.intensity} min={0} max={2} step={0.05} onChange={handleAOIntensity} />
              </>
            )}
            <div className="rs-note">Screen-space ambient occlusion (SSAO). Adds contact shadows in creases and corners.</div>
          </Section>

          {/* ─── Vignette ───────────────────────────────────────── */}
          <Section title="Vignette">
            <Toggle label="Enable" checked={rs.vignette.enabled} onChange={handleVignetteToggle} />
            {rs.vignette.enabled && (
              <Slider label="Intensity" value={rs.vignette.intensity} min={0} max={1} step={0.01} onChange={handleVignetteIntensity} />
            )}
          </Section>

          {/* ─── Color Grading ──────────────────────────────────── */}
          <Section title="Color Grading">
            <Toggle label="Enable" checked={rs.colorGrading.enabled} onChange={handleCGToggle} />
            {rs.colorGrading.enabled && (
              <>
                <Slider label="Brightness" value={rs.colorGrading.brightness} min={-1} max={1} step={0.01} onChange={handleCGBrightness} />
                <Slider label="Contrast" value={rs.colorGrading.contrast} min={-1} max={1} step={0.01} onChange={handleCGContrast} />
                <Slider label="Saturation" value={rs.colorGrading.saturation} min={-1} max={1} step={0.01} onChange={handleCGSaturation} />
              </>
            )}
          </Section>

          {/* ─── Export ─────────────────────────────────────────── */}
          <Section title="Export">
            <Dropdown label="Format" value={rs.exportFormat} options={EXPORT_FORMAT_OPTIONS} onChange={handleFormatChange} />
            <Dropdown label="Resolution" value={rs.renderResolution} options={RESOLUTION_OPTIONS} onChange={handleResChange} />
            {rs.renderResolution === 'custom' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <NumericInput label="Width" value={rs.customWidth} onChange={(v: number) => setRenderSettings({ customWidth: v })} min={320} max={7680} step={1} width="70px" />
                <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>×</span>
                <NumericInput label="Height" value={rs.customHeight} onChange={(v: number) => setRenderSettings({ customHeight: v })} min={240} max={4320} step={1} width="70px" />
              </div>
            )}
            <Toggle label="Auto Save" checked={rs.autoSave} onChange={handleAutoSaveToggle} />
            {rs.autoSave && (
              <NumericInput label="Interval" value={rs.autoSaveInterval} onChange={handleAutoSaveInterval} min={1} max={30} step={1} width="50px" />
            )}
          </Section>
        </div>

        {/* Footer */}
        <div className="rs-footer">
          <button className="btn-sm" onClick={handleReset}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 3.5A4 4 0 1 1 2 7" />
              <path d="M1 1v2.5h2.5" />
            </svg>
            Reset Defaults
          </button>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Section helper ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div className="rs-section">
    <div className="section-header">{title}</div>
    <div className="rs-section-body">{children}</div>
  </div>
);