import React, { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { MaterialPreview, type MaterialPreviewHandle } from '../Previews/MaterialPreview';
import { useUIStore } from '../../store/uiStore';
import { usePresetsStore } from '../../store/presetsStore';
import { MATERIAL_PRESETS, PREVIEW_BG_OPTIONS, type PresetLight } from '../../types/Preset';
import { Dropdown } from '../UI/Dropdown';

const MATERIAL_OPTIONS = Object.entries(MATERIAL_PRESETS).map(([key, val]) => ({
  value: key,
  label: val.label,
}));

const BG_OPTIONS = PREVIEW_BG_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label,
}));

interface MaterialPreviewTabProps {
  envMap?: THREE.Texture | null;
}

export const MaterialPreviewTab: React.FC<MaterialPreviewTabProps> = ({ envMap }) => {
  const materialPreset = useUIStore((s) => s.materialPreset);
  const previewBackground = useUIStore((s) => s.previewBackground);
  const setMaterialPreset = useUIStore((s) => s.setMaterialPreset);
  const setPreviewBackground = useUIStore((s) => s.setPreviewBackground);
  const lightsToPresetLights = usePresetsStore((s) => s.lightsToPresetLights);

  const mpHandleRef = useRef<MaterialPreviewHandle | null>(null);

  const handleReady = useCallback((handle: MaterialPreviewHandle) => {
    mpHandleRef.current = handle;
  }, []);

  // Expose a way for the parent to generate thumbnails
  // This is used by PresetBrowser when saving presets
  React.useEffect(() => {
    // Store the ref on a global so PresetBrowser can access it
    (window as unknown as Record<string, unknown>).__materialPreviewHandle = mpHandleRef;
    return () => {
      delete (window as unknown as Record<string, unknown>).__materialPreviewHandle;
    };
  }, []);

  const handleMaterialChange = useCallback(
    (value: string) => {
      setMaterialPreset(value as typeof materialPreset);
    },
    [setMaterialPreset],
  );

  const handleBgChange = useCallback(
    (value: string) => {
      setPreviewBackground(value as typeof previewBackground);
    },
    [setPreviewBackground],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls bar */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '4px 6px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        <Dropdown
          value={materialPreset}
          options={MATERIAL_OPTIONS}
          onChange={handleMaterialChange}
          width="90px"
        />
        <Dropdown
          value={previewBackground}
          options={BG_OPTIONS}
          onChange={handleBgChange}
          width="70px"
        />
      </div>

      {/* 3D preview canvas */}
      <div style={{ flex: 1, minHeight: 0, padding: 6 }}>
        <MaterialPreview envMap={envMap} onReady={handleReady} />
      </div>
    </div>
  );
};

/**
 * Utility to get the current MaterialPreview handle from anywhere in the app.
 * Used by PresetBrowser to generate thumbnails when saving presets.
 */
export function getMaterialPreviewThumbnail(lights: PresetLight[]): string {
  const handleRef = (window as unknown as Record<string, React.MutableRefObject<MaterialPreviewHandle | null>>).__materialPreviewHandle;
  const current = handleRef?.current;
  if (handleRef && current) {
    return current.renderThumbnail(lights);
  }
  return '';
}