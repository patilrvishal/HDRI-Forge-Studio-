import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useLightsStore } from '../../store/lightsStore';
import { useHDRIShapesStore } from '../../store/hdriShapesStore';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';
import { useSceneStore } from '../../store/sceneStore';
import type { LightType } from '../../types/Light';
import type { HDRIShapeType } from '../../types/HDRIShape';
import { promptForCustomHDRI } from '../../utils/loadCustomHDRI';

const SHAPE_TYPE_OPTIONS: Array<{ value: HDRIShapeType; label: string }> = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'gradient-strip', label: 'Gradient Strip' },
];

const SHAPE_TYPE_ICONS: Record<HDRIShapeType, React.ReactNode> = {
  rectangle: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1.5" y="2.5" width="9" height="7" rx="1" />
    </svg>
  ),
  circle: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="6" cy="6" r="4" />
    </svg>
  ),
  'gradient-strip': (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1" y="4.5" width="10" height="3" rx="1.5" />
    </svg>
  ),
};

const LIGHT_TYPE_OPTIONS: Array<{ value: LightType; label: string }> = [
  { value: 'point', label: 'Point Light' },
  { value: 'spot', label: 'Spot Light' },
  { value: 'area', label: 'Area Light' },
  { value: 'directional', label: 'Directional' },
  { value: 'overhead', label: 'Overhead Box' },
  { value: 'underlight', label: 'Under Grid' },
  { value: 'rim', label: 'Rim Light' },
  { value: 'ies', label: 'IES Point' },
];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  point: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="6" cy="6" r="3.5" />
    </svg>
  ),
  spot: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M6 2L10 9H2z" />
      <line x1="6" y1="9" x2="6" y2="11" />
    </svg>
  ),
  area: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1.5" y="2" width="9" height="7" rx="1" />
    </svg>
  ),
  directional: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="6" y1="1" x2="6" y2="8" />
      <polyline points="3,5 6,8 9,5" />
      <line x1="3" y1="10" x2="9" y2="10" />
    </svg>
  ),
  overhead: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="1" width="8" height="4" rx="1" />
      <line x1="6" y1="5" x2="6" y2="10" />
      <line x1="3" y1="10" x2="9" y2="10" />
    </svg>
  ),
  underlight: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <line x1="6" y1="2" x2="6" y2="7" />
      <line x1="3" y1="7" x2="9" y2="7" />
      <circle cx="6" cy="9.5" r="1.5" fill="currentColor" />
    </svg>
  ),
  rim: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M8 2a5 5 0 010 8" />
      <path d="M9 1l-1 1.5M9 11l-1-1.5" />
    </svg>
  ),
  ies: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="6" cy="5" r="3" />
      <path d="M4.5 8.5L6 11l1.5-2.5" />
    </svg>
  ),
};

const HDRI_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1">
    <circle cx="6" cy="6" r="5" />
    <ellipse cx="6" cy="6" rx="5" ry="2" />
    <line x1="1" y1="6" x2="11" y2="6" />
  </svg>
);

const EyeIcon: React.FC<{ visible: boolean }> = ({ visible }) =>
  visible ? (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" />
      <circle cx="6" cy="6" r="1.5" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" />
      <line x1="2" y1="10" x2="10" y2="2" />
    </svg>
  );

const LockIcon: React.FC<{ locked: boolean }> = ({ locked }) =>
  locked ? (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V3.5a2 2 0 014 0v2" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V3.5a2 2 0 013.9-.6" />
    </svg>
  );

/** Small uppercase section label matching the "HDRI SHAPES" heading style
 *  already used elsewhere - keeps the three layer kinds visually grouped
 *  within what still reads as one continuous list, like Photoshop groups
 *  layers without hard-partitioning the panel. */
const SectionLabel: React.FC<{ children: React.ReactNode; count: number }> = ({ children, count }) => (
  <div
    style={{
      padding: '5px 8px 3px',
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: 0.5,
      color: 'var(--text-dim)',
      textTransform: 'uppercase',
      display: 'flex',
      justifyContent: 'space-between',
    }}
  >
    <span>{children}</span>
    <span style={{ opacity: 0.6 }}>{count}</span>
  </div>
);

interface DragState {
  dragIndex: number;
  overIndex: number;
}

export const LightListPanel: React.FC = () => {
  const lights = useLightsStore((s) => s.lights);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const collections = useLightsStore((s) => s.collections);
  const collectionFilter = useLightsStore((s) => s.collectionFilter);

  const addLight = useLightsStore((s) => s.addLight);
  const removeLight = useLightsStore((s) => s.removeLight);
  const duplicateLight = useLightsStore((s) => s.duplicateLight);
  const selectLightRaw = useLightsStore((s) => s.selectLight);
  const toggleLightVisibility = useLightsStore((s) => s.toggleLightVisibility);
  const toggleLightSolo = useLightsStore((s) => s.toggleLightSolo);
  const updateLight = useLightsStore((s) => s.updateLight);
  const reorderLights = useLightsStore((s) => s.reorderLights);
  const setCollectionFilter = useLightsStore((s) => s.setCollectionFilter);

  // HDRI Shapes and Custom HDRI assets live in the SAME unified layer list as
  // lights now - a "layer" here is anything that contributes to the scene's
  // lighting: a real 3D light, a 2D shape painted onto the HDRI, or a loaded
  // HDRI environment file. Selection across all three is kept mutually
  // exclusive so the right-side Properties panel always shows exactly one
  // inspector.
  const shapes = useHDRIShapesStore((s) => s.shapes);
  const selectedShapeId = useHDRIShapesStore((s) => s.selectedShapeId);
  const addShape = useHDRIShapesStore((s) => s.addShape);
  const removeShape = useHDRIShapesStore((s) => s.removeShape);
  const duplicateShape = useHDRIShapesStore((s) => s.duplicateShape);
  const selectShapeRaw = useHDRIShapesStore((s) => s.selectShape);
  const updateShape = useHDRIShapesStore((s) => s.updateShape);
  const reorderShape = useHDRIShapesStore((s) => s.reorderShape);

  const hdriAssets = useHDRIAssetStore((s) => s.assets);
  const selectedHDRIAssetId = useHDRIAssetStore((s) => s.selectedAssetId);
  const selectHDRIAssetRaw = useHDRIAssetStore((s) => s.selectAsset);
  const removeHDRIAsset = useHDRIAssetStore((s) => s.removeAsset);
  const updateHDRIAsset = useHDRIAssetStore((s) => s.updateAsset);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);

  const selectLight = useCallback(
    (id: string | null) => {
      selectLightRaw(id);
      if (id) { selectShapeRaw(null); selectHDRIAssetRaw(null); }
    },
    [selectLightRaw, selectShapeRaw, selectHDRIAssetRaw],
  );
  const selectShape = useCallback(
    (id: string | null) => {
      selectShapeRaw(id);
      if (id) { selectLightRaw(null); selectHDRIAssetRaw(null); }
    },
    [selectShapeRaw, selectLightRaw, selectHDRIAssetRaw],
  );
  const selectHDRIAsset = useCallback(
    (id: string) => {
      selectHDRIAssetRaw(id);
      selectLightRaw(null);
      selectShapeRaw(null);
      const asset = hdriAssets.find((a) => a.id === id);
      if (asset?.blobUrl) {
        setEnvironment({ hdri: asset.blobUrl, presetId: '__custom__', showBackground: true });
      }
    },
    [hdriAssets, selectHDRIAssetRaw, selectLightRaw, selectShapeRaw, setEnvironment],
  );

  const [shapeContextMenu, setShapeContextMenu] = useState<{ x: number; y: number; shapeId: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; lightId: string } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isRenaming, setIsRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // "+ New Layer" popup - a single entry point matching Photoshop's "create
  // new layer" button, expanding into what KIND of layer to create.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuSub, setAddMenuSub] = useState<'root' | 'light' | 'shape'>('root');
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
        setAddMenuSub('root');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [addMenuOpen]);

  const filteredLights = useMemo(() => {
    if (!collectionFilter) return lights;
    return lights.filter((l) => l.collectionId === collectionFilter);
  }, [lights, collectionFilter]);

  const handleAddLight = useCallback(
    (templateKey?: string) => {
      addLight(templateKey);
      setAddMenuOpen(false);
      setAddMenuSub('root');
    },
    [addLight],
  );

  const handleAddShapeType = useCallback(
    (type: HDRIShapeType) => {
      addShape(type);
      setAddMenuOpen(false);
      setAddMenuSub('root');
    },
    [addShape],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, lightId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, lightId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleDuplicate = useCallback(
    (id: string) => { duplicateLight(id); closeContextMenu(); },
    [duplicateLight, closeContextMenu],
  );

  const handleDelete = useCallback(
    (id: string) => { removeLight(id); closeContextMenu(); },
    [removeLight, closeContextMenu],
  );

  const handleStartRename = useCallback(
    (lightId: string, currentName: string) => {
      setIsRenaming(lightId);
      setRenameValue(currentName);
      closeContextMenu();
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 10);
    },
    [closeContextMenu],
  );

  const handleFinishRename = useCallback(() => {
    if (isRenaming && renameValue.trim()) {
      updateLight(isRenaming, { name: renameValue.trim() });
    }
    setIsRenaming(null);
    setRenameValue('');
  }, [isRenaming, renameValue, updateLight]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleFinishRename();
      else if (e.key === 'Escape') { setIsRenaming(null); setRenameValue(''); }
    },
    [handleFinishRename],
  );

  const handleDragStart = useCallback((index: number) => setDragState({ dragIndex: index, overIndex: index }), []);
  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragState && dragState.dragIndex !== index) {
        setDragState((prev) => (prev ? { ...prev, overIndex: index } : null));
      }
    },
    [dragState],
  );
  const handleDrop = useCallback(
    (index: number) => {
      if (dragState && dragState.dragIndex !== index) reorderLights(dragState.dragIndex, index);
      setDragState(null);
    },
    [dragState, reorderLights],
  );
  const handleDragEnd = useCallback(() => setDragState(null), []);

  const collectionOptions = useMemo(
    () => [{ value: '__all__', label: 'All Lights' }, ...collections.map((c) => ({ value: c.id, label: c.name }))],
    [collections],
  );

  const nothingYet = filteredLights.length === 0 && shapes.length === 0 && hdriAssets.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onClick={() => { closeContextMenu(); setShapeContextMenu(null); }}>
      {/* Collection filter */}
      <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
        <select
          className="field-input"
          value={collectionFilter ?? '__all__'}
          onChange={(e) => setCollectionFilter(e.target.value === '__all__' ? null : e.target.value)}
          style={{ width: '100%', fontSize: 11 }}
        >
          {collectionOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Unified layer list */}
      <div className="panel-body" style={{ flex: 1, padding: 0, overflowY: 'auto', minHeight: 0 }}>
        {nothingYet && (
          <div className="placeholder-panel" style={{ minHeight: 90 }}>
            <span>No layers yet</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Click + New Layer below, or use the Create menu
            </span>
          </div>
        )}

        {/* --- Custom HDRI layers --- */}
        {hdriAssets.length > 0 && (
          <>
            <SectionLabel count={hdriAssets.length}>Custom HDRI</SectionLabel>
            <div className="light-list">
              {hdriAssets.map((asset) => {
                const isSelected = asset.id === selectedHDRIAssetId;
                return (
                  <div
                    key={asset.id}
                    className={`light-list-item ${isSelected ? 'selected' : ''} ${!asset.active ? 'dimmed' : ''}`}
                    onClick={(e) => { e.stopPropagation(); selectHDRIAsset(asset.id); }}
                  >
                    <div className="light-drag-handle" style={{ opacity: 0.15, cursor: 'default' }}>
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                        <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                        <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                        <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                      </svg>
                    </div>
                    <div className="light-type-icon" style={{ color: 'var(--text-sec)' }}>{HDRI_ICON}</div>
                    <div className="light-item-name">
                      <span className="light-name-text" title={asset.fileName}>{asset.name}</span>
                      <span className="light-type-label">hdri{asset.active ? ' · active' : ''}</span>
                    </div>
                    <div className="light-item-actions">
                      <button
                        className={`btn-icon ${asset.active ? '' : 'dimmed'}`}
                        style={{ width: 20, height: 20 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!asset.active) selectHDRIAsset(asset.id);
                          else updateHDRIAsset(asset.id, { active: false });
                        }}
                        title={asset.active ? 'Deactivate' : 'Activate as environment'}
                      >
                        <EyeIcon visible={asset.active} />
                      </button>
                      <button
                        className="btn-icon"
                        style={{ width: 20, height: 20 }}
                        onClick={(e) => { e.stopPropagation(); removeHDRIAsset(asset.id); }}
                        title="Remove HDRI"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path d="M2 3h8M4.5 3V2a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M9 3l-.5 7a1 1 0 01-1 .9H4.5a1 1 0 01-1-.9L3 3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* --- Shape layers (top of list = top of paint stack, Photoshop convention) --- */}
        {shapes.length > 0 && (
          <>
            <SectionLabel count={shapes.length}>Shapes</SectionLabel>
            <div className="light-list" onClick={() => setShapeContextMenu(null)}>
              {[...shapes].reverse().map((shape) => {
                const index = shapes.indexOf(shape);
                const isSelected = shape.id === selectedShapeId;
                return (
                  <div
                    key={shape.id}
                    className={`light-list-item ${isSelected ? 'selected' : ''} ${!shape.visible ? 'dimmed' : ''}`}
                    onClick={(e) => { e.stopPropagation(); selectShape(shape.id); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShapeContextMenu({ x: e.clientX, y: e.clientY, shapeId: shape.id }); }}
                  >
                    <div className="light-drag-handle" title="Reorder">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" opacity="0.35">
                        <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                        <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                        <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                      </svg>
                    </div>
                    <div className="light-type-icon" style={{ color: shape.color }}>{SHAPE_TYPE_ICONS[shape.type]}</div>
                    <div className="light-item-name">
                      <span className="light-name-text">{shape.name}</span>
                      <span className="light-type-label">{shape.type}</span>
                    </div>
                    <div className="light-item-actions">
                      <button
                        className="btn-icon"
                        style={{ width: 18, height: 18, opacity: shape.locked ? 1 : 0.3 }}
                        onClick={(e) => { e.stopPropagation(); updateShape(shape.id, { locked: !shape.locked }); }}
                        title={shape.locked ? 'Unlock position' : 'Lock position'}
                      >
                        <LockIcon locked={shape.locked} />
                      </button>
                      <button
                        className={`btn-icon ${shape.visible ? '' : 'dimmed'}`}
                        style={{ width: 18, height: 18 }}
                        onClick={(e) => { e.stopPropagation(); updateShape(shape.id, { visible: !shape.visible }); }}
                        title={shape.visible ? 'Hide shape' : 'Show shape'}
                      >
                        <EyeIcon visible={shape.visible} />
                      </button>
                      <button
                        className="btn-icon"
                        style={{ width: 18, height: 18, fontSize: 9 }}
                        onClick={(e) => { e.stopPropagation(); reorderShape(shape.id, 'up'); }}
                        disabled={index === shapes.length - 1}
                        title="Move up (paints later / on top)"
                      >{'↑'}</button>
                      <button
                        className="btn-icon"
                        style={{ width: 18, height: 18, fontSize: 9 }}
                        onClick={(e) => { e.stopPropagation(); reorderShape(shape.id, 'down'); }}
                        disabled={index === 0}
                        title="Move down"
                      >{'↓'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* --- Light layers --- */}
        {filteredLights.length > 0 && (
          <>
            <SectionLabel count={filteredLights.length}>Lights</SectionLabel>
            <div className="light-list">
              {filteredLights.map((light, index) => {
                const isSelected = light.id === selectedLightId;
                const isDragging = dragState !== null && dragState.dragIndex === index;
                const isDragOver = dragState !== null && dragState.overIndex === index && dragState.dragIndex !== index;
                return (
                  <div
                    key={light.id}
                    className={`light-list-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${!light.visible ? 'dimmed' : ''}`}
                    draggable={isRenaming !== light.id}
                    onClick={(e) => { if (isRenaming === light.id) return; e.stopPropagation(); selectLight(light.id); }}
                    onContextMenu={(e) => handleContextMenu(e, light.id)}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="light-drag-handle" title="Drag to reorder">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" opacity="0.35">
                        <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                        <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                        <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                      </svg>
                    </div>
                    <div className="light-type-icon" style={{ color: light.color }}>{TYPE_ICONS[light.type] ?? TYPE_ICONS.point}</div>
                    <div className="light-item-name">
                      {isRenaming === light.id ? (
                        <input
                          ref={renameInputRef}
                          className="field-input light-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={handleFinishRename}
                          onKeyDown={handleRenameKeyDown}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="light-name-text">{light.name}</span>
                      )}
                      <span className="light-type-label">{light.type}</span>
                    </div>
                    <div className="light-item-actions">
                      <button
                        className={`btn-icon ${light.visible ? '' : 'dimmed'}`}
                        style={{ width: 20, height: 20 }}
                        onClick={(e) => { e.stopPropagation(); toggleLightVisibility(light.id); }}
                        title={light.visible ? 'Hide light' : 'Show light'}
                      >
                        <EyeIcon visible={light.visible} />
                      </button>
                      <button
                        className={`btn-icon ${light.solo ? 'solo-active' : ''}`}
                        style={{ width: 20, height: 20, fontSize: 9, fontWeight: 700 }}
                        onClick={(e) => { e.stopPropagation(); toggleLightSolo(light.id); }}
                        title={light.solo ? 'Unsolo light' : 'Solo light'}
                      >S</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Bottom toolbar - single "+ New Layer" entry point, Photoshop-style */}
      <div style={{ position: 'relative', borderTop: '1px solid var(--border)', flexShrink: 0 }} ref={addMenuRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px' }}>
          <button
            className="btn-sm"
            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={(e) => { e.stopPropagation(); setAddMenuOpen((o) => !o); setAddMenuSub('root'); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 1v8M1 5h8" />
            </svg>
            New Layer
          </button>
        </div>

        {addMenuOpen && (
          <div
            className="context-menu"
            style={{ position: 'absolute', left: 6, bottom: '100%', marginBottom: 4, minWidth: 170 }}
            onClick={(e) => e.stopPropagation()}
          >
            {addMenuSub === 'root' && (
              <>
                <div className="context-menu-item" onClick={() => setAddMenuSub('light')}>
                  {TYPE_ICONS.point}<span style={{ marginLeft: 6 }}>Light</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.5 }}>▸</span>
                </div>
                <div className="context-menu-item" onClick={() => setAddMenuSub('shape')}>
                  {SHAPE_TYPE_ICONS.rectangle}<span style={{ marginLeft: 6 }}>HDRI Shape</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.5 }}>▸</span>
                </div>
                <div className="context-menu-sep" />
                <div className="context-menu-item" onClick={() => { setAddMenuOpen(false); promptForCustomHDRI(); }}>
                  {HDRI_ICON}<span style={{ marginLeft: 6 }}>Custom HDRI...</span>
                </div>
              </>
            )}
            {addMenuSub === 'light' && (
              <>
                <div className="context-menu-item" onClick={() => setAddMenuSub('root')}>
                  <span style={{ opacity: 0.6 }}>◂</span><span style={{ marginLeft: 6 }}>Back</span>
                </div>
                <div className="context-menu-sep" />
                {LIGHT_TYPE_OPTIONS.map((opt) => (
                  <div key={opt.value} className="context-menu-item" onClick={() => handleAddLight(opt.value)}>
                    {TYPE_ICONS[opt.value]}<span style={{ marginLeft: 6 }}>{opt.label}</span>
                  </div>
                ))}
              </>
            )}
            {addMenuSub === 'shape' && (
              <>
                <div className="context-menu-item" onClick={() => setAddMenuSub('root')}>
                  <span style={{ opacity: 0.6 }}>◂</span><span style={{ marginLeft: 6 }}>Back</span>
                </div>
                <div className="context-menu-sep" />
                {SHAPE_TYPE_OPTIONS.map((opt) => (
                  <div key={opt.value} className="context-menu-item" onClick={() => handleAddShapeType(opt.value)}>
                    {SHAPE_TYPE_ICONS[opt.value]}<span style={{ marginLeft: 6 }}>{opt.label}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Light context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="context-menu-item" onClick={() => {
            const light = lights.find((l) => l.id === contextMenu.lightId);
            if (light) handleStartRename(light.id, light.name);
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M8.5 1.5l2 2-7 7H1.5V8.5z" />
            </svg>
            Rename
          </div>
          <div className="context-menu-item" onClick={() => handleDuplicate(contextMenu.lightId)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M8 4V2a1 1 0 00-1-1H2a1 1 0 00-1 1v5a1 1 0 001 1h2" />
            </svg>
            Duplicate
          </div>
          <div className="context-menu-sep" />
          <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(contextMenu.lightId)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M2 3h8M4.5 3V2a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M9 3l-.5 7a1 1 0 01-1 .9H4.5a1 1 0 01-1-.9L3 3" />
            </svg>
            Delete
          </div>
        </div>
      )}

      {/* Shape context menu */}
      {shapeContextMenu && (
        <div className="context-menu" style={{ left: shapeContextMenu.x, top: shapeContextMenu.y }}>
          <div className="context-menu-item" onClick={() => { duplicateShape(shapeContextMenu.shapeId); setShapeContextMenu(null); }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M8 4V2a1 1 0 00-1-1H2a1 1 0 00-1 1v5a1 1 0 001 1h2" />
            </svg>
            Duplicate
          </div>
          <div className="context-menu-sep" />
          <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => { removeShape(shapeContextMenu.shapeId); setShapeContextMenu(null); }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M2 3h8M4.5 3V2a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M9 3l-.5 7a1 1 0 01-1 .9H4.5a1 1 0 01-1-.9L3 3" />
            </svg>
            Delete
          </div>
        </div>
      )}
    </div>
  );
};
