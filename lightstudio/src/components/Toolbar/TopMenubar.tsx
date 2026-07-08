import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { useHistoryStore } from '../../store/historyStore';
import { SceneExporter } from '../../three/SceneExporter';
import type { SceneManager } from '../../three/engine';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  submenu?: MenuDefinition;
  disabled?: boolean;
}

interface MenuDefinition {
  [key: string]: MenuItem;
}

interface TopMenubarProps {
  sceneManagerRef?: React.MutableRefObject<SceneManager | null>;
  onExportImage?: () => void;
}

const MENU_DEFINITIONS = (
  onExportImage: (() => void) | undefined,
  sceneManagerRef: React.MutableRefObject<SceneManager | null> | undefined,
  undoLabel: string | null,
  redoLabel: string | null,
  canUndo: boolean,
  canRedo: boolean,
): Record<string, MenuDefinition> => ({
  Project: {
    newScene: {
      label: 'New Scene',
      shortcut: 'Ctrl+N',
      action: () => {
        if (!confirm('Create a new scene? Unsaved changes will be lost.')) return;
        useSceneStore.getState().resetScene();
        useLightsStore.getState().clearAllLights();
        useSceneStore.getState().setCamera([5, 3, 5], [0, 0, 0]);
        if (sceneManagerRef?.current) {
          sceneManagerRef.current.setCameraState([5, 3, 5], [0, 0, 0], 45);
        }
      },
    },
    open: {
      label: 'Open Scene...',
      shortcut: 'Ctrl+O',
      action: async () => {
        const result = await SceneExporter.openSceneFile();
        if (!result) return;
        try {
          const sceneFile = SceneExporter.fromJSON(result.text);
          const error = SceneExporter.importScene(sceneFile);
          if (error) {
            alert(error);
            return;
          }
          // Clear undo history after full scene load
          useHistoryStore.getState().clear();
          // Restore camera position in 3D view
          if (sceneManagerRef?.current) {
            const cam = sceneFile.scene.camera;
            sceneManagerRef.current.setCameraState(cam.position, cam.target, cam.fov);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to open scene file';
          alert(`Error: ${msg}`);
        }
      },
    },
    save: {
      label: 'Save Scene',
      shortcut: 'Ctrl+S',
      action: () => {
        const data = SceneExporter.exportScene();
        SceneExporter.downloadSceneFile(data);
      },
    },
    saveAs: {
      label: 'Save Scene As...',
      action: () => {
        const data = SceneExporter.exportScene();
        const name = prompt('Enter filename:', `lightstudio_scene_${Date.now()}.lightscene`);
        if (name) {
          SceneExporter.downloadSceneFile(data, name);
        }
      },
    },
    sep1: { label: '', separator: true },
    exportImage: {
      label: 'Export Image...',
      shortcut: 'Ctrl+E',
      action: () => onExportImage?.(),
    },
    sep2: { label: '', separator: true },
    exit: { label: 'Exit', action: () => window.close() },
  },
  Edit: {
    undo: {
      label: undoLabel ? `Undo ${undoLabel}` : 'Undo',
      shortcut: 'Ctrl+Z',
      action: () => useHistoryStore.getState().undo(),
      disabled: !canUndo,
    },
    redo: {
      label: redoLabel ? `Redo ${redoLabel}` : 'Redo',
      shortcut: 'Ctrl+Y',
      action: () => useHistoryStore.getState().redo(),
      disabled: !canRedo,
    },
    sep1: { label: '', separator: true },
    copyLight: {
      label: 'Duplicate Selected Light',
      action: () => {
        const s = useLightsStore.getState();
        if (s.selectedLightId) s.duplicateLight(s.selectedLightId);
      },
    },
    deleteLight: {
      label: 'Delete Selected Light',
      action: () => {
        const id = useLightsStore.getState().selectedLightId;
        if (id) useLightsStore.getState().removeLight(id);
      },
    },
    sep2: { label: '', separator: true },
    selectAllLights: {
      label: 'Select All Lights',
      action: () => {
        const { lights } = useLightsStore.getState();
        if (lights.length > 0) {
          useLightsStore.getState().selectLight(lights[0].id);
        }
      },
    },
  },
  Create: {
    pointLight: { label: 'Point Light', action: () => useLightsStore.getState().addLight('point') },
    spotLight: { label: 'Spot Light', action: () => useLightsStore.getState().addLight('spot') },
    areaLight: { label: 'Area Light', action: () => useLightsStore.getState().addLight('area') },
    directionalLight: { label: 'Directional Light', action: () => useLightsStore.getState().addLight('directional') },
    iesLight: { label: 'IES Light', action: () => useLightsStore.getState().addLight('ies') },
    overheadLight: { label: 'Overhead Light', action: () => useLightsStore.getState().addLight('overhead') },
    underlight: { label: 'Under Light', action: () => useLightsStore.getState().addLight('underlight') },
    rimLight: { label: 'Rim Light', action: () => useLightsStore.getState().addLight('rim') },
    fillLight: { label: 'Fill Light', action: () => useLightsStore.getState().addLight('fill') },
  },
  Canvas: {
    resetView: {
      label: 'Reset View',
      shortcut: 'F',
      action: () => {
        sceneManagerRef?.current?.animateCameraTo([5, 3, 5], [0, 0.5, 0], 500);
      },
    },
    frameAll: {
      label: 'Frame All',
      action: () => {
        sceneManagerRef?.current?.animateCameraTo([5, 3, 5], [0, 0.5, 0], 500);
      },
    },
    sep1: { label: '', separator: true },
    toggleGrid: { label: 'Toggle Grid', action: () => useSceneStore.getState().toggleGrid() },
    toggleBackground: { label: 'Toggle Background', action: () => useSceneStore.getState().toggleBackground() },
    sep2: { label: '', separator: true },
    renderSettings: {
      label: 'Render Settings...',
      action: () => useUIStore.getState().setSettingsModal(true),
    },
  },
  Window: {
    defaultLayout: { label: 'Default Layout', action: () => useUIStore.getState().setPanelLayout('default') },
    lightingOnly: { label: 'Lighting Only', action: () => useUIStore.getState().setPanelLayout('lighting') },
    fullPreview: { label: 'Full Preview', action: () => useUIStore.getState().setPanelLayout('fullPreview') },
  },
  Help: {
    docs: { label: 'Documentation', action: () => window.open('https://docs.lightstudio.dev', '_blank') },
    shortcuts: { label: 'Keyboard Shortcuts', action: () => {} },
    sep1: { label: '', separator: true },
    about: { label: 'About', action: () => useUIStore.getState().setAboutModal(true) },
  },
});

const MENU_KEYS = ['Project', 'Edit', 'Create', 'Canvas', 'Window', 'Help'];

export const TopMenubar: React.FC<TopMenubarProps> = ({ sceneManagerRef, onExportImage }) => {
  const openMenu = useUIStore((s) => s.openMenu);
  const setOpenMenu = useUIStore((s) => s.setOpenMenu);
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  // Subscribe to undo/redo state for dynamic labels
  const undoStack = useHistoryStore((s) => s.undoStack);
  const redoStack = useHistoryStore((s) => s.redoStack);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const undoLabel = canUndo ? undoStack[undoStack.length - 1].label : null;
  const redoLabel = canRedo ? redoStack[redoStack.length - 1].label : null;

  // Build menu definitions with current callbacks and history state
  const menuDefinitions = useMemo(
    () => MENU_DEFINITIONS(onExportImage, sceneManagerRef, undoLabel, redoLabel, canUndo, canRedo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onExportImage, sceneManagerRef, undoLabel, redoLabel, canUndo, canRedo],
  );

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setHoveredMenu(null);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [openMenu, setOpenMenu]);

  const handleMenuClick = useCallback(
    (menuKey: string) => {
      if (openMenu === menuKey) {
        setOpenMenu(null);
        setHoveredMenu(null);
      } else {
        setOpenMenu(menuKey);
        setHoveredMenu(null);
      }
    },
    [openMenu, setOpenMenu],
  );

  const handleMenuHover = useCallback(
    (menuKey: string) => {
      if (openMenu) {
        setOpenMenu(menuKey);
        setHoveredMenu(menuKey);
      }
    },
    [openMenu, setOpenMenu],
  );

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.disabled) return;
      item.action?.();
      setOpenMenu(null);
      setHoveredMenu(null);
    },
    [setOpenMenu],
  );

  return (
    <div
      ref={menuBarRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 28,
        background: 'var(--bg-deep)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        zIndex: 100,
        position: 'relative',
      }}
    >
      {MENU_KEYS.map((key) => (
        <div key={key} style={{ position: 'relative' }}>
          <button
            onClick={() => handleMenuClick(key)}
            onMouseEnter={() => handleMenuHover(key)}
            style={{
              padding: '0 10px',
              height: '100%',
              fontSize: 11,
              color: openMenu === key ? 'var(--text)' : 'var(--text-sec)',
              background: openMenu === key ? 'var(--bg-card)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.1s',
              fontFamily: 'inherit',
            }}
          >
            {key}
          </button>

          {/* Dropdown */}
          {openMenu === key && menuDefinitions[key] && (
            <div
              className="context-menu"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: -1,
              }}
            >
              {Object.entries(menuDefinitions[key]).map(([itemKey, itemRaw], idx) => {
                const item = itemRaw as MenuItem;
                if (item.separator) {
                  return <div key={`sep-${idx}`} className="context-menu-sep" />;
                }

                const hasSubmenu = item.submenu && Object.keys(item.submenu).length > 0;

                return (
                  <div
                    key={`${key}-${idx}`}
                    style={{ position: 'relative' }}
                    onMouseEnter={() => hasSubmenu && setHoveredMenu(`${key}-${idx}`)}
                    onMouseLeave={() => setHoveredMenu(null)}
                  >
                    <div
                      className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
                      onClick={() => !hasSubmenu && handleItemClick(item)}
                      style={{
                        justifyContent: hasSubmenu ? 'space-between' : undefined,
                        paddingRight: hasSubmenu ? 20 : 10,
                        opacity: item.disabled ? 0.35 : 1,
                      }}
                    >
                      <span>{item.label}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {item.shortcut && (
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 16 }}>
                            {item.shortcut}
                          </span>
                        )}
                        {hasSubmenu && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="var(--text-dim)">
                            <path d="M2 0l6 4-6 4z" />
                          </svg>
                        )}
                      </span>
                    </div>

                    {/* Submenu */}
                    {hasSubmenu && hoveredMenu === `${key}-${idx}` && (
                      <div
                        className="context-menu"
                        style={{
                          position: 'absolute',
                          top: -1,
                          left: '100%',
                        }}
                      >
                        {Object.entries(item.submenu!).map(([subKey, subItemRaw], subIdx) => {
                          const subItem = subItemRaw as MenuItem;
                          return (
                            <div
                              key={`${key}-sub-${subIdx}`}
                              className="context-menu-item"
                              onClick={() => handleItemClick(subItem)}
                            >
                              {subItem.label}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};