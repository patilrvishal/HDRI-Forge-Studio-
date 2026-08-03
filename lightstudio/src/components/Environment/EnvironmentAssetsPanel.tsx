import React, { useCallback, useRef, useState } from 'react';
import { useHDRIAssetStore, type HDRIAsset } from '../../store/hdriAssetStore';
import { useSceneStore } from '../../store/sceneStore';
import { useUIStore } from '../../store/uiStore';
import { setRawHDRIData, clearRawHDRIData } from '../../store/hdriDataStore';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';

/** Compact card for a single HDRI asset */
const HDRIAssetCard: React.FC<{
  asset: HDRIAsset;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<HDRIAsset, 'name' | 'intensity' | 'rotation' | 'active'>>) => void;
}> = ({ asset, isSelected, onSelect, onRemove, onUpdate }) => {
  const [expanded, setExpanded] = useState(isSelected);

  // Auto-expand when selected
  React.useEffect(() => {
    setExpanded(isSelected);
  }, [isSelected]);

  return (
    <div
      style={{
        borderRadius: 'var(--radius-sm)',
        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        marginBottom: 4,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Card header — click to select & expand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          cursor: 'pointer',
          minHeight: 28,
        }}
        onClick={() => {
          onSelect(asset.id);
          setExpanded(!expanded);
        }}
      >
        {/* HDRI icon */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.7 }}>
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="7" cy="7" r="2.5" fill="currentColor" opacity="0.3" />
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
        </svg>

        {/* Name */}
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? 'var(--text)' : 'var(--text-sec)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={asset.fileName}
        >
          {asset.name}
        </span>

        {/* Active badge */}
        {asset.active && (
          <span
            style={{
              fontSize: 8,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'var(--accent)',
              color: '#fff',
              fontWeight: 600,
              letterSpacing: '0.3px',
              flexShrink: 0,
            }}
          >
            ACTIVE
          </span>
        )}

        {/* Expand arrow */}
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          style={{ flexShrink: 0, opacity: 0.5, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M2 3l2 2 2-2" />
        </svg>

        {/* Delete button */}
        <button
          className="btn-icon"
          style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.4 }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(asset.id);
          }}
          title="Remove HDRI"
          aria-label="Remove HDRI"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1l6 6M7 1l-6 6" />
          </svg>
        </button>
      </div>

      {/* Expanded controls */}
      {expanded && (
        <div style={{ padding: '2px 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Slider
            label="Intensity"
            value={asset.intensity}
            min={0}
            max={3}
            step={0.05}
            onChange={(v) => onUpdate(asset.id, { intensity: v })}
            unit=""
          />
          <Slider
            label="Rotation"
            value={asset.rotation}
            min={0}
            max={360}
            step={1}
            onChange={(v) => onUpdate(asset.id, { rotation: v })}
            unit="°"
          />
          <Toggle
            label="Active"
            checked={asset.active}
            onChange={() => onUpdate(asset.id, { active: !asset.active })}
            variant="glossy"
          />
          {/* File info */}
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
            {asset.fileName}
          </div>
        </div>
      )}
    </div>
  );
};

/** Environment assets panel — shows custom HDRIs + active environment info */
export const EnvironmentAssetsPanel: React.FC = () => {
  const assets = useHDRIAssetStore((s) => s.assets);
  const selectedAssetId = useHDRIAssetStore((s) => s.selectedAssetId);
  const selectAsset = useHDRIAssetStore((s) => s.selectAsset);
  const removeAsset = useHDRIAssetStore((s) => s.removeAsset);
  const updateAsset = useHDRIAssetStore((s) => s.updateAsset);

  const environment = useSceneStore((s) => s.environment);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);
  const setEnvironmentRotation = useSceneStore((s) => s.setEnvironmentRotation);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { addAsset } = useHDRIAssetStore.getState();
      const asset = addAsset(file, arrayBuffer);

      // Also set as the active custom HDRI in the scene
      const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/octet-stream' }));
      setEnvironment({ hdri: url, presetId: '__custom__', showBackground: true });

      // Store raw data for legacy scene save compatibility
      setRawHDRIData(arrayBuffer, file.name);
    } catch (err) {
      console.error('Failed to load HDRI:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }, [setEnvironment]);

  // When a custom HDRI asset is selected, activate it in the scene
  const handleSelectAsset = useCallback(
    (id: string) => {
      selectAsset(id);
      const asset = useHDRIAssetStore.getState().assets.find((a) => a.id === id);
      if (asset?.blobUrl) {
        setEnvironment({ hdri: asset.blobUrl, presetId: '__custom__', showBackground: true });
      }
    },
    [selectAsset, setEnvironment],
  );

  // When the active asset's intensity/rotation changes, sync to scene environment
  const handleUpdateAsset = useCallback(
    (id: string, updates: Partial<Pick<HDRIAsset, 'name' | 'intensity' | 'rotation' | 'active'>>) => {
      updateAsset(id, updates);

      const asset = useHDRIAssetStore.getState().assets.find((a) => a.id === id);
      if (!asset) return;

      // Active toggled OFF → tear the HDRI out of the scene
      if (updates.active === false) {
        setEnvironment({ hdri: null, presetId: 'none', showBackground: false });
        return;
      }

      // Active toggled ON → push this asset into the scene
      if (updates.active === true && asset.blobUrl) {
        setEnvironment({ hdri: asset.blobUrl, presetId: '__custom__', showBackground: true });
        setEnvironmentRotation(asset.rotation);
        setEnvironment({ intensity: asset.intensity });
        return;
      }

      // Intensity / rotation edits only apply to the asset that is live
      if (asset.active) {
        if (updates.intensity !== undefined) {
          setEnvironment({ intensity: updates.intensity });
        }
        if (updates.rotation !== undefined) {
          setEnvironmentRotation(updates.rotation);
        }
      }
    },
    [updateAsset, setEnvironment, setEnvironmentRotation],
  );

  const handleRemoveAsset = useCallback(
    (id: string) => {
      removeAsset(id);
      // If the removed asset was active, fall back to neutral studio
      const state = useHDRIAssetStore.getState();
      if (state.assets.length === 0) {
        setEnvironment({ hdri: null, presetId: 'studio-neutral' });
        clearRawHDRIData();
      } else if (!state.assets.some((a) => a.active)) {
        // Activate the first remaining asset
        const first = state.assets[0];
        selectAsset(first.id);
        if (first.blobUrl) {
          setEnvironment({ hdri: first.blobUrl, presetId: '__custom__', showBackground: true });
        }
      }
    },
    [removeAsset, selectAsset, setEnvironment],
  );

  const isCustomActive = environment.presetId === '__custom__';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Global environment info */}
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          color: 'var(--text-sec)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Global Intensity</span>
          <span style={{ color: 'var(--text-dim)' }}>{environment.intensity.toFixed(2)}</span>
        </div>
        <Slider
          label=""
          value={environment.intensity}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => setEnvironment({ intensity: v })}
          unit=""
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Global Rotation</span>
          <span style={{ color: 'var(--text-dim)' }}>{environment.rotation}°</span>
        </div>
        <Slider
          label=""
          value={environment.rotation}
          min={0}
          max={360}
          step={1}
          onChange={(v) => setEnvironmentRotation(v)}
          unit="°"
        />
      </div>

      {/* Custom HDRI Assets section */}
      <div
        style={{
          padding: '6px 10px 2px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-sec)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Custom HDRIs ({assets.length})
        </span>
        <button
          className="btn-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: 9, padding: '2px 8px' }}
        >
          {uploading ? 'Loading...' : '+ Add HDRI'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".hdr,.hdri,.exr"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
      </div>

      {/* HDRI Asset list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 10px 10px' }}>
        {assets.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: 10,
              padding: '16px 4px',
              lineHeight: 1.5,
            }}
          >
            <div style={{ marginBottom: 6, opacity: 0.4 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ margin: '0 auto' }}>
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" opacity="0.3" />
                <path d="M12 2v20M2 12h20" opacity="0.3" />
              </svg>
            </div>
            No custom HDRIs loaded.
            <br />
            Click <strong>+ Add HDRI</strong> or use the Environment Browser to load .hdr files.
          </div>
        ) : (
          assets.map((asset) => (
            <HDRIAssetCard
              key={asset.id}
              asset={asset}
              isSelected={asset.id === selectedAssetId}
              onSelect={handleSelectAsset}
              onRemove={handleRemoveAsset}
              onUpdate={handleUpdateAsset}
            />
          ))
        )}
      </div>

      {/* Open Environment Browser button */}
      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          className="btn-sm"
          onClick={() => useUIStore.getState().setEnvBrowserModal(true)}
          style={{ width: '100%', fontSize: 10, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1" y="1" width="8" height="8" rx="1" />
            <circle cx="5" cy="5" r="2" />
          </svg>
          Open Environment Browser
        </button>
      </div>
    </div>
  );
};