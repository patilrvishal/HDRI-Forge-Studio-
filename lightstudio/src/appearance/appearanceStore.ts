import { create } from 'zustand';
import type { AppearanceImage, LightAppearance } from './types';
import { cloneAppearance, referencedImageIds } from './content';
import type { PresetCategory } from './presets';
import { deserializeImage, serializeImage, type SerializedImage } from './imageImport';

export interface UserPreset {
  id: string;
  name: string;
  category: PresetCategory | 'User';
  aspect: number;
  appearance: LightAppearance;
}

const LS_KEY = 'lightforge.appearancePresets.v1';

function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistUserPresets(p: UserPreset[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable or full - presets stay in memory for this session */
  }
}

interface AppearanceState {
  /** Decoded images used by Image / Sky content (session + project). */
  images: Record<string, AppearanceImage>;
  /** Bumped whenever an image is added/removed so texture caches refresh. */
  imagesVersion: number;
  userPresets: UserPreset[];
  /** Temporary hover-audition of a preset on a light (not saved, not in undo history). */
  audition: { lightId: string; appearance: LightAppearance } | null;
  setAudition: (a: { lightId: string; appearance: LightAppearance } | null) => void;
  addImage: (img: AppearanceImage) => void;
  removeImage: (id: string) => void;
  saveUserPreset: (name: string, appearance: LightAppearance, aspect: number) => UserPreset;
  deleteUserPreset: (id: string) => void;
  renameUserPreset: (id: string, name: string) => void;
  /** Images referenced by the given appearances, ready for a project file. */
  exportImages: (appearances: (LightAppearance | undefined)[]) => SerializedImage[];
  importImages: (imgs: SerializedImage[] | undefined | null) => void;
  clearImages: () => void;
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  images: {},
  imagesVersion: 0,
  userPresets: loadUserPresets(),
  audition: null,
  setAudition: (audition) => set({ audition }),
  addImage: (img) => set((s) => ({ images: { ...s.images, [img.id]: img }, imagesVersion: s.imagesVersion + 1 })),
  removeImage: (id) =>
    set((s) => {
      const next = { ...s.images };
      delete next[id];
      return { images: next, imagesVersion: s.imagesVersion + 1 };
    }),
  saveUserPreset: (name, appearance, aspect) => {
    const preset: UserPreset = {
      id: 'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      category: 'User',
      aspect,
      appearance: cloneAppearance({ ...appearance, name }),
    };
    const next = [...get().userPresets, preset];
    persistUserPresets(next);
    set({ userPresets: next });
    return preset;
  },
  deleteUserPreset: (id) => {
    const next = get().userPresets.filter((p) => p.id !== id);
    persistUserPresets(next);
    set({ userPresets: next });
  },
  renameUserPreset: (id, name) => {
    const next = get().userPresets.map((p) => (p.id === id ? { ...p, name } : p));
    persistUserPresets(next);
    set({ userPresets: next });
  },
  exportImages: (appearances) => {
    const ids = new Set<string>();
    for (const a of appearances) if (a) referencedImageIds(a).forEach((i) => ids.add(i));
    const imgs = get().images;
    return [...ids].filter((i) => imgs[i]).map((i) => serializeImage(imgs[i]));
  },
  importImages: (list) => {
    if (!list?.length) return;
    const next = { ...get().images };
    for (const s of list) {
      try {
        next[s.id] = deserializeImage(s);
      } catch (e) {
        console.warn('[appearance] failed to restore image', s.name, e);
      }
    }
    set((st) => ({ images: next, imagesVersion: st.imagesVersion + 1 }));
  },
  clearImages: () => set((s) => ({ images: {}, imagesVersion: s.imagesVersion + 1 })),
}));

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __appearanceStore?: unknown }).__appearanceStore = useAppearanceStore;
}
