import React, { useCallback } from 'react';
import { useUIStore, type ActiveTool } from '../../store/uiStore';
import { SceneManager } from '../../three/engine';

interface ToolItem {
  id: ActiveTool | 'fullscreen' | 'settings';
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}

const TOOLS: ToolItem[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'S',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 1L5.5 13 7.5 7.5 13 5.5z" />
      </svg>
    ),
  },
  {
    id: 'move',
    label: 'Move',
    shortcut: 'G',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 1v12M1 7h12M7 1l-2 2M7 1l2 2M7 13l-2-2M7 13l2-2M1 7l2-2M1 7l2 2M13 7l-2-2M13 7l-2 2" />
      </svg>
    ),
  },
  {
    id: 'rotate',
    label: 'Rotate',
    shortcut: 'R',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 7A5 5 0 117 2" />
        <path d="M12 2v5H7" />
      </svg>
    ),
  },
  {
    id: 'scale',
    label: 'Scale',
    shortcut: '',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 13L13 1M5 1h8v8M9 13h4v-4" />
      </svg>
    ),
  },
  {
    id: 'isolate',
    label: 'Isolate',
    shortcut: 'I',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="5.5" />
        <circle cx="7" cy="7" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'bookmark',
    label: 'Bookmark',
    shortcut: 'B',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 1.5v11l4-3 4 3v-11z" />
      </svg>
    ),
  },
  {
    id: 'gridSnap',
    label: 'Grid Snap',
    shortcut: '',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M0 3.5h14M0 7h14M0 10.5h14M3.5 0v14M7 0v14M10.5 0v14" />
      </svg>
    ),
  },
  {
    id: 'measure',
    label: 'Measure',
    shortcut: 'M',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12V6a5 5 0 0110 0v6" />
        <path d="M1 9h10" />
        <path d="M6 4v2" />
      </svg>
    ),
  },
  {
    id: 'fullscreen',
    label: 'Fullscreen',
    shortcut: 'F11',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    shortcut: '',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="2" />
        <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4" />
      </svg>
    ),
  },
];

interface LeftToolbarProps {
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
}

export const LeftToolbar: React.FC<LeftToolbarProps> = (_sceneManagerRef) => {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const setSettingsModal = useUIStore((s) => s.setSettingsModal);

  const handleToolClick = useCallback(
    (tool: ToolItem) => {
      if (tool.id === 'fullscreen') {
        toggleFullscreen();
        return;
      }
      if (tool.id === 'settings') {
        setSettingsModal(true);
        return;
      }
      setActiveTool(tool.id as ActiveTool);
    },
    [setActiveTool, toggleFullscreen, setSettingsModal]
  );

  return (
    <div
      className="left-toolbar"
      style={{
        width: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '4px 0',
        gap: 2,
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      {TOOLS.map((tool) => {
        const isActive =
          tool.id === activeTool ||
          (tool.id === 'fullscreen' && useUIStore.getState().isFullscreen);

        return (
          <button
            key={tool.id}
            className={`btn-icon ${isActive ? 'active' : ''}`}
            onClick={() => handleToolClick(tool)}
            title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
            aria-label={tool.label}
            style={{ width: 30, height: 30 }}
          >
            {tool.icon}
          </button>
        );
      })}
    </div>
  );
};