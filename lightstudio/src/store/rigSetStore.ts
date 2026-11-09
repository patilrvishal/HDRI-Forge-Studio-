import { create } from 'zustand';
import type { RigSetKind } from '../data/rigSets';

const LS_KEY = 'lightforge.rigSetAuto.v1';
const readAuto = (): boolean => {
  try { return localStorage.getItem(LS_KEY) !== '0'; } catch { return true; }
};

interface RigSetState {
  /** The studio set currently in the scene (null = none). */
  kind: RigSetKind | null;
  /** When on, applying a built-in rig also builds the matching studio set. */
  auto: boolean;
  setKind: (k: RigSetKind | null) => void;
  setAuto: (v: boolean) => void;
}

export const useRigSetStore = create<RigSetState>((set) => ({
  kind: null,
  auto: readAuto(),
  setKind: (kind) => set({ kind }),
  setAuto: (auto) => {
    try { localStorage.setItem(LS_KEY, auto ? '1' : '0'); } catch { /* ignore */ }
    set({ auto });
  },
}));
