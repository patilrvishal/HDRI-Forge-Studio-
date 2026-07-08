import { create } from 'zustand';

import type { MaterialPresetKey, PreviewBackground } from '../types/Preset';

export type ActiveTool = 'select' | 'move' | 'rotate' | 'scale' | 'isolate' | 'bookmark' | 'gridSnap' | 'measure';
export type PanelLayout = 'default' | 'lighting' | 'fullPreview';

interface UIState {
  // Panels
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  settingsModalOpen: boolean;
  aboutModalOpen: boolean;
  
  // Tools
  activeTool: ActiveTool;
  
  // Layout
  panelLayout: PanelLayout;
  isFullscreen: boolean;
  
  // Menubar
  openMenu: string | null;
  
  // Material preview
  materialPreset: MaterialPresetKey;
  previewBackground: PreviewBackground;

  // Frame range (for light list panel)
  frameStart: number;
  frameEnd: number;
  currentFrame: number;
  isPlaying: boolean;
  isLooping: boolean;
  
  // Actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  setSettingsModal: (open: boolean) => void;
  setAboutModal: (open: boolean) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setPanelLayout: (layout: PanelLayout) => void;
  toggleFullscreen: () => void;
  setOpenMenu: (menu: string | null) => void;
  setFrameRange: (start: number, end: number) => void;
  setCurrentFrame: (frame: number) => void;
  togglePlaying: () => void;
  toggleLooping: () => void;
  stepFrameForward: () => void;
  stepFrameBackward: () => void;
  setMaterialPreset: (preset: MaterialPresetKey) => void;
  setPreviewBackground: (bg: PreviewBackground) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  leftPanelOpen: true,
  rightPanelOpen: true,
  bottomPanelOpen: true,
  settingsModalOpen: false,
  aboutModalOpen: false,
  activeTool: 'select',
  panelLayout: 'default',
  isFullscreen: false,
  openMenu: null,
  frameStart: 0,
  frameEnd: 100,
  currentFrame: 0,
  isPlaying: false,
  isLooping: true,
  materialPreset: 'metal' as MaterialPresetKey,
  previewBackground: 'grey' as PreviewBackground,

  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setSettingsModal: (open) => set({ settingsModalOpen: open }),
  setAboutModal: (open) => set({ aboutModalOpen: open }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setPanelLayout: (layout) => {
    set((s) => {
      switch (layout) {
        case 'default':
          return { panelLayout: layout, leftPanelOpen: true, rightPanelOpen: true, bottomPanelOpen: true };
        case 'lighting':
          return { panelLayout: layout, leftPanelOpen: true, rightPanelOpen: true, bottomPanelOpen: false };
        case 'fullPreview':
          return { panelLayout: layout, leftPanelOpen: false, rightPanelOpen: false, bottomPanelOpen: false };
        default:
          return { panelLayout: layout };
      }
    });
  },
  toggleFullscreen: () => {
    set((s) => {
      const newFs = !s.isFullscreen;
      if (newFs) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
      return { isFullscreen: newFs };
    });
  },
  setOpenMenu: (menu) => set({ openMenu: menu }),
  setFrameRange: (start, end) => set({ frameStart: start, frameEnd: end }),
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
  toggleLooping: () => set((s) => ({ isLooping: !s.isLooping })),
  stepFrameForward: () => {
    const { currentFrame, frameEnd, isLooping, frameStart } = get();
    const next = currentFrame + 1;
    if (next > frameEnd) {
      set({ currentFrame: isLooping ? frameStart : frameEnd });
    } else {
      set({ currentFrame: next });
    }
  },
  stepFrameBackward: () => {
    const { currentFrame, frameStart, frameEnd, isLooping } = get();
    const prev = currentFrame - 1;
    if (prev < frameStart) {
      set({ currentFrame: isLooping ? frameEnd : frameStart });
    } else {
      set({ currentFrame: prev });
    }
  },
  setMaterialPreset: (preset) => set({ materialPreset: preset }),
  setPreviewBackground: (bg) => set({ previewBackground: bg }),
}));