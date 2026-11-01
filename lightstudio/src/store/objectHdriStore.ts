import { create } from 'zustand';

/** How an object takes part in the exported / previewed HDRI. */
export interface ObjectHdriSettings {
  /** Included objects are painted into the HDRI (as seen from the capture point). */
  include: boolean;
  /** Multiplier on the surface colour (linear). 0 = pure blocker, 1 = as-is, >1 = bright card. */
  intensity: number;
  /** 'material' uses the object's own colour, 'custom' uses `color`. */
  colorMode: 'material' | 'custom';
  color: string;
  /** 0-100. 100 = opaque, lower lets the background show through. */
  opacity: number;
}

export const defaultObjectHdri = (): ObjectHdriSettings => ({
  include: true,
  intensity: 1,
  colorMode: 'material',
  color: '#ffffff',
  opacity: 100,
});

interface ObjectHdriState {
  /** Keyed by objectKey() so settings survive reloading a model. */
  settings: Record<string, ObjectHdriSettings>;
  /** Bumped on every change - HDRI previews watch this to refresh. */
  version: number;
  get: (key: string) => ObjectHdriSettings | null;
  set: (key: string, patch: Partial<ObjectHdriSettings>) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** Something in the scene the HDRI depends on moved (object transform etc.). */
  touch: () => void;
  exportSettings: () => Record<string, ObjectHdriSettings>;
  importSettings: (data: Record<string, ObjectHdriSettings> | undefined | null) => void;
}

export const useObjectHdriStore = create<ObjectHdriState>((set, get) => ({
  settings: {},
  version: 0,
  get: (key) => get().settings[key] ?? null,
  set: (key, patch) =>
    set((s) => ({
      settings: { ...s.settings, [key]: { ...(s.settings[key] ?? defaultObjectHdri()), ...patch } },
      version: s.version + 1,
    })),
  remove: (key) =>
    set((s) => {
      const next = { ...s.settings };
      delete next[key];
      return { settings: next, version: s.version + 1 };
    }),
  clear: () => set((s) => ({ settings: {}, version: s.version + 1 })),
  touch: () => set((s) => ({ version: s.version + 1 })),
  exportSettings: () => JSON.parse(JSON.stringify(get().settings)),
  importSettings: (data) => set((s) => ({ settings: data ? JSON.parse(JSON.stringify(data)) : {}, version: s.version + 1 })),
}));
