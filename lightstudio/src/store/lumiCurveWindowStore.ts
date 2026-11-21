import { create } from 'zustand';

/** Which light's Lumi-Curve is open in the floating Lumi-Curve Editor window (null = closed). */
interface LumiCurveWindowState {
  lightId: string | null;
  open: (lightId: string) => void;
  close: () => void;
}

export const useLumiCurveWindowStore = create<LumiCurveWindowState>((set) => ({
  lightId: null,
  open: (lightId) => set({ lightId }),
  close: () => set({ lightId: null }),
}));
