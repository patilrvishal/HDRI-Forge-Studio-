import React, { useCallback } from 'react';
import { useUIStore, type ActiveTool } from '../../store/uiStore';
import { useLightsStore } from '../../store/lightsStore';
import { useSceneStore } from '../../store/sceneStore';
import { SceneManager } from '../../three/engine';

/**
 * Tool strip down the left edge, laid out like HDR Light Studio's: the working tools on top, then one-click buttons that
 * ADD a light of each kind, then the view actions at the bottom. Big icons, no tiny text; every button has a tooltip.
 */
type AddType = Parameters<ReturnType<typeof useLightsStore.getState>['addLight']>[0];

const S = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

interface ToolDef {
  id: ActiveTool | 'fullscreen' | 'settings';
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'S', icon: <svg {...S}><path d="M6 3l3 17 3.2-6.8L19 10z" /></svg> },
  { id: 'move', label: 'Move', shortcut: 'G', icon: <svg {...S}><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></svg> },
  { id: 'rotate', label: 'Rotate', shortcut: 'R', icon: <svg {...S}><path d="M20 12a8 8 0 11-3-6.2" /><path d="M20 3v6h-6" /></svg> },
  { id: 'scale', label: 'Scale', shortcut: '', icon: <svg {...S}><path d="M4 20L20 4M13 4h7v7M11 20H4v-7" /></svg> },
];

const ACTIONS: ToolDef[] = [
  { id: 'isolate', label: 'Isolate', shortcut: 'I', icon: <svg {...S}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg> },
  { id: 'bookmark', label: 'Bookmark', shortcut: 'B', icon: <svg {...S}><path d="M6 3h12v18l-6-4.5L6 21z" /></svg> },
  { id: 'gridSnap', label: 'Grid Snap', shortcut: '', icon: <svg {...S}><path d="M3 8h18M3 16h18M8 3v18M16 3v18" /></svg> },
  { id: 'measure', label: 'Measure', shortcut: 'M', icon: <svg {...S}><path d="M3 15l12-12 6 6-12 12z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></svg> },
];

const BOTTOM: ToolDef[] = [
  { id: 'fullscreen', label: 'Fullscreen', shortcut: 'F11', icon: <svg {...S}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg> },
  { id: 'settings', label: 'Settings', shortcut: '', icon: <svg {...S}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg> },
];

/** One-click "add a light" buttons. */
const ADD_LIGHTS: { type: AddType; label: string; icon: React.ReactNode }[] = [
  { type: 'area', label: 'Area light', icon: <svg {...S}><rect x="4" y="6" width="16" height="12" rx="1.5" /><path d="M12 18v3M8 21h8" /></svg> },
  { type: 'roundLight', label: 'Round light', icon: <svg {...S}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" opacity="0.55" /></svg> },
  { type: 'rectLight', label: 'Rect light', icon: <svg {...S}><rect x="3.5" y="7" width="17" height="10" rx="1.5" /></svg> },
  { type: 'scrimLight', label: 'Scrim light', icon: <svg {...S}><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 9h16M4 14h16" opacity="0.5" /></svg> },
  { type: 'boxGradLight', label: 'Box gradient light', icon: <svg {...S}><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 20L20 4" opacity="0.6" /></svg> },
  { type: 'gradientLight', label: 'Gradient light', icon: <svg {...S}><rect x="4" y="9" width="16" height="6" rx="1" /><path d="M8 9v6M12 9v6M16 9v6" opacity="0.5" /></svg> },
  { type: 'pictureLight', label: 'Picture light', icon: <svg {...S}><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4 4 3 3-2.5 4 3.5" /></svg> },
  { type: 'darkLight', label: 'Dark light (subtracts)', icon: <svg {...S}><circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.35" /><path d="M8 12h8" /></svg> },
  { type: 'sunShadeLight', label: 'Sun shade light', icon: <svg {...S}><circle cx="9" cy="9" r="3.5" /><path d="M9 2.5v1.5M2.5 9H4M4.5 4.5l1 1M13.5 4.5l-1 1" /><path d="M11 20c0-4 3-6 9-6" /></svg> },
];

interface LeftToolbarProps {
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
}

const Divider: React.FC = () => <div style={{ width: 28, height: 1, background: 'var(--border-light)', margin: '5px 0', flexShrink: 0 }} />;

export const LeftToolbar: React.FC<LeftToolbarProps> = ({ sceneManagerRef }) => {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const setSettingsModal = useUIStore((s) => s.setSettingsModal);
  const gridSnapEnabled = useUIStore((s) => s.gridSnapEnabled);
  const toggleGridSnap = useUIStore((s) => s.toggleGridSnap);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const lights = useLightsStore((s) => s.lights);
  const toggleLightSolo = useLightsStore((s) => s.toggleLightSolo);
  const saveCameraBookmark = useSceneStore((s) => s.saveCameraBookmark);
  const cameraBookmarks = useSceneStore((s) => s.cameraBookmarks);

  const selectedLight = lights.find((l) => l.id === selectedLightId) ?? null;

  const handleToolClick = useCallback(
    (tool: ToolDef) => {
      switch (tool.id) {
        case 'fullscreen':
          toggleFullscreen();
          return;
        case 'settings':
          setSettingsModal(true);
          return;
        case 'isolate':
          // Solo the selected light so only it lights the scene - click again to un-solo.
          if (selectedLightId) toggleLightSolo(selectedLightId);
          return;
        case 'bookmark': {
          // Quick-save the current camera view without the name prompt.
          const sm = sceneManagerRef.current;
          if (!sm || cameraBookmarks.length >= 8) return;
          const camState = sm.getCameraState();
          saveCameraBookmark(`Camera ${cameraBookmarks.length + 1}`, camState.position, camState.target, camState.fov);
          return;
        }
        case 'gridSnap':
          toggleGridSnap();
          return;
        default:
          setActiveTool(tool.id as ActiveTool);
      }
    },
    [setActiveTool, toggleFullscreen, setSettingsModal, selectedLightId, toggleLightSolo, sceneManagerRef, cameraBookmarks, saveCameraBookmark, toggleGridSnap],
  );

  const renderTool = (tool: ToolDef) => {
    let isActive = tool.id === activeTool;
    if (tool.id === 'fullscreen') isActive = useUIStore.getState().isFullscreen;
    else if (tool.id === 'isolate') isActive = !!selectedLight?.solo;
    else if (tool.id === 'gridSnap') isActive = gridSnapEnabled;
    else if (tool.id === 'bookmark') isActive = false; // momentary action, not a mode
    const disabled = tool.id === 'isolate' && !selectedLightId;
    const title =
      tool.id === 'isolate'
        ? selectedLightId
          ? `${selectedLight?.solo ? 'Un-isolate' : 'Isolate'} the selected light (${tool.shortcut})`
          : 'Select a light first (Isolate)'
        : tool.id === 'bookmark'
          ? 'Quick-save the current camera view (B)'
          : `${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`;
    return (
      <button
        key={tool.id}
        className={`btn-icon ${isActive ? 'active' : ''}`}
        onClick={() => handleToolClick(tool)}
        disabled={disabled}
        title={title}
        aria-label={tool.label}
        style={{ width: 40, height: 40, borderRadius: 8, opacity: disabled ? 0.4 : 1, flexShrink: 0 }}
      >
        {tool.icon}
      </button>
    );
  };

  return (
    <div
      className="left-toolbar"
      style={{
        width: 52,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '6px 0',
        gap: 3,
        flexShrink: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {TOOLS.map(renderTool)}
      <Divider />
      {ADD_LIGHTS.map((l) => (
        <button
          key={l.type}
          className="btn-icon"
          onClick={() => {
            const st = useLightsStore.getState();
            st.addLight(l.type);
            const created = useLightsStore.getState().lights.slice(-1)[0];
            if (created) st.selectLight(created.id);
          }}
          title={`Add ${l.label}`}
          aria-label={`Add ${l.label}`}
          style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0 }}
        >
          {l.icon}
        </button>
      ))}
      <Divider />
      {ACTIONS.map(renderTool)}
      <div style={{ flex: 1 }} />
      {BOTTOM.map(renderTool)}
    </div>
  );
};
