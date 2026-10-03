import { create } from 'zustand';

export type Gain = [number, number, number];

interface MatchGainState {
  /** Linear per-channel multiplier Erik asked for ("Match reference photo"). [1,1,1] = off. */
  gain: Gain;
  /** Last request id received from Erik; echoed in every push so Erik knows which gain a map includes. */
  seq: number;
  set: (gain: Gain, seq: number) => void;
  reset: () => void;
}

const clamp = (v: number) => (Number.isFinite(v) ? Math.min(100, Math.max(0.01, v)) : 1);

export const useMatchGainStore = create<MatchGainState>((set) => ({
  gain: [1, 1, 1],
  seq: 0,
  set: (g, seq) => set({ gain: [clamp(g[0]), clamp(g[1]), clamp(g[2])], seq }),
  reset: () => set((s) => ({ gain: [1, 1, 1], seq: s.seq + 1 })),
}));

export const getMatchGain = (): Gain => useMatchGainStore.getState().gain;
export const isMatchActive = (g: Gain = getMatchGain()) =>
  Math.abs(g[0] - 1) > 1e-3 || Math.abs(g[1] - 1) > 1e-3 || Math.abs(g[2] - 1) > 1e-3;
