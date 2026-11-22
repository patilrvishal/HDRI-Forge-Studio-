import { create } from 'zustand';

/** Ready-made override looks, like Blender's Material Override: a clean way to judge reflections and form without the car's own materials. */
export type OverridePreset = 'chrome' | 'mirror-black' | 'gloss-white' | 'clay' | 'custom';

export const OVERRIDE_PRESETS: Record<Exclude<OverridePreset, 'custom'>, { label: string; color: string; metalness: number; roughness: number; clearcoat: number }> = {
  chrome: { label: 'Chrome', color: '#ffffff', metalness: 1, roughness: 0, clearcoat: 0 },
  'mirror-black': { label: 'Black Gloss', color: '#050505', metalness: 0, roughness: 0.05, clearcoat: 1 },
  'gloss-white': { label: 'White Gloss', color: '#f2f2f2', metalness: 0, roughness: 0.08, clearcoat: 1 },
  clay: { label: 'Clay', color: '#b8b8b8', metalness: 0, roughness: 0.85, clearcoat: 0 },
};

export interface MaterialOverrideState {
  /** On: every targeted mesh shows the override. Off: the original material slots come straight back. */
  enabled: boolean;
  /** 'all' = every mesh of the model; 'selected' = only the meshes inside the object selected in the Scene panel. */
  scope: 'all' | 'selected';
  preset: OverridePreset;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  set: (patch: Partial<Omit<MaterialOverrideState, 'set' | 'setPreset' | 'reset'>>) => void;
  setPreset: (p: OverridePreset) => void;
  reset: () => void;
}

const DEFAULTS = { enabled: false, scope: 'all' as const, preset: 'chrome' as OverridePreset, ...OVERRIDE_PRESETS.chrome };

export const useMaterialOverrideStore = create<MaterialOverrideState>((set) => ({
  ...DEFAULTS,
  set: (patch) => set(patch),
  setPreset: (p) => set(p === 'custom' ? { preset: p } : { preset: p, color: OVERRIDE_PRESETS[p].color, metalness: OVERRIDE_PRESETS[p].metalness, roughness: OVERRIDE_PRESETS[p].roughness, clearcoat: OVERRIDE_PRESETS[p].clearcoat }),
  reset: () => set({ ...DEFAULTS }),
}));
