import { create } from 'zustand';
import type { Preset, PresetLight } from '../types/Preset';
import type { Light } from '../types/Light';
import { createDefaultLight } from '../types/Light';
import { presetDB } from '../services/PresetDB';
import {
  STUDIO_PRESETS, STUDIO_META,
  OUTDOOR_PRESETS, OUTDOOR_META,
  SPOTLIGHT_PRESETS, SPOTLIGHT_META,
  SIDELIGHT_PRESETS, SIDELIGHT_META,
  LIGHT_PROFILE_PRESETS, LIGHT_PROFILE_META,
} from '../data/presets';
import { generatePresetThumbnail } from '../types/Preset';

// ── Build built-in presets from data ────────────────────────────────

function buildBuiltins(): Preset[] {
  const out: Preset[] = [];

  const push = (
    id: string, name: string, category: Preset['category'],
    description: string, tags: string[], lights: PresetLight[],
  ) => {
    out.push({
      id,
      name,
      category,
      description,
      thumbnail: generatePresetThumbnail(lights),
      tags,
      lights,
      createdAt: 0,
      isDefault: true,
    });
  };

  // Studio (6)
  STUDIO_META.forEach((m, i) => push(m.id, m.name, 'studio', m.description, m.tags, STUDIO_PRESETS[i]));
  // Outdoor (5)
  OUTDOOR_META.forEach((m, i) => push(m.id, m.name, 'outdoor', m.description, m.tags, OUTDOOR_PRESETS[i]));
  // Spotlight (6)
  SPOTLIGHT_META.forEach((m, i) => push(m.id, m.name, 'spotlight', m.description, m.tags, SPOTLIGHT_PRESETS[i]));
  // Sidelights (1 legacy)
  SIDELIGHT_META.forEach((m, i) => push(m.id, m.name, 'sidelights', m.description, m.tags, SIDELIGHT_PRESETS[i]));
  // Light Profiles (14) - single functional modifier presets
  LIGHT_PROFILE_META.forEach((m, i) => push(m.id, m.name, 'lightprofiles', m.description, m.tags, LIGHT_PROFILE_PRESETS[i]));

  return out;
}

const BUILTIN_PRESETS: Preset[] = buildBuiltins();

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

type PresetCategory = 'sidelights' | 'studio' | 'outdoor' | 'spotlight' | 'lightprofiles' | 'custom';

interface PresetsState {
  presets: Preset[];
  activeCategory: PresetCategory;
  searchQuery: string;
  previewingId: string | null;
  dbLoaded: boolean;

  // Navigation
  setActiveCategory: (cat: PresetCategory) => void;
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
      description: '',
      thumbnail,
      tags: [],
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
      presets: exportable.map(({ id, name, category, description, thumbnail, tags, lights }) => ({
        id,
        name,
        category,
        description,
        thumbnail,
        tags,
        lights,
      })),
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'lightforge_presets.json';
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
        description: (p.description as string) || '',
        thumbnail: (p.thumbnail as string) || '',
        tags: (p.tags as string[]) || [],
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