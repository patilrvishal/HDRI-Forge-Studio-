import { create } from 'zustand';

interface UILayoutStore {
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;

  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  resetToDefaults: () => void;
}

const DEFAULTS = {
  leftPanelWidth: 220,
  rightPanelWidth: 320,
  bottomPanelHeight: 240,
};

export const useUILayoutStore = create<UILayoutStore>((set) => ({
  ...DEFAULTS,

  setLeftPanelWidth: (width) =>
    set({ leftPanelWidth: Math.max(150, Math.min(500, width)) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.max(200, Math.min(600, width)) }),
  setBottomPanelHeight: (height) =>
    set({ bottomPanelHeight: Math.max(120, Math.min(500, height)) }),
  resetToDefaults: () => set(DEFAULTS),
}));