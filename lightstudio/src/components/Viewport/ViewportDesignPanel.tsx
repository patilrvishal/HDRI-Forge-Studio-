import React, { useState, useCallback } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { sphericalToCartesian } from '../../utils/math';

// â”€â”€ Section toggle chevron â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
    <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// â”€â”€ Compact inline slider row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MiniSlider: React.FC<{
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; unit?: string; color?: string;
}> = ({ label, value, min, max, step = 0.01, onChange, unit = '', color }) => {
  const safeValue = Number.isFinite(value) ? value : min;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 68, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-ui)', letterSpacing: '0.3px' }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={safeValue}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, height: 3, accentColor: color ?? 'var(--accent)', cursor: 'pointer' }}
      />
      <span style={{ fontSize: 9, color: 'var(--text-sec)', width: 36, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {step >= 1 ? Math.round(safeValue) : safeValue.toFixed(2)}{unit}
      </span>
    </div>
  );
};

// â”€â”€ Color swatch input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ColorDot: React.FC<{
  color: string; onChange: (c: string) => void; size?: number;
}> = ({ color, onChange, size = 18 }) => (
  <div style={{ position: 'relative', width: size, height: size, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-light)', flexShrink: 0 }}>
    <input
      type="color" value={color} onChange={(e) => onChange(e.target.value)}
      style={{ position: 'absolute', inset: -4, width: size + 8, height: size + 8, border: 'none', cursor: 'pointer', padding: 0 }}
    />
  </div>
);

// â”€â”€ Collapsible section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const Section: React.FC<{
  title: string; icon?: string; defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', userSelect: 'none' }}
      >
        <Chevron open={open} />
        {icon && <span style={{ fontSize: 11 }}>{icon}</span>}
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-sec)', flex: 1 }}>{title}</span>
      </div>
      {open && <div style={{ padding: '4px 8px 6px 82px' }}>{children}</div>}
    </div>
  );
};

// â”€â”€ Cinematic 3-Light preset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CINEMATIC_PRESETS = [
  {
    name: 'Cinematic 3-Light',
    key: '#4a7bcb',
    fill: '#f0a868',
    ambient: '#1e2535',
    keyPos: { lat: 35, lng: 315, radius: 6, height: 4 },
    fillPos: { lat: 25, lng: 45, radius: 5, height: 3 },
    keyBrightness: 250,
    fillBrightness: 120,
    ambBrightness: 40,
    bgTop: '#0a0e1a',
    bgBottom: '#1a1f2e',
    exposure: 1.1,
    contrast: 0.15,
    bloomIntensity: 0.25,
    vignetteIntensity: 0.25,
  },
  {
    name: 'Neon Noir',
    key: '#00d4ff',
    fill: '#ff2d7b',
    ambient: '#0a0a14',
    keyPos: { lat: 40, lng: 270, radius: 5, height: 3 },
    fillPos: { lat: 20, lng: 90, radius: 6, height: 2 },
    keyBrightness: 200,
    fillBrightness: 150,
    ambBrightness: 20,
    bgTop: '#05050a',
    bgBottom: '#0f0f1a',
    exposure: 0.9,
    contrast: 0.25,
    bloomIntensity: 0.5,
    vignetteIntensity: 0.35,
  },
  {
    name: 'Golden Hour',
    key: '#ffb347',
    fill: '#6eb5ff',
    ambient: '#2a1f14',
    keyPos: { lat: 15, lng: 250, radius: 8, height: 2 },
    fillPos: { lat: 50, lng: 60, radius: 7, height: 5 },
    keyBrightness: 300,
    fillBrightness: 80,
    ambBrightness: 30,
    bgTop: '#1a1008',
    bgBottom: '#2a1f0e',
    exposure: 1.2,
    contrast: 0.1,
    bloomIntensity: 0.3,
    vignetteIntensity: 0.2,
  },
  {
    name: 'Arctic Cool',
    key: '#8ecae6',
    fill: '#e0e8ff',
    ambient: '#0d1520',
    keyPos: { lat: 60, lng: 300, radius: 7, height: 5 },
    fillPos: { lat: 30, lng: 120, radius: 6, height: 2 },
    keyBrightness: 180,
    fillBrightness: 100,
    ambBrightness: 35,
    bgTop: '#080e18',
    bgBottom: '#141e2e',
    exposure: 1.0,
    contrast: 0.08,
    bloomIntensity: 0.15,
    vignetteIntensity: 0.2,
  },
];

// â”€â”€ Main Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ViewportDesignPanel: React.FC = () => {
  const environment = useSceneStore((s) => s.environment);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);
  const renderSettings = useSceneStore((s) => s.renderSettings);
  const setRenderSettings = useSceneStore((s) => s.setRenderSettings);
  const setBloom = useSceneStore((s) => s.setBloom);
  const setAO = useSceneStore((s) => s.setAO);
  const showGrid = useSceneStore((s) => s.showGrid);
  const toggleGrid = useSceneStore((s) => s.toggleGrid);

  const lights = useLightsStore((s) => s.lights);
  const addLight = useLightsStore((s) => s.addLight);
  const updateLight = useLightsStore((s) => s.updateLight);
  const setLightsFromPreset = useLightsStore((s) => s.setLightsFromPreset);

  // â”€â”€ Apply cinematic preset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const applyCinematicPreset = useCallback((preset: typeof CINEMATIC_PRESETS[0]) => {
    // Clear existing lights and create 3 new ones
    setLightsFromPreset([]);

    // Create key light
    addLight('point');
    const keyIdx = useLightsStore.getState().lights.length - 1;
    const keyLight = useLightsStore.getState().lights[keyIdx];
    if (keyLight) {
      const keyCart = sphericalToCartesian(preset.keyPos.lat, preset.keyPos.lng, preset.keyPos.radius, preset.keyPos.height);
      updateLight(keyLight.id, {
        name: 'Key Light',
        color: preset.key,
        brightness: preset.keyBrightness,
        visible: true,
        type: 'directional',
        falloff: 'none',
        transform: {
          ...keyLight.transform,
          spherical: preset.keyPos,
          position: keyCart,
        },
      });
    }

    // Create fill light
    addLight('point');
    const fillIdx = useLightsStore.getState().lights.length - 1;
    const fillLight = useLightsStore.getState().lights[fillIdx];
    if (fillLight) {
      const fillCart = sphericalToCartesian(preset.fillPos.lat, preset.fillPos.lng, preset.fillPos.radius, preset.fillPos.height);
      updateLight(fillLight.id, {
        name: 'Fill Light',
        color: preset.fill,
        brightness: preset.fillBrightness,
        visible: true,
        type: 'directional',
        falloff: 'none',
        transform: {
          ...fillLight.transform,
          spherical: preset.fillPos,
          position: fillCart,
        },
      });
    }

    // Create ambient light
    addLight('point');
    const ambIdx = useLightsStore.getState().lights.length - 1;
    const ambLight = useLightsStore.getState().lights[ambIdx];
    if (ambLight) {
      updateLight(ambLight.id, {
        name: 'Ambient',
        color: preset.ambient,
        brightness: preset.ambBrightness,
        visible: true,
        type: 'point',
        falloff: 'none',
        transform: {
          ...ambLight.transform,
          spherical: { lat: 90, lng: 0, radius: 0.1, height: 5 },
          position: { x: 0, y: 5, z: 0 },
        },
      });
    }

    // Background
    setEnvironment({ background: preset.bgBottom, showBackground: true });

    // Post-processing
    setRenderSettings({ exposure: preset.exposure });
    setBloom({ enabled: true, intensity: preset.bloomIntensity, threshold: 0.8, radius: 0.4 });
    setAO({ enabled: true, radius: 0.8, intensity: 0.5 });

    // Color grading
    setRenderSettings({
      colorGrading: { enabled: true, brightness: 0, contrast: preset.contrast, saturation: 0.1 },
    });

    // Vignette
    useSceneStore.getState().setRenderSettings({
      vignette: { enabled: true, intensity: preset.vignetteIntensity },
    });
  }, [addLight, updateLight, setLightsFromPreset, setEnvironment, setRenderSettings, setBloom, setAO]);

  // â”€â”€ Helpers to update the first two lights (key + fill) â”€â”€â”€â”€â”€â”€â”€
  const getKeyLight = () => lights[0];
  const getFillLight = () => lights[1];
  const getAmbientLight = () => lights[2];

  const updateKeyLight = (updates: Record<string, unknown>) => {
    const l = getKeyLight();
    if (l) updateLight(l.id, updates as any);
  };
  const updateFillLight = (updates: Record<string, unknown>) => {
    const l = getFillLight();
    if (l) updateLight(l.id, updates as any);
  };
  const updateAmbientLight = (updates: Record<string, unknown>) => {
    const l = getAmbientLight();
    if (l) updateLight(l.id, updates as any);
  };

  const keyLight = getKeyLight();
  const fillLight = getFillLight();
  const ambLight = getAmbientLight();

  return (
    <div className="vp-design-panel">
      {/* â”€â”€ Preset Buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={{ padding: '6px 8px 4px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-dim)', marginBottom: 4 }}>
          Quick Presets
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CINEMATIC_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyCinematicPreset(p)}
              className="vp-design-preset-btn"
              title={`Apply ${p.name}`}
            >
              <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.key, display: 'inline-block' }} />
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block' }} />
              </span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* â”€â”€ 3-Light Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Section title="3-Light Setup" icon="ðŸ’¡" defaultOpen={true}>
        {/* Key Light */}
        <div style={{ fontSize: 8, fontWeight: 600, color: '#7db8f0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, marginTop: 4 }}>
          {keyLight ? `Key â€” ${keyLight.name}` : 'Key Light (not created)'}
        </div>
        {keyLight && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <ColorDot color={keyLight.color} onChange={(c) => updateKeyLight({ color: c })} />
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{keyLight.color}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>
                Lat {Math.round(keyLight.transform.spherical.lat)}Â° / Lng {Math.round(keyLight.transform.spherical.lng)}Â°
              </span>
            </div>
            <MiniSlider label="Brightness" value={keyLight.brightness} min={0} max={500} step={1} onChange={(v) => updateKeyLight({ brightness: v })} />
            <MiniSlider label="Latitude" value={keyLight.transform.spherical.lat} min={-90} max={90} step={1} unit="Â°" onChange={(v) => {
              const s = { ...keyLight.transform.spherical, lat: v };
              const cart = sphericalToCartesian(s.lat, s.lng, s.radius, s.height);
              updateKeyLight({ transform: { ...keyLight.transform, spherical: s, position: cart } });
            }} />
            <MiniSlider label="Longitude" value={keyLight.transform.spherical.lng} min={0} max={360} step={1} unit="Â°" onChange={(v) => {
              const s = { ...keyLight.transform.spherical, lng: v };
              const cart = sphericalToCartesian(s.lat, s.lng, s.radius, s.height);
              updateKeyLight({ transform: { ...keyLight.transform, spherical: s, position: cart } });
            }} />
            <MiniSlider label="Height" value={keyLight.transform.spherical.height} min={-2} max={12} step={0.1} onChange={(v) => {
              const s = { ...keyLight.transform.spherical, height: v };
              const cart = sphericalToCartesian(s.lat, s.lng, s.radius, s.height);
              updateKeyLight({ transform: { ...keyLight.transform, spherical: s, position: cart } });
            }} />
          </>
        )}

        {/* Fill Light */}
        <div style={{ fontSize: 8, fontWeight: 600, color: '#f0a868', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, marginTop: 8 }}>
          {fillLight ? `Fill â€” ${fillLight.name}` : 'Fill Light (not created)'}
        </div>
        {fillLight && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <ColorDot color={fillLight.color} onChange={(c) => updateFillLight({ color: c })} />
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{fillLight.color}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>
                Lat {Math.round(fillLight.transform.spherical.lat)}Â° / Lng {Math.round(fillLight.transform.spherical.lng)}Â°
              </span>
            </div>
            <MiniSlider label="Brightness" value={fillLight.brightness} min={0} max={500} step={1} onChange={(v) => updateFillLight({ brightness: v })} />
            <MiniSlider label="Latitude" value={fillLight.transform.spherical.lat} min={-90} max={90} step={1} unit="Â°" onChange={(v) => {
              const s = { ...fillLight.transform.spherical, lat: v };
              const cart = sphericalToCartesian(s.lat, s.lng, s.radius, s.height);
              updateFillLight({ transform: { ...fillLight.transform, spherical: s, position: cart } });
            }} />
            <MiniSlider label="Longitude" value={fillLight.transform.spherical.lng} min={0} max={360} step={1} unit="Â°" onChange={(v) => {
              const s = { ...fillLight.transform.spherical, lng: v };
              const cart = sphericalToCartesian(s.lat, s.lng, s.radius, s.height);
              updateFillLight({ transform: { ...fillLight.transform, spherical: s, position: cart } });
            }} />
          </>
        )}

        {/* Ambient Light */}
        <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, marginTop: 8 }}>
          {ambLight ? `Ambient â€” ${ambLight.name}` : 'Ambient Light (not created)'}
        </div>
        {ambLight && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <ColorDot color={ambLight.color} onChange={(c) => updateAmbientLight({ color: c })} />
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{ambLight.color}</span>
            </div>
            <MiniSlider label="Brightness" value={ambLight.brightness} min={0} max={200} step={1} onChange={(v) => updateAmbientLight({ brightness: v })} />
          </>
        )}
      </Section>

      {/* â”€â”€ Background â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Section title="Background" icon="ðŸŽ¨">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <ColorDot color={environment.background} onChange={(c) => setEnvironment({ background: c })} size={20} />
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>{environment.background}</span>
        </div>
        <MiniSlider label="Env Intensity" value={environment.intensity} min={0} max={3} step={0.05} onChange={(v) => setEnvironment({ intensity: v })} />
        <MiniSlider label="HDRI Rotation" value={environment.rotation} min={0} max={360} step={1} unit="Â°" onChange={(v) => setEnvironment({ rotation: v })} />
      </Section>

      {/* â”€â”€ Post-Processing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Section title="Post-Processing" icon="âœ¨">
        <MiniSlider label="Exposure" value={renderSettings.exposure} min={0.1} max={5} step={0.05} onChange={(v) => setRenderSettings({ exposure: v })} />
        <MiniSlider label="Bloom" value={renderSettings.bloom.enabled ? renderSettings.bloom.intensity : 0} min={0} max={2} step={0.01} onChange={(v) => {
          setBloom({ enabled: v > 0.01, intensity: v, threshold: renderSettings.bloom.threshold, radius: renderSettings.bloom.radius });
        }} />
        <MiniSlider label="Bloom Thresh" value={renderSettings.bloom.threshold} min={0} max={2} step={0.01} onChange={(v) => setBloom({ ...renderSettings.bloom, threshold: v })} />
        <MiniSlider label="Vignette" value={renderSettings.vignette.enabled ? renderSettings.vignette.intensity : 0} min={0} max={1} step={0.01} onChange={(v) => {
          useSceneStore.getState().setRenderSettings({ vignette: { enabled: v > 0.01, intensity: v } });
        }} />
        <MiniSlider label="AO Strength" value={renderSettings.ao.enabled ? renderSettings.ao.intensity : 0} min={0} max={2} step={0.01} onChange={(v) => {
          setAO({ enabled: v > 0.01, intensity: v, radius: renderSettings.ao.radius });
        }} />
        <MiniSlider label="AO Radius" value={renderSettings.ao.radius} min={0.1} max={3} step={0.05} onChange={(v) => setAO({ ...renderSettings.ao, radius: v })} />
      </Section>

      {/* â”€â”€ Color Grading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Section title="Color Grading" icon="ðŸŒˆ">
        <MiniSlider label="Brightness" value={renderSettings.colorGrading.enabled ? renderSettings.colorGrading.brightness : 0} min={-1} max={1} step={0.01} onChange={(v) => {
          setRenderSettings({ colorGrading: { enabled: true, brightness: v, contrast: renderSettings.colorGrading.contrast, saturation: renderSettings.colorGrading.saturation } });
        }} />
        <MiniSlider label="Contrast" value={renderSettings.colorGrading.enabled ? renderSettings.colorGrading.contrast : 0} min={-1} max={1} step={0.01} onChange={(v) => {
          setRenderSettings({ colorGrading: { enabled: true, brightness: renderSettings.colorGrading.brightness, contrast: v, saturation: renderSettings.colorGrading.saturation } });
        }} />
        <MiniSlider label="Saturation" value={renderSettings.colorGrading.enabled ? renderSettings.colorGrading.saturation : 0} min={-1} max={1} step={0.01} onChange={(v) => {
          setRenderSettings({ colorGrading: { enabled: true, brightness: renderSettings.colorGrading.brightness, contrast: renderSettings.colorGrading.contrast, saturation: v } });
        }} />
      </Section>

      {/* â”€â”€ Grid & Ground â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Section title="Grid & Ground" icon="ðŸ“">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
          <button
            onClick={toggleGrid}
            style={{
              fontSize: 9, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border-light)',
              background: showGrid ? 'var(--accent-bg)' : 'transparent', color: showGrid ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
            }}
          >
            {showGrid ? 'Grid ON' : 'Grid OFF'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <ColorDot color={renderSettings.ground.color} onChange={(c) => setRenderSettings({ ground: { ...renderSettings.ground, color: c } })} size={16} />
          </div>
        </div>
        <MiniSlider label="Reflection" value={renderSettings.ground.reflectionSharpness} min={0} max={1} step={0.01} onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, reflectionSharpness: v } })} />
        <MiniSlider label="Roughness" value={renderSettings.ground.roughness} min={0} max={1} step={0.01} onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, roughness: v } })} />
        <MiniSlider label="Metalness" value={renderSettings.ground.metalness} min={0} max={1} step={0.01} onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, metalness: v } })} />
        <MiniSlider label="Fade Radius" value={renderSettings.ground.fadeRadius} min={0} max={20} step={0.5} onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, fadeRadius: v } })} />

        {/* Show / hide the floor plane entirely */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0' }}>
          <span style={{ fontSize: 10, color: 'var(--text-sec)' }}>Floor Plane</span>
          <button
            onClick={() => setRenderSettings({ ground: { ...renderSettings.ground, visible: !renderSettings.ground.visible } })}
            style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
              background: renderSettings.ground.visible ? 'var(--accent)' : 'transparent',
              color: renderSettings.ground.visible ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)',
            }}
          >
            {renderSettings.ground.visible ? 'ON' : 'OFF'}
          </button>
        </div>

        {renderSettings.ground.visible && (
          <>
            <MiniSlider label="Size" value={renderSettings.ground.size ?? 40} min={1} max={200} step={1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, size: v } })} />

            <MiniSlider label="Pos X" value={renderSettings.ground.position?.x ?? 0} min={-50} max={50} step={0.1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, position: { ...renderSettings.ground.position, x: v } } })} />
            <MiniSlider label="Pos Y" value={renderSettings.ground.position?.y ?? 0} min={-20} max={20} step={0.1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, position: { ...renderSettings.ground.position, y: v } } })} />
            <MiniSlider label="Pos Z" value={renderSettings.ground.position?.z ?? 0} min={-50} max={50} step={0.1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, position: { ...renderSettings.ground.position, z: v } } })} />

            <MiniSlider label="Rot X" value={renderSettings.ground.rotation?.x ?? 0} min={-180} max={180} step={1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, rotation: { ...renderSettings.ground.rotation, x: v } } })} />
            <MiniSlider label="Rot Y" value={renderSettings.ground.rotation?.y ?? 0} min={-180} max={180} step={1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, rotation: { ...renderSettings.ground.rotation, y: v } } })} />
            <MiniSlider label="Rot Z" value={renderSettings.ground.rotation?.z ?? 0} min={-180} max={180} step={1}
              onChange={(v) => setRenderSettings({ ground: { ...renderSettings.ground, rotation: { ...renderSettings.ground.rotation, z: v } } })} />

            {/* Bake into HDRI or keep it viewport-only */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-sec)' }}>Include in HDRI</span>
              <button
                onClick={() => setRenderSettings({ ground: { ...renderSettings.ground, includeInHDRI: !renderSettings.ground.includeInHDRI } })}
                style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                  background: renderSettings.ground.includeInHDRI ? 'var(--accent)' : 'transparent',
                  color: renderSettings.ground.includeInHDRI ? '#fff' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                }}
              >
                {renderSettings.ground.includeInHDRI ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-dim)', lineHeight: 1.3, marginTop: 2 }}>
              Off = viewport only. On = baked into the exported HDRI.
            </div>
          </>
        )}
      </Section>
    </div>
  );
};