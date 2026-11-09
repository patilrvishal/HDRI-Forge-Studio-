import { create } from 'zustand';
import type { RigSetKind } from '../data/rigSets';

const LS_KEY = 'lightforge.rigSetAuto.v1';
const readAuto = (): boolean => {
  try { return localStorage.getItem(LS_KEY) !== '0'; } catch { return true; }
};

/** A remembered edit of one part's material (keyed by the part's name), re-applied whenever the set is rebuilt. */
export interface MatOverride {
  color?: string;
  roughness?: number;
  metalness?: number;
  glowColor?: string;
  glow?: number;
}

interface RigSetState {
  overrides: Record<string, MatOverride>;
  /** Bumped by Reset materials so the set is rebuilt with its own colours. */
  rebuild: number;
  setOverride: (part: string, patch: MatOverride) => void;
  clearOverrides: () => void;
  /** The studio set currently in the scene (null = none). */
  kind: RigSetKind | null;
  /** Name of the applied rig: the group it makes in the scene hierarchy. */
  name: string;
  /** Ids of the lights the applied rig created (their fixtures are drawn; they are replaced by the next rig). */
  lightIds: string[];
  /** When on, applying a built-in rig also builds the matching studio set. */
  auto: boolean;
  setKind: (k: RigSetKind | null) => void;
  setRig: (k: RigSetKind, lightIds: string[], name: string) => void;
  setAuto: (v: boolean) => void;
}

export const useRigSetStore = create<RigSetState>((set) => ({
  overrides: {},
  rebuild: 0,
  setOverride: (part, patch) => set((s) => ({ overrides: { ...s.overrides, [part]: { ...(s.overrides[part] ?? {}), ...patch } } })),
  clearOverrides: () => set((s) => ({ overrides: {}, rebuild: s.rebuild + 1 })),
  kind: null,
  name: '',
  lightIds: [],
  auto: readAuto(),
  setKind: (kind) => set(kind ? { kind } : { kind: null, lightIds: [], name: '' }),
  setRig: (kind, lightIds, name) => set((s) => ({ kind, lightIds, name, overrides: s.name === name ? s.overrides : {} })),
  setAuto: (auto) => {
    try { localStorage.setItem(LS_KEY, auto ? '1' : '0'); } catch { /* ignore */ }
    set({ auto });
  },
}));
