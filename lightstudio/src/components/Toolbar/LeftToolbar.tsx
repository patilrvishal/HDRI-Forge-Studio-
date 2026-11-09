import React, { useCallback, useState } from 'react';
import { useUIStore, type ActiveTool } from '../../store/uiStore';
import { useLightsStore } from '../../store/lightsStore';
import { useSceneStore } from '../../store/sceneStore';
import { SceneManager } from '../../three/engine';

/**
 * Tool strip down the left edge, laid out like HDR Light Studio's: the working tools on top, then one-click buttons that
 * ADD a light of each kind, then the view actions, then fullscreen and settings. Each button is a picture icon (see
 * /public/toolicons) and shows a hover card with its name, what it does and its shortcut.
 */
type AddType = Parameters<ReturnType<typeof useLightsStore.getState>['addLight']>[0];

interface Entry {
  id: string;
  icon: string;
  title: string;
  desc: string;
  shortcut?: string;
}

const TOOLS: (Entry & { id: ActiveTool })[] = [
  { id: 'select', icon: 'select', title: 'Select', desc: 'Pick lights and objects. Click to select, drag to marquee-select.', shortcut: 'S' },
  { id: 'move', icon: 'move', title: 'Move', desc: 'Move the selected light or object with the move handles.', shortcut: 'G' },
  { id: 'rotate', icon: 'rotate', title: 'Rotate', desc: 'Rotate the selected light or object around its centre.', shortcut: 'R' },
  { id: 'scale', icon: 'scale', title: 'Scale', desc: 'Make the selected light bigger or smaller.' },
];

const ADD_LIGHTS: (Entry & { type: AddType })[] = [
  { id: 'area', type: 'area', icon: 'area', title: 'Add Area Light', desc: 'A softbox-style panel light: soft, directional light with natural falloff.' },
  { id: 'roundLight', type: 'roundLight', icon: 'round', title: 'Add Round Light', desc: 'A circular light with a soft glowing centre. Good for bulbs, spots and catch-lights.' },
  { id: 'rectLight', type: 'rectLight', icon: 'rect', title: 'Add Rect Light', desc: 'A rectangular light with a bright centre. Good for windows and strip reflections.' },
  { id: 'scrimLight', type: 'scrimLight', icon: 'scrim', title: 'Add Scrim Light', desc: 'A large diffusion panel with a soft, even fabric-like glow.' },
  { id: 'boxGradLight', type: 'boxGradLight', icon: 'boxgrad', title: 'Add Box Gradient Light', desc: 'A square light that fades from bright to dark across a diagonal.' },
  { id: 'gradientLight', type: 'gradientLight', icon: 'gradient', title: 'Add Gradient Light', desc: 'A long strip that fades along its length. Good for sweeping highlights on body panels.' },
  { id: 'pictureLight', type: 'pictureLight', icon: 'picture', title: 'Add Picture Light', desc: 'Use any image as a light, for example a window or a lighting pattern.' },
  { id: 'darkLight', type: 'darkLight', icon: 'dark', title: 'Add Dark Light', desc: 'Subtracts light (a flag / negative fill) to add contrast and deepen reflections.' },
  { id: 'sunShadeLight', type: 'sunShadeLight', icon: 'sunshade', title: 'Add Sun Shade Light', desc: 'A sun partly covered by cloud or a shade card, for softened daylight.' },
];

const ACTIONS: Entry[] = [
  { id: 'isolate', icon: 'isolate', title: 'Isolate', desc: 'Solo the selected light so only it lights the scene. Click again to bring the others back.', shortcut: 'I' },
  { id: 'bookmark', icon: 'bookmark', title: 'Save Camera View', desc: 'Quick-save the current camera view as a numbered bookmark.', shortcut: 'B' },
  { id: 'gridSnap', icon: 'gridsnap', title: 'Grid Snap', desc: 'Snap moving lights to a regular grid.' },
  { id: 'measure', icon: 'measure', title: 'Measure', desc: 'Measure the distance between two points in the scene.', shortcut: 'M' },
];

const BOTTOM: Entry[] = [
  { id: 'fullscreen', icon: 'fullscreen', title: 'Fullscreen', desc: 'Make the window full screen. Press again (or Esc) to leave.', shortcut: 'F11' },
  { id: 'settings', icon: 'settings', title: 'Settings', desc: 'Open the application settings.' },
];

interface LeftToolbarProps {
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
}

const Divider: React.FC = () => <div style={{ width: 30, height: 1, background: 'var(--border-light)', margin: '5px 0', flexShrink: 0 }} />;

interface Tip { entry: Entry; top: number; left: number; note?: string }

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
  const [tip, setTip] = useState<Tip | null>(null);

  const selectedLight = lights.find((l) => l.id === selectedLightId) ?? null;

  const showTip = (e: React.MouseEvent<HTMLElement>, entry: Entry, note?: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ entry, top: r.top + r.height / 2, left: r.right + 10, note });
  };

  const handleAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'fullscreen':
          toggleFullscreen();
          return;
        case 'settings':
          setSettingsModal(true);
          return;
        case 'isolate':
          if (selectedLightId) toggleLightSolo(selectedLightId);
          return;
        case 'bookmark': {
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
          setActiveTool(id as ActiveTool);
      }
    },
    [setActiveTool, toggleFullscreen, setSettingsModal, selectedLightId, toggleLightSolo, sceneManagerRef, cameraBookmarks, saveCameraBookmark, toggleGridSnap],
  );

  const button = (entry: Entry, onClick: () => void, opts: { active?: boolean; disabled?: boolean; note?: string } = {}) => (
    <button
      key={entry.id}
      className={`btn-icon ${opts.active ? 'active' : ''}`}
      onClick={onClick}
      disabled={opts.disabled}
      aria-label={entry.title}
      onMouseEnter={(e) => showTip(e, entry, opts.note)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => showTip(e as unknown as React.MouseEvent<HTMLElement>, entry, opts.note)}
      onBlur={() => setTip(null)}
      style={{ width: 44, height: 44, borderRadius: 10, opacity: opts.disabled ? 0.4 : 1, flexShrink: 0, padding: 0 }}
    >
      <img src={`/toolicons/${entry.icon}.png`} alt="" draggable={false} style={{ width: 32, height: 32, pointerEvents: 'none' }} />
    </button>
  );

  return (
    <div
      className="left-toolbar"
      style={{
        width: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '6px 0',
        gap: 3,
        flexShrink: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
      onScroll={() => setTip(null)}
    >
      {TOOLS.map((t) => button(t, () => handleAction(t.id), { active: t.id === activeTool }))}
      <Divider />
      {ADD_LIGHTS.map((l) =>
        button(l, () => {
          const st = useLightsStore.getState();
          st.addLight(l.type);
          const created = useLightsStore.getState().lights.slice(-1)[0];
          if (created) st.selectLight(created.id);
        }),
      )}
      <Divider />
      {ACTIONS.map((a) => {
        if (a.id === 'isolate') {
          return button(a, () => handleAction(a.id), {
            active: !!selectedLight?.solo,
            disabled: !selectedLightId,
            note: selectedLightId ? (selectedLight?.solo ? 'On - click to bring the other lights back' : undefined) : 'Select a light first',
          });
        }
        if (a.id === 'gridSnap') return button(a, () => handleAction(a.id), { active: gridSnapEnabled, note: gridSnapEnabled ? 'On' : 'Off' });
        return button(a, () => handleAction(a.id), {
          note: a.id === 'bookmark' && cameraBookmarks.length >= 8 ? 'Limit of 8 bookmarks reached' : undefined,
        });
      })}
      <div style={{ flex: 1 }} />
      <Divider />
      {BOTTOM.map((b) => button(b, () => handleAction(b.id)))}

      {tip && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: tip.left,
            top: tip.top,
            transform: 'translateY(-50%)',
            zIndex: 100000,
            maxWidth: 270,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(14,16,20,0.97)',
            border: '1px solid var(--border-light)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{tip.entry.title}</span>
            {tip.entry.shortcut && (
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, border: '1px solid var(--border-light)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                {tip.entry.shortcut}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-sec)', marginTop: 4 }}>{tip.entry.desc}</div>
          {tip.note && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 5 }}>{tip.note}</div>}
        </div>
      )}
    </div>
  );
};
