import React, { useState, useCallback, useRef, useMemo } from 'react';
import { useLightsStore } from '../../store/lightsStore';
import { LIGHT_TEMPLATES, type Light, type LightType } from '../../types/Light';
import { Dropdown } from '../UI/Dropdown';

const LIGHT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
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
  const selectLight = useLightsStore((s) => s.selectLight);
  const toggleLightVisibility = useLightsStore((s) => s.toggleLightVisibility);
  const toggleLightSolo = useLightsStore((s) => s.toggleLightSolo);
  const updateLight = useLightsStore((s) => s.updateLight);
  const reorderLights = useLightsStore((s) => s.reorderLights);
  const setCollectionFilter = useLightsStore((s) => s.setCollectionFilter);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lightId: string;
  } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isRenaming, setIsRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const filteredLights = useMemo(() => {
    if (!collectionFilter) return lights;
    return lights.filter((l) => l.collectionId === collectionFilter);
  }, [lights, collectionFilter]);

  const handleAddLight = useCallback(
    (templateKey?: string) => {
      addLight(templateKey);
    },
    [addLight],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, lightId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, lightId });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleDuplicate = useCallback(
    (id: string) => {
      duplicateLight(id);
      closeContextMenu();
    },
    [duplicateLight, closeContextMenu],
  );

  const handleDelete = useCallback(
    (id: string) => {
      removeLight(id);
      closeContextMenu();
    },
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
      if (e.key === 'Enter') {
        handleFinishRename();
      } else if (e.key === 'Escape') {
        setIsRenaming(null);
        setRenameValue('');
      }
    },
    [handleFinishRename],
  );

  const handleDragStart = useCallback((index: number) => {
    setDragState({ dragIndex: index, overIndex: index });
  }, []);

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
      if (dragState && dragState.dragIndex !== index) {
        reorderLights(dragState.dragIndex, index);
      }
      setDragState(null);
    },
    [dragState, reorderLights],
  );

  const handleDragEnd = useCallback(() => {
    setDragState(null);
  }, []);

  const collectionOptions = useMemo(
    () => [
      { value: '__all__', label: 'All Lights' },
      ...collections.map((c) => ({ value: c.id, label: c.name })),
    ],
    [collections],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Collection filter */}
      <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
        <Dropdown
          value={collectionFilter ?? '__all__'}
          options={collectionOptions}
          onChange={(v) => setCollectionFilter(v === '__all__' ? null : v)}
        />
      </div>

      {/* Light list */}
      <div
        className="panel-body"
        style={{ flex: 1, padding: 0, overflowY: 'auto' }}
        onClick={closeContextMenu}
      >
        {filteredLights.length === 0 ? (
          <div className="placeholder-panel" style={{ minHeight: 80 }}>
            <span>No lights yet</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Click + or use the Create menu to add lights
            </span>
          </div>
        ) : (
          <div className="light-list">
            {filteredLights.map((light, index) => {
              const isSelected = light.id === selectedLightId;
              const isDragging = dragState !== null && dragState.dragIndex === index;
              const isDragOver =
                dragState !== null && dragState.overIndex === index && dragState.dragIndex !== index;

              return (
                <div
                  key={light.id}
                  className={`light-list-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${!light.visible ? 'dimmed' : ''}`}
                  draggable={isRenaming !== light.id}
                  onClick={(e) => {
                    if (isRenaming === light.id) return;
                    e.stopPropagation();
                    selectLight(light.id);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, light.id)}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={handleDragEnd}
                >
                  {/* Drag handle */}
                  <div className="light-drag-handle" title="Drag to reorder">
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" opacity="0.35">
                      <circle cx="2" cy="2" r="1" />
                      <circle cx="6" cy="2" r="1" />
                      <circle cx="2" cy="6" r="1" />
                      <circle cx="6" cy="6" r="1" />
                      <circle cx="2" cy="10" r="1" />
                      <circle cx="6" cy="10" r="1" />
                    </svg>
                  </div>

                  {/* Type icon */}
                  <div className="light-type-icon" style={{ color: light.color }}>
                    {TYPE_ICONS[light.type] ?? TYPE_ICONS.point}
                  </div>

                  {/* Name */}
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

                  {/* Action buttons */}
                  <div className="light-item-actions">
                    <button
                      className={`btn-icon ${light.visible ? '' : 'dimmed'}`}
                      style={{ width: 20, height: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLightVisibility(light.id);
                      }}
                      title={light.visible ? 'Hide light' : 'Show light'}
                      aria-label={light.visible ? 'Hide light' : 'Show light'}
                    >
                      {light.visible ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" />
                          <circle cx="6" cy="6" r="1.5" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" />
                          <line x1="2" y1="10" x2="10" y2="2" />
                        </svg>
                      )}
                    </button>

                    <button
                      className={`btn-icon ${light.solo ? 'solo-active' : ''}`}
                      style={{ width: 20, height: 20, fontSize: 9, fontWeight: 700 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLightSolo(light.id);
                      }}
                      title={light.solo ? 'Unsolo light' : 'Solo light'}
                      aria-label={light.solo ? 'Unsolo light' : 'Solo light'}
                    >
                      S
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          className="btn-sm"
          onClick={() => handleAddLight()}
          title="Add default point light"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 1v8M1 5h8" />
          </svg>
          Add
        </button>
        <Dropdown
          value=""
          options={LIGHT_TYPE_OPTIONS}
          onChange={(v) => handleAddLight(v)}
        />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              const light = lights.find((l) => l.id === contextMenu.lightId);
              if (light) handleStartRename(light.id, light.name);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M8.5 1.5l2 2-7 7H1.5V8.5z" />
            </svg>
            Rename
          </div>
          <div
            className="context-menu-item"
            onClick={() => handleDuplicate(contextMenu.lightId)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M8 4V2a1 1 0 00-1-1H2a1 1 0 00-1 1v5a1 1 0 001 1h2" />
            </svg>
            Duplicate
          </div>
          <div className="context-menu-sep" />
          <div
            className="context-menu-item"
            style={{ color: 'var(--danger)' }}
            onClick={() => handleDelete(contextMenu.lightId)}
          >
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