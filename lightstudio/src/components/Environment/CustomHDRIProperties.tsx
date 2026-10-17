import React, { useMemo, useState } from 'react';
import { useHDRIAssetStore, HDRI_ASSET_GRADING_DEFAULTS, type HDRIExtra } from '../../store/hdriAssetStore';
import { useSceneStore } from '../../store/sceneStore';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { EditHdriSection } from './EditHdriSection';
import { hasEdits } from '../../hdriedit/envSource';
import { driveViewportWith, getLiveAssetId } from '../../hdriedit/viewportEnv';

/** Matches LightProperties/HDRIShapeProperties' CollapsibleSection so all
 *  three property panels read as one system. */
const CollapsibleSection: React.FC<{
  title: string;
  headerRight?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, headerRight, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="props-section">
      <div
        className="section-header"
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="currentColor"
          style={{
            flexShrink: 0,
            opacity: 0.65,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path d="M2 0l4 4-4 4z" />
        </svg>
        <span style={{ flex: 1 }}>{title}</span>
        {headerRight && (
          <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
            {headerRight}
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
};

export const CustomHDRIProperties: React.FC = () => {
  const selectedAssetId = useHDRIAssetStore((s) => s.selectedAssetId);
  const assets = useHDRIAssetStore((s) => s.assets);
  const updateAsset = useHDRIAssetStore((s) => s.updateAsset);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);
  const environment = useSceneStore((s) => s.environment);

  const asset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  if (!asset) return null;

  // Optional controls are undefined on older projects: read them with their defaults.
  const val = (k: keyof typeof HDRI_ASSET_GRADING_DEFAULTS): number => Number(asset[k] ?? HDRI_ASSET_GRADING_DEFAULTS[k]);
  const resetPatch = (keys: Array<keyof typeof HDRI_ASSET_GRADING_DEFAULTS>): HDRIExtra =>
    Object.fromEntries(keys.map((k) => [k, HDRI_ASSET_GRADING_DEFAULTS[k]])) as HDRIExtra;

  // This asset is also the one actually driving the live 3D viewport
  // (environment.hdri is a single global slot, not per-asset) only when its
  // blob URL matches what's currently loaded there.
  const drivesViewport = (environment.presetId === '__custom__' && environment.hdri === asset.blobUrl && !hasEdits(asset)) || (hasEdits(asset) && getLiveAssetId() === asset.id);

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <CollapsibleSection
        title="Custom HDRI"
        headerRight={
          <Toggle
            checked={asset.active}
            onChange={(v) => updateAsset(asset.id, { active: v })}
          />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-sec)' }}>Name</span>
            <input
              className="field-input"
              value={asset.name}
              onChange={(e) => updateAsset(asset.id, { name: e.target.value })}
              style={{ width: 130, fontSize: 11 }}
            />
          </div>

          {!drivesViewport && (
            <button
              className="btn-sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                if (hasEdits(asset)) {
                  void driveViewportWith(asset.id);
                } else if (asset.blobUrl) {
                  setEnvironment({ hdri: asset.blobUrl, presetId: '__custom__', showBackground: true });
                }
              }}
            >
              Set as live viewport environment
            </button>
          )}
          {drivesViewport && (
            <div style={{ fontSize: 9, color: 'var(--accent)', lineHeight: 1.4 }}>
              Driving the live 3D viewport&apos;s background/reflections.
            </div>
          )}
          {!drivesViewport && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4 }}>
              Still contributes to the HDRI Preview/export composite while Active,
              even when it isn&apos;t the one driving the live 3D viewport - the
              real-time viewport can only display one HDRI&apos;s reflections at a time.
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Edit HDRI Environment" defaultOpen={asset.kind === 'sky' || !!asset.edits?.length}>
        <EditHdriSection asset={asset} />
      </CollapsibleSection>

      <CollapsibleSection title="Rotation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider label="Rotation X (pitch)" value={val('rotationX')} min={-180} max={180} step={1} unit="°" onChange={(v) => updateAsset(asset.id, { rotationX: v })} />
          <Slider label="Rotation Y (yaw)" value={asset.rotation} min={0} max={360} step={1} unit="°" onChange={(v) => updateAsset(asset.id, { rotation: v })} />
          <Slider label="Rotation Z (roll)" value={val('rotationZ')} min={-180} max={180} step={1} unit="°" onChange={(v) => updateAsset(asset.id, { rotationZ: v })} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-sec)' }}>Flip horizontal</span>
            <Toggle checked={!!asset.flipX} onChange={(v) => updateAsset(asset.id, { flipX: v })} />
          </div>
          <button className="btn-sm" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => { updateAsset(asset.id, { ...resetPatch(['rotationX', 'rotationZ', 'flipX']), rotation: 0 }); }}>
            Reset rotation
          </button>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            X tilts the horizon up/down, Z rolls it sideways, Y turns the
            environment like a turntable. Order applied: X, then Z, then Y.
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Offset (dome projection)" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider label="Offset X" value={val('offsetX')} min={-50} max={50} step={0.1} unit=" m" onChange={(v) => updateAsset(asset.id, { offsetX: v })} />
          <Slider label="Offset Y (height)" value={val('offsetY')} min={-50} max={50} step={0.1} unit=" m" onChange={(v) => updateAsset(asset.id, { offsetY: v })} />
          <Slider label="Offset Z" value={val('offsetZ')} min={-50} max={50} step={0.1} unit=" m" onChange={(v) => updateAsset(asset.id, { offsetZ: v })} />
          <Slider label="Dome radius" value={val('domeRadius')} min={1} max={500} step={1} unit=" m" onChange={(v) => updateAsset(asset.id, { domeRadius: v })} />
          <button className="btn-sm" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => updateAsset(asset.id, resetPatch(['offsetX', 'offsetY', 'offsetZ', 'domeRadius']))}>
            Reset offset
          </button>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            A real environment sits at infinite distance, so by itself it has
            nothing to offset. These controls project the map onto a dome of
            the given radius and move the viewer inside it: nearby parts of the
            scene shift (parallax), and a negative Y offset with a small radius
            gives a ground-projected look. Offset 0 = unchanged.
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Exposure &amp; Blend">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider
            label="Exposure"
            value={asset.intensity}
            min={0}
            max={5}
            step={0.01}
            onChange={(v) => updateAsset(asset.id, { intensity: v })}
          />
          <Slider
            label="Opacity"
            value={asset.opacity}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateAsset(asset.id, { opacity: v })}
          />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: -2 }}>
            Opacity blends this HDRI with whatever is beneath it in the layer
            stack in the HDRI Preview/export - independent of Exposure, which
            only scales brightness.
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Highlights &amp; Shadows" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider label="Highlights" value={val('highlights')} min={-100} max={100} step={1} onChange={(v) => updateAsset(asset.id, { highlights: v })} />
          <Slider label="Shadows" value={val('shadows')} min={-100} max={100} step={1} onChange={(v) => updateAsset(asset.id, { shadows: v })} />
          <Slider label="Max brightness" value={val('peakLimit')} min={0} max={2000} step={1} onChange={(v) => updateAsset(asset.id, { peakLimit: v })} />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: -2 }}>
            Highlights pulls the bright end down (or up); Shadows lifts (or
            crushes) the dark end. Max brightness soft-limits the very brightest
            values so a sun or softbox hotspot can&apos;t blow out reflections
            (0 = off, colour is preserved).
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Soften">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider label="Blur" value={val('blur')} min={0} max={100} step={1} onChange={(v) => updateAsset(asset.id, { blur: v })} />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: -2 }}>
            Softens the whole map - reflections lose fine detail and hard
            edges (like a defocused environment). 0 = original sharpness.
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Color Grading">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider
            label="Contrast"
            value={asset.contrast}
            min={-100}
            max={100}
            step={1}
            onChange={(v) => updateAsset(asset.id, { contrast: v })}
          />
          <Slider
            label="Gamma"
            value={asset.gamma}
            min={0.1}
            max={3}
            step={0.01}
            onChange={(v) => updateAsset(asset.id, { gamma: v })}
          />
          <Slider
            label="Saturation"
            value={asset.saturation}
            min={-100}
            max={100}
            step={1}
            onChange={(v) => updateAsset(asset.id, { saturation: v })}
          />
          <Slider label="Hue" value={val('hue')} min={-180} max={180} step={1} unit="°" onChange={(v) => updateAsset(asset.id, { hue: v })} />
          <Slider label="Temperature" value={val('temperature')} min={-100} max={100} step={1} onChange={(v) => updateAsset(asset.id, { temperature: v })} />
          <Slider label="Tint" value={val('tint')} min={-100} max={100} step={1} onChange={(v) => updateAsset(asset.id, { tint: v })} />
          <button className="btn-sm" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => updateAsset(asset.id, { contrast: 0, gamma: 1, saturation: 0, ...resetPatch(['hue', 'temperature', 'tint', 'highlights', 'shadows', 'peakLimit', 'blur']) })}>
            Reset all grading
          </button>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: -2 }}>
            Applies to the HDRI Preview panel and exported file. The live 3D
            viewport shows this HDRI&apos;s reflections unadjusted - grading a
            real-time PBR environment map would need a custom shader pass,
            which isn&apos;t wired up yet.
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};
