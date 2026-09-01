import React, { useMemo, useState } from 'react';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';
import { useSceneStore } from '../../store/sceneStore';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';

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

  // This asset is also the one actually driving the live 3D viewport
  // (environment.hdri is a single global slot, not per-asset) only when its
  // blob URL matches what's currently loaded there.
  const drivesViewport = environment.presetId === '__custom__' && environment.hdri === asset.blobUrl;

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
                if (asset.blobUrl) {
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

      <CollapsibleSection title="Transform">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <Slider
            label="Rotation (Y)"
            value={asset.rotation}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={(v) => updateAsset(asset.id, { rotation: v })}
          />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            An equirectangular HDRI represents the surroundings at infinite
            distance - it has no meaningful Position, Scale, or X/Z tilt to
            adjust (there is nothing for those to move relative to), only the
            Y rotation you see here, which actually turns the environment.
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

      <CollapsibleSection title="Color Grading" defaultOpen={false}>
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
