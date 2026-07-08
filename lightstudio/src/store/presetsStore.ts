import { create } from 'zustand';
import type { Preset, PresetLight } from '../types/Preset';
import type { Light } from '../types/Light';
import { createDefaultLight } from '../types/Light';
import { presetDB } from '../services/PresetDB';

// Built-in light presets
const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'builtin_3point',
    name: '3-Point Lighting',
    category: 'studio',
    thumbnail: '',
    createdAt: 0,
    isDefault: true,
    lights: [
      {
        name: 'Key Light',
        type: 'spot',
        color: '#fff5e6',
        brightness: 300,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: 45, lng: 45, radius: 6, height: 4 },
          position: { x: 4.24, y: 4, z: 4.24 },
          rotation: { x: -45, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Fill Light',
        type: 'area',
        color: '#c8d8ff',
        brightness: 100,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: true,
        falloff: 'linear',
        transform: {
          spherical: { lat: 30, lng: -90, radius: 5, height: 2 },
          position: { x: -5, y: 2, z: 0 },
          rotation: { x: 0, y: 90, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Rim Light',
        type: 'rim',
        color: '#4a9eff',
        brightness: 180,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: 10, lng: 180, radius: 6, height: 2 },
          position: { x: -6, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0, mode: 'euler', enabled: false, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
    ] as PresetLight[],
  },
  {
    id: 'builtin_studio',
    name: 'Studio Classic',
    category: 'studio',
    thumbnail: '',
    createdAt: 0,
    isDefault: true,
    lights: [
      {
        name: 'Overhead Key',
        type: 'overhead',
        color: '#ffffff',
        brightness: 250,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: true,
        falloff: 'linear',
        transform: {
          spherical: { lat: 90, lng: 0, radius: 4, height: 5 },
          position: { x: 0, y: 5, z: 0 },
          rotation: { x: -90, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Left Fill',
        type: 'area',
        color: '#ffe4b5',
        brightness: 120,
        opacity: 100,
        colorProfile: 'tungsten',
        areaLight: true,
        falloff: 'linear',
        transform: {
          spherical: { lat: 20, lng: 210, radius: 5, height: 2 },
          position: { x: -4.33, y: 2, z: -2.5 },
          rotation: { x: 0, y: 30, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Right Fill',
        type: 'area',
        color: '#b5d0ff',
        brightness: 80,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: true,
        falloff: 'linear',
        transform: {
          spherical: { lat: 20, lng: 330, radius: 5, height: 2 },
          position: { x: 4.33, y: 2, z: -2.5 },
          rotation: { x: 0, y: -30, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Back Rim',
        type: 'rim',
        color: '#aaccff',
        brightness: 150,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: 15, lng: 180, radius: 7, height: 3 },
          position: { x: -7, y: 3, z: 0 },
          rotation: { x: 0, y: 0, z: 0, mode: 'euler', enabled: false, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Under Glow',
        type: 'underlight',
        color: '#4a9eff',
        brightness: 60,
        opacity: 100,
        colorProfile: 'custom',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: -90, lng: 0, radius: 3, height: -0.5 },
          position: { x: 0, y: -0.5, z: 0 },
          rotation: { x: 90, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
    ] as PresetLight[],
  },
  {
    id: 'builtin_outdoor',
    name: 'Outdoor Sun',
    category: 'outdoor',
    thumbnail: '',
    createdAt: 0,
    isDefault: true,
    lights: [
      {
        name: 'Sun',
        type: 'directional',
        color: '#fff8e7',
        brightness: 400,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: false,
        falloff: 'none',
        transform: {
          spherical: { lat: 65, lng: 135, radius: 20, height: 10 },
          position: { x: -11.5, y: 10, z: 11.5 },
          rotation: { x: -25, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Sky Fill',
        type: 'area',
        color: '#b8d4ff',
        brightness: 80,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: true,
        falloff: 'linear',
        transform: {
          spherical: { lat: 40, lng: 270, radius: 10, height: 6 },
          position: { x: -10, y: 6, z: 0 },
          rotation: { x: 0, y: 90, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Ground Bounce',
        type: 'point',
        color: '#c8b898',
        brightness: 50,
        opacity: 100,
        colorProfile: 'custom',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: -30, lng: 0, radius: 5, height: -1 },
          position: { x: 0, y: -1, z: 0 },
          rotation: { x: 0, y: 0, z: 0, mode: 'euler', enabled: false, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
    ] as PresetLight[],
  },
  {
    id: 'builtin_sidelight',
    name: 'Dramatic Sidelight',
    category: 'sidelights',
    thumbnail: '',
    createdAt: 0,
    isDefault: true,
    lights: [
      {
        name: 'Key Sidelight',
        type: 'spot',
        color: '#ffe0b0',
        brightness: 350,
        opacity: 100,
        colorProfile: 'tungsten',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: 35, lng: 90, radius: 5, height: 3 },
          position: { x: 0, y: 3, z: 5 },
          rotation: { x: -35, y: 0, z: 0, mode: 'euler', enabled: true, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
      {
        name: 'Cool Fill',
        type: 'point',
        color: '#a0b8e0',
        brightness: 40,
        opacity: 100,
        colorProfile: 'daylight',
        areaLight: false,
        falloff: 'quadratic',
        transform: {
          spherical: { lat: 20, lng: 270, radius: 6, height: 2 },
          position: { x: -6, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0, mode: 'euler', enabled: false, repeat: false, advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 } },
          maisleU: 0,
          mendieV: 0,
          smartGolly: 0,
          dailyMultiplier: 1,
        },
      },
    ] as PresetLight[],
  },
];

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

interface PresetsState {
  presets: Preset[];
  activeCategory: 'sidelights' | 'studio' | 'outdoor' | 'custom';
  searchQuery: string;
  previewingId: string | null;
  dbLoaded: boolean;

  // Navigation
  setActiveCategory: (cat: PresetsState['activeCategory']) => void;
  setSearchQuery: (q: string) => void;
  setPreviewPreset: (id: string | null) => void;

  // CRUD
  addPreset: (preset: Preset) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, updates: Partial<Preset>) => void;
  importPresets: (presets: Preset[]) => void;

  // Preset application
  lightsToPresetLights: (lights: Light[]) => PresetLight[];

  // IndexedDB
  loadFromDB: () => Promise<void>;
  savePresetToDB: (preset: Preset) => Promise<void>;
  deletePresetFromDB: (id: string) => Promise<void>;
  saveCurrentAsPreset: (lights: Light[], thumbnail: string) => Promise<Preset>;
  exportPresets: () => void;
  importPresetsFromFile: (file: File) => Promise<number>;
}

export const usePresetsStore = create<PresetsState>((set, get) => ({
  presets: [...BUILTIN_PRESETS],
  activeCategory: 'studio',
  searchQuery: '',
  previewingId: null,
  dbLoaded: false,

  setActiveCategory: (cat) => set({ activeCategory: cat, previewingId: null }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setPreviewPreset: (id) => set({ previewingId: id }),

  addPreset: (preset) => {
    set((state) => ({ presets: [...state.presets, preset] }));
  },

  removePreset: (id) => {
    set((state) => ({
      presets: state.presets.filter((p) => p.id !== id),
      previewingId: state.previewingId === id ? null : state.previewingId,
    }));
  },

  updatePreset: (id, updates) => {
    set((state) => ({
      presets: state.presets.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },

  importPresets: (newPresets) => {
    set((state) => ({
      presets: [
        ...state.presets.filter(
          (existing) => !newPresets.some((np) => np.id === existing.id),
        ),
        ...newPresets,
      ],
    }));
  },

  lightsToPresetLights: (lights) => {
    return lights.map((l) => ({
      name: l.name,
      type: l.type,
      color: l.color,
      brightness: l.brightness,
      opacity: l.opacity,
      colorProfile: l.colorProfile,
      areaLight: l.areaLight,
      falloff: l.falloff,
      transform: JSON.parse(JSON.stringify(l.transform)),
    }));
  },

  /** Load custom presets from IndexedDB and merge with builtins. */
  loadFromDB: async () => {
    try {
      const customPresets = await presetDB.getAll();
      if (customPresets.length > 0) {
        set((state) => ({
          presets: [
            ...state.presets.filter((p) => p.isDefault),
            ...customPresets,
          ],
          dbLoaded: true,
        }));
      } else {
        set({ dbLoaded: true });
      }
    } catch {
      set({ dbLoaded: true });
    }
  },

  /** Persist a single preset to IndexedDB (for custom presets). */
  savePresetToDB: async (preset) => {
    await presetDB.put(preset);
  },

  /** Remove a preset from IndexedDB. */
  deletePresetFromDB: async (id) => {
    await presetDB.del(id);
    get().removePreset(id);
  },

  /** Save the current light configuration as a new custom preset. */
  saveCurrentAsPreset: async (lights, thumbnail) => {
    const { presets } = get();
    const customCount = presets.filter((p) => p.category === 'custom').length;
    const presetLights = get().lightsToPresetLights(lights);

    const preset: Preset = {
      id: `custom_${generateId()}`,
      name: `Custom ${customCount + 1}`,
      category: 'custom',
      thumbnail,
      lights: presetLights,
      createdAt: Date.now(),
      isDefault: false,
    };

    set((state) => ({
      presets: [...state.presets, preset],
    }));

    await presetDB.put(preset);
    return preset;
  },

  /** Export all non-default presets as a JSON file download. */
  exportPresets: () => {
    const { presets } = get();
    const exportable = presets.filter((p) => !p.isDefault);
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      presets: exportable.map(({ id, name, category, thumbnail, lights }) => ({
        id,
        name,
        category,
        thumbnail,
        lights,
      })),
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'lightstudio_presets.json';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  },

  /** Import presets from a JSON file. */
  importPresetsFromFile: async (file) => {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.presets || !Array.isArray(data.presets)) {
      throw new Error('Invalid preset file format');
    }

    const imported: Preset[] = data.presets
      .filter((p: Record<string, unknown>) => p.name && p.lights)
      .map((p: Record<string, unknown>) => ({
        id: (p.id as string) || `imp_${generateId()}`,
        name: p.name as string,
        category: (p.category as Preset['category']) || 'custom',
        thumbnail: (p.thumbnail as string) || '',
        lights: p.lights as PresetLight[],
        createdAt: (p.createdAt as number) || Date.now(),
        isDefault: false,
      }));

    // Persist to IndexedDB
    for (const preset of imported) {
      await presetDB.put(preset);
    }

    // Reload from DB to get a clean merge
    await get().loadFromDB();
    return imported.length;
  },
}));