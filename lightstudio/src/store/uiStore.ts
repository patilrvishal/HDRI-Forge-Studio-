import { create } from 'zustand';

import type { MaterialPresetKey, PreviewBackground } from '../types/Preset';

export type ActiveTool = 'select' | 'move' | 'rotate' | 'scale' | 'isolate' | 'bookmark' | 'gridSnap' | 'measure';
export type RightPanelTab = 'properties' | 'preview' | 'material' | 'matEdit';
export type PanelLayout = 'default' | 'lighting' | 'fullPreview';

/** Granular panel visibility keys */
export type PanelKey =
  | 'leftPanel'
  | 'rightPanel'
  | 'bottomPanel'
  | 'timelineSection'
  | 'presetsSection'
  | 'materialPanel'
  | 'historyPanel'
  | 'viewportDesign';

export interface PanelVisibilityState {
  [K in PanelKey]: boolean;
}

interface SavedLayout {
  panels: PanelVisibilityState;
  rightTab: string;
}

interface UIState {
  // Panels — legacy booleans (kept for backward compat)
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;

  // Granular panel visibility
  panelVisibility: PanelVisibilityState;

  // Focus mode
  focusMode: boolean;
  savedLayoutBeforeFocus: SavedLayout | null;

  // Modals
  settingsModalOpen: boolean;
  aboutModalOpen: boolean;
  envBrowserModalOpen: boolean;
  manualModalOpen: boolean;

  // Tools
  activeTool: ActiveTool;
  gridSnapEnabled: boolean;

  // Layout
  panelLayout: PanelLayout;
  isFullscreen: boolean;

  // Menubar
  openMenu: string | null;

  // Material preview
  materialPreset: MaterialPresetKey;
  previewBackground: PreviewBackground;

  // Right panel tab
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;

  // Frame range
  frameStart: number;
  frameEnd: number;
  currentFrame: number;
  isPlaying: boolean;
  isLooping: boolean;

  // ── Actions ──────────────────────────────────────────────────────
  // Legacy toggles (set granular state too)
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;

  // Granular panel control
  togglePanel: (panel: PanelKey) => void;
  showPanel: (panel: PanelKey) => void;
  hidePanel: (panel: PanelKey) => void;
  setPanelVisibility: (visibility: Partial<PanelVisibilityState>) => void;

  // Focus mode
  toggleFocusMode: () => void;
  savePanelState: () => void;
  restoreLayout: () => void;

  // Modals
  setSettingsModal: (open: boolean) => void;
  setAboutModal: (open: boolean) => void;
  setEnvBrowserModal: (open: boolean) => void;
  setManualModal: (open: boolean) => void;

  // Tools & Layout
  setActiveTool: (tool: ActiveTool) => void;
  toggleGridSnap: () => void;
  setPanelLayout: (layout: PanelLayout) => void;
  toggleFullscreen: () => void;
  setOpenMenu: (menu: string | null) => void;

  // Frame
  setFrameRange: (start: number, end: number) => void;
  setCurrentFrame: (frame: number) => void;
  togglePlaying: () => void;
  toggleLooping: () => void;
  stepFrameForward: () => void;
  stepFrameBackward: () => void;

  // Material preview
  setMaterialPreset: (preset: MaterialPresetKey) => void;
  setPreviewBackground: (bg: PreviewBackground) => void;
}

const DEFAULT_PANEL_VISIBILITY: PanelVisibilityState = {
  leftPanel: true,
  rightPanel: true,
  bottomPanel: true,
  timelineSection: true,
  presetsSection: true,
  materialPanel: true,
  historyPanel: false,
  viewportDesign: false,
};

export const useUIStore = create<UIState>((set, get) => ({
  // Legacy booleans — derived from granular state
  leftPanelOpen: true,
  rightPanelOpen: true,
  bottomPanelOpen: true,

  panelVisibility: { ...DEFAULT_PANEL_VISIBILITY },
  focusMode: false,
  savedLayoutBeforeFocus: null,

  settingsModalOpen: false,
  aboutModalOpen: false,
  envBrowserModalOpen: false,
  manualModalOpen: false,
  activeTool: 'select',
  gridSnapEnabled: false,
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
  rightPanelTab: 'properties' as RightPanelTab,

  // ── Legacy toggles ────────────────────────────────────────────
  toggleLeftPanel: () => {
    set((s) => {
      const next = !s.panelVisibility.leftPanel;
      return {
        leftPanelOpen: next,
        panelVisibility: { ...s.panelVisibility, leftPanel: next },
      };
    });
  },
  toggleRightPanel: () => {
    set((s) => {
      const next = !s.panelVisibility.rightPanel;
      return {
        rightPanelOpen: next,
        panelVisibility: { ...s.panelVisibility, rightPanel: next },
      };
    });
  },
  toggleBottomPanel: () => {
    set((s) => {
      const next = !s.panelVisibility.bottomPanel;
      return {
        bottomPanelOpen: next,
        panelVisibility: { ...s.panelVisibility, bottomPanel: next },
      };
    });
  },

  // ── Granular panel control ────────────────────────────────────
  togglePanel: (panel) => {
    set((s) => {
      const next = !s.panelVisibility[panel];
      const updated = { ...s.panelVisibility, [panel]: next };

      // Sync legacy booleans
      let leftPanelOpen = s.leftPanelOpen;
      let rightPanelOpen = s.rightPanelOpen;
      let bottomPanelOpen = s.bottomPanelOpen;

      if (panel === 'leftPanel') leftPanelOpen = next;
      if (panel === 'rightPanel') rightPanelOpen = next;
      if (panel === 'bottomPanel' || panel === 'timelineSection' || panel === 'presetsSection') {
        bottomPanelOpen = updated.timelineSection || updated.presetsSection;
      }

      return { panelVisibility: updated, leftPanelOpen, rightPanelOpen, bottomPanelOpen };
    });
  },

  showPanel: (panel) => {
    set((s) => {
      const updated = { ...s.panelVisibility, [panel]: true };
      let bottomPanelOpen = s.bottomPanelOpen;
      if (panel === 'bottomPanel' || panel === 'timelineSection' || panel === 'presetsSection') {
        bottomPanelOpen = true;
      }
      let rightPanelOpen = s.rightPanelOpen;
      if (panel === 'rightPanel') rightPanelOpen = true;
      let leftPanelOpen = s.leftPanelOpen;
      if (panel === 'leftPanel') leftPanelOpen = true;
      return { panelVisibility: updated, leftPanelOpen, rightPanelOpen, bottomPanelOpen };
    });
  },

  hidePanel: (panel) => {
    set((s) => {
      const updated = { ...s.panelVisibility, [panel]: false };
      let bottomPanelOpen = s.bottomPanelOpen;
      if (panel === 'bottomPanel') bottomPanelOpen = false;
      else if (panel === 'timelineSection' || panel === 'presetsSection') {
        bottomPanelOpen = updated.timelineSection || updated.presetsSection;
      }
      let rightPanelOpen = s.rightPanelOpen;
      if (panel === 'rightPanel') rightPanelOpen = false;
      let leftPanelOpen = s.leftPanelOpen;
      if (panel === 'leftPanel') leftPanelOpen = false;
      return { panelVisibility: updated, leftPanelOpen, rightPanelOpen, bottomPanelOpen };
    });
  },

  setPanelVisibility: (visibility) => {
    set((s) => {
      const updated = { ...s.panelVisibility, ...visibility };
      const leftPanelOpen = updated.leftPanel;
      const rightPanelOpen = updated.rightPanel;
      const bottomPanelOpen = updated.bottomPanel || updated.timelineSection || updated.presetsSection;
      return { panelVisibility: updated, leftPanelOpen, rightPanelOpen, bottomPanelOpen };
    });
  },

  // ── Focus mode ────────────────────────────────────────────────
  savePanelState: () => {
    const { panelVisibility } = get();
    set({ savedLayoutBeforeFocus: { panels: { ...panelVisibility }, rightTab: 'properties' } });
  },

  restoreLayout: () => {
    const { savedLayoutBeforeFocus } = get();
    if (savedLayoutBeforeFocus) {
      set({
        panelVisibility: { ...savedLayoutBeforeFocus.panels },
        leftPanelOpen: savedLayoutBeforeFocus.panels.leftPanel,
        rightPanelOpen: savedLayoutBeforeFocus.panels.rightPanel,
        bottomPanelOpen: savedLayoutBeforeFocus.panels.bottomPanel,
        focusMode: false,
        savedLayoutBeforeFocus: null,
      });
    } else {
      set({
        panelVisibility: { ...DEFAULT_PANEL_VISIBILITY },
        leftPanelOpen: true,
        rightPanelOpen: true,
        bottomPanelOpen: true,
        focusMode: false,
        savedLayoutBeforeFocus: null,
      });
    }
  },

  toggleFocusMode: () => {
    const { focusMode, savePanelState, restoreLayout, setPanelVisibility } = get();
    if (focusMode) {
      restoreLayout();
    } else {
      savePanelState();
      setPanelVisibility({
        leftPanel: false,
        rightPanel: false,
        bottomPanel: false,
        timelineSection: false,
        presetsSection: false,
        materialPanel: false,
        historyPanel: false,
        viewportDesign: false,
      });
      set({ focusMode: true });
    }
  },

  // ── Modals ────────────────────────────────────────────────────
  setSettingsModal: (open) => set({ settingsModalOpen: open }),
  setAboutModal: (open) => set({ aboutModalOpen: open }),
  setEnvBrowserModal: (open) => set({ envBrowserModalOpen: open }),
  setManualModal: (open) => set({ manualModalOpen: open }),

  // ── Tools & Layout ────────────────────────────────────────────
  setActiveTool: (tool) => set({ activeTool: tool }),
  toggleGridSnap: () => set((s) => ({ gridSnapEnabled: !s.gridSnapEnabled })),
  setPanelLayout: (layout) => {
    switch (layout) {
      case 'default':
        set({
          panelLayout: layout,
          panelVisibility: { ...DEFAULT_PANEL_VISIBILITY },
          leftPanelOpen: true,
          rightPanelOpen: true,
          bottomPanelOpen: true,
          focusMode: false,
        });
        break;
      case 'lighting':
        set({
          panelLayout: layout,
          panelVisibility: { ...DEFAULT_PANEL_VISIBILITY, bottomPanel: false, timelineSection: false, presetsSection: false },
          leftPanelOpen: true,
          rightPanelOpen: true,
          bottomPanelOpen: false,
          focusMode: false,
        });
        break;
      case 'fullPreview': {
        const vis = get().panelVisibility;
        set({
          panelLayout: layout,
          savedLayoutBeforeFocus: { panels: { ...vis }, rightTab: 'properties' },
          panelVisibility: {
            leftPanel: false,
            rightPanel: false,
            bottomPanel: false,
            timelineSection: false,
            presetsSection: false,
            materialPanel: false,
            historyPanel: false,
            viewportDesign: false,
          },
          leftPanelOpen: false,
          rightPanelOpen: false,
          bottomPanelOpen: false,
          focusMode: true,
        });
        break;
      }
      default:
        set({ panelLayout: layout });
    }
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

  // ── Frame ─────────────────────────────────────────────────────
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

  // ── Material preview ──────────────────────────────────────────
  setMaterialPreset: (preset) => set({ materialPreset: preset }),
  setPreviewBackground: (bg) => set({ previewBackground: bg }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
}));