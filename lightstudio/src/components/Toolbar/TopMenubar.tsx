import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useUIStore } from '../../store/uiStore';
import type { PanelKey, PanelVisibilityState } from '../../store/uiStore';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { useCameraStore } from '../../store/cameraStore';
import { useHistoryStore } from '../../store/historyStore';
import { SceneExporter } from '../../three/SceneExporter';
import { exportSceneAsHDR, exportSceneAsEXR } from '../../three/HDRIExporter';
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
  onFinalRender?: () => void;
}

function checkLabel(label: string, checked: boolean): string {
  return checked ? `${label}` : label;
}

const MENU_DEFINITIONS = (
  onExportImage: (() => void) | undefined,
  onFinalRender: (() => void) | undefined,
  sceneManagerRef: React.MutableRefObject<SceneManager | null> | undefined,
  undoLabel: string | null,
  redoLabel: string | null,
  canUndo: boolean,
  canRedo: boolean,
  panelVisibility: PanelVisibilityState,
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
        const name = prompt('Enter filename:', `lightforge_scene_${Date.now()}.lightscene`);
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
    sep2b: { label: '', separator: true },
    finalRender: {
      label: 'Final Render...',
      shortcut: 'Ctrl+Shift+E',
      action: () => onFinalRender?.(),
    },
    exportHDR: {
      label: 'Export HDRI (.hdr)...',
      action: () => {
        if (!sceneManagerRef?.current) return;
        const { renderer, scene } = sceneManagerRef.current;
        exportSceneAsHDR(renderer, scene, { size: 2048 });
      },
    },
    exportEXR: {
      label: 'Export EXR (.exr)...',
      action: () => {
        if (!sceneManagerRef?.current) return;
        const { renderer, scene } = sceneManagerRef.current;
        exportSceneAsEXR(renderer, scene, { size: 2048 });
      },
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
    lights: {
      label: 'Lights',
      submenu: {
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
    },
    camera: {
      label: 'Camera',
      submenu: {
        freeCamera: {
          label: 'Free Camera',
          action: () => useCameraStore.getState().addCamera({ targetId: null }),
        },
        targetCamera: {
          label: 'Target Camera',
          action: () => useCameraStore.getState().addCamera({ targetId: 'model' }),
        },
      },
    },
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
    sep2b: { label: '', separator: true },
    environmentBrowser: { label: 'Environment Browser...', action: () => useUIStore.getState().setEnvBrowserModal(true) },
    sep2: { label: '', separator: true },
    renderSettings: {
      label: 'Render Settings...',
      action: () => useUIStore.getState().setSettingsModal(true),
    },
  },
  Window: {
    lightList: {
      label: checkLabel('Light List', panelVisibility.leftPanel),
      shortcut: 'Ctrl+1',
      action: () => useUIStore.getState().togglePanel('leftPanel' as PanelKey),
    },
    properties: {
      label: checkLabel('Properties', panelVisibility.rightPanel),
      shortcut: 'Ctrl+2',
      action: () => useUIStore.getState().togglePanel('rightPanel' as PanelKey),
    },
    timeline: {
      label: checkLabel('Timeline', panelVisibility.timelineSection),
      shortcut: 'Ctrl+3',
      action: () => useUIStore.getState().togglePanel('timelineSection' as PanelKey),
    },
    presets: {
      label: checkLabel('Presets', panelVisibility.presetsSection),
      shortcut: 'Ctrl+4',
      action: () => useUIStore.getState().togglePanel('presetsSection' as PanelKey),
    },
    materialEditor: {
      label: checkLabel('Material Editor', panelVisibility.materialPanel),
      shortcut: 'Ctrl+5',
      action: () => useUIStore.getState().togglePanel('materialPanel' as PanelKey),
    },
    sep1: { label: '', separator: true },
    defaultLayout: {
      label: 'Default Layout',
      shortcut: 'Ctrl+Shift+D',
      action: () => useUIStore.getState().setPanelLayout('default'),
    },
    lightingOnly: {
      label: 'Lighting Only',
      shortcut: 'Ctrl+Shift+L',
      action: () => useUIStore.getState().setPanelLayout('lighting'),
    },
    focusMode: {
      label: 'Focus Mode',
      shortcut: 'F',
      action: () => useUIStore.getState().toggleFocusMode(),
    },
    sep2: { label: '', separator: true },
    resetLayout: {
      label: 'Reset Layout',
      shortcut: 'Ctrl+Shift+R',
      action: () => useUIStore.getState().setPanelLayout('default'),
    },
  },
  Help: {
    docs: { label: 'Documentation', shortcut: '?', action: () => useUIStore.getState().setManualModal(true) },
    shortcuts: { label: 'Keyboard Shortcuts', action: () => useUIStore.getState().setManualModal(true) },
    sep1: { label: '', separator: true },
    about: { label: 'About', action: () => useUIStore.getState().setAboutModal(true) },
  },
});

const MENU_KEYS = ['Project', 'Edit', 'Create', 'Canvas', 'Window', 'Help'];

const THEME_OPTIONS: Array<{ value: string; label: string; dot: string }> = [
  { value: 'purple', label: 'Purple', dot: '#c084fc' },
  { value: 'yellow-orange', label: 'Yellow-Orange', dot: '#ffc24d' },
  { value: 'white-orange', label: 'White-Orange', dot: '#fff3e0' },
  { value: 'bluish-black', label: 'Bluish-Black', dot: '#6c8cff' },
  { value: 'red-grey', label: 'Red-Grey', dot: '#e5595f' },
  { value: 'bright-cyan', label: 'Bright Cyan', dot: '#22d3ee' },
];

const THEME_STORAGE_KEY = 'lightforge-accent-theme';

const PANEL_SHADE_OPTIONS: Array<{ value: string; label: string; dot: string }> = [
  { value: 'darkest', label: 'Darkest', dot: '#0d0d0f' },
  { value: 'dark', label: 'Dark', dot: '#141417' },
  { value: 'medium', label: 'Medium', dot: '#2a292e' },
  { value: 'light', label: 'Light', dot: '#46444c' },
  { value: 'lightest', label: 'Lightest', dot: '#625f68' },
];

const PANEL_SHADE_STORAGE_KEY = 'lightforge-panel-shade';

// ── Nav icon set - minimal 14x14 stroke glyphs, matching style ──────────
const IconHome = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M2 7.5L8 2l6 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.5 6.5V13.5a.5.5 0 0 0 .5.5h3v-4h2v4h3a.5.5 0 0 0 .5-.5V6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconFolder = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5H12.5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const IconCreate = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 5.5v5M5.5 8h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const IconCanvas = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
const IconWindow = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2 6h12" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
const IconHelp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6.2 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.6-.9 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="8" cy="11" r="0.6" fill="currentColor" />
  </svg>
);

const NAV_ICONS: Record<string, () => React.ReactElement> = {
  Home: IconHome,
  Project: IconFolder,
  Edit: IconEdit,
  Create: IconCreate,
  Canvas: IconCanvas,
  Window: IconWindow,
  Help: IconHelp,
};

/** Layered hexagon "forge" logo mark, matching the app's accent. */
function LogoMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
      <path d="M16 2 28 9v14L16 30 4 23V9z" fill="url(#logoGrad)" opacity="0.9" />
      <path d="M16 2 28 9v14L16 30 4 23V9z" stroke="var(--theme-accent-bright)" strokeWidth="1" opacity="0.6" />
      <path d="M16 9l7 4v8l-7 4-7-4v-8z" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.3" fill="none" />
      <path d="M9 13l7 4 7-4M16 17v8" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" />
      <defs>
        <linearGradient id="logoGrad" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--theme-accent-bright)" />
          <stop offset="1" stopColor="var(--theme-accent)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Accent-theme dropdown for the tab-bar highlight + Properties card frame.
 *  Applies a data-theme attribute on <body> that the CSS theme presets key
 *  off of, and persists the choice across reloads. Custom button+list
 *  (not a native select) so it can show a colour swatch dot per option. */
function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'purple';
    } catch {
      return 'purple';
    }
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (theme === 'purple') {
      delete document.body.dataset.theme;
    } else {
      document.body.dataset.theme = theme;
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors (private browsing, etc.)
    }
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="theme-switcher-btn" onClick={() => setOpen((o) => !o)} title="Accent theme">
        <span className="theme-switcher-dot" style={{ background: current.dot, color: current.dot }} />
        <span>{current.label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.7, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="context-menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 150 }}>
          {THEME_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              className="context-menu-item"
              onClick={() => {
                setTheme(opt.value);
                setOpen(false);
              }}
              style={{ gap: 8 }}
            >
              <span className="theme-switcher-dot" style={{ background: opt.dot, color: opt.dot, flexShrink: 0 }} />
              <span>{opt.label}</span>
              {opt.value === theme && (
                <span style={{ marginLeft: 'auto', color: 'var(--theme-accent-bright)', fontSize: 11 }}>✓</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Panel-shade dropdown for the overall grey level of app backgrounds
 *  (deep/panel/card/input/elevated), independent of the accent color above.
 *  Applies a data-shade attribute on <body> that the CSS shade presets key
 *  off of, and persists the choice across reloads. */
function PanelShadeSwitcher() {
  const [shade, setShade] = useState<string>(() => {
    try {
      return localStorage.getItem(PANEL_SHADE_STORAGE_KEY) || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shade === 'dark') {
      delete document.body.dataset.shade;
    } else {
      document.body.dataset.shade = shade;
    }
    try {
      localStorage.setItem(PANEL_SHADE_STORAGE_KEY, shade);
    } catch {
      // ignore storage errors (private browsing, etc.)
    }
  }, [shade]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = PANEL_SHADE_OPTIONS.find((o) => o.value === shade) ?? PANEL_SHADE_OPTIONS[1];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="theme-switcher-btn" onClick={() => setOpen((o) => !o)} title="Panel shade">
        <span className="theme-switcher-dot" style={{ background: current.dot, color: current.dot, border: '1px solid var(--border-light)' }} />
        <span>{current.label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.7, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="context-menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 150 }}>
          {PANEL_SHADE_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              className="context-menu-item"
              onClick={() => {
                setShade(opt.value);
                setOpen(false);
              }}
              style={{ gap: 8 }}
            >
              <span className="theme-switcher-dot" style={{ background: opt.dot, color: opt.dot, flexShrink: 0, border: '1px solid var(--border-light)' }} />
              <span>{opt.label}</span>
              {opt.value === shade && (
                <span style={{ marginLeft: 'auto', color: 'var(--theme-accent-bright)', fontSize: 11 }}>✓</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const TopMenubar: React.FC<TopMenubarProps> = ({ sceneManagerRef, onExportImage, onFinalRender }) => {
  const openMenu = useUIStore((s) => s.openMenu);
  const setOpenMenu = useUIStore((s) => s.setOpenMenu);
  const panelVisibility = useUIStore((s) => s.panelVisibility);
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
    () => MENU_DEFINITIONS(onExportImage, onFinalRender, sceneManagerRef, undoLabel, redoLabel, canUndo, canRedo, panelVisibility),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onExportImage, onFinalRender, sceneManagerRef, undoLabel, redoLabel, canUndo, canRedo, panelVisibility],
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
        height: 48,
        background: 'var(--bg-deep)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        zIndex: 100,
        position: 'relative',
        padding: '0 12px',
        gap: 4,
      }}
    >
      {/* Logo + brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, flexShrink: 0 }}>
        <LogoMark />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          HDRI <span style={{ color: 'var(--theme-accent-bright)' }}>Forge</span> Studio
        </span>
        <span
          style={{
            fontSize: 9, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--bg-card)',
            border: '1px solid var(--border-light)', borderRadius: 10, padding: '2px 7px', flexShrink: 0,
          }}
        >
          v2.1.0
        </span>
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', margin: '10px 4px', background: 'var(--border-light)', flexShrink: 0 }} />

      {/* Home - static brand/"current location" indicator, resets the view */}
      <button
        className="topbar-nav-item active"
        onClick={() => sceneManagerRef?.current?.animateCameraTo([5, 3, 5], [0, 0.5, 0], 500)}
        title="Reset to default view"
      >
        <IconHome />
        <span>Home</span>
      </button>

      {MENU_KEYS.map((key) => {
        const Icon = NAV_ICONS[key];
        return (
        <div key={key} style={{ position: 'relative' }}>
          <button
            className={`topbar-nav-item${openMenu === key ? ' active' : ''}`}
            onClick={() => handleMenuClick(key)}
            onMouseEnter={() => handleMenuHover(key)}
          >
            {Icon && <Icon />}
            <span>{key}</span>
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
        );
      })}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 1, alignSelf: 'stretch', margin: '10px 4px', background: 'var(--border-light)', flexShrink: 0 }} />
        <PanelShadeSwitcher />
        <ThemeSwitcher />
      </div>
    </div>
  );
};