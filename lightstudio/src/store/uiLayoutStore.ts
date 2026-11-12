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
  leftPanelWidth: 340,
  rightPanelWidth: 380,
  bottomPanelHeight: 380,
};

export const useUILayoutStore = create<UILayoutStore>((set) => ({
  ...DEFAULTS,

  setLeftPanelWidth: (width) =>
    set({ leftPanelWidth: Math.max(260, Math.min(600, width)) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.max(200, Math.min(600, width)) }),
  setBottomPanelHeight: (height) =>
    set({ bottomPanelHeight: Math.max(120, Math.min(700, height)) }),
  resetToDefaults: () => set(DEFAULTS),
}));