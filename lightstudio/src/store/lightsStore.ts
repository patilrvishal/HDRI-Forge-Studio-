import { create } from 'zustand';
import type { Light } from '../types/Light';
import { createDefaultLight, LIGHT_TEMPLATES } from '../types/Light';
import { history } from './historyStore';

interface LightsState {
  lights: Light[];
  selectedLightId: string | null;
  collections: { id: string; name: string }[];
  collectionFilter: string | null; // null = "All Lights"

  addLight: (templateKey?: string) => void;
  removeLight: (id: string) => void;
  duplicateLight: (id: string) => void;
  updateLight: (id: string, updates: Partial<Light>) => void;
  updateLightTransform: (id: string, transformUpdates: Partial<Light['transform']>) => void;
  selectLight: (id: string | null) => void;
  toggleLightVisibility: (id: string) => void;
  toggleLightSolo: (id: string) => void;
  reorderLights: (startIndex: number, endIndex: number) => void;
  setCollectionFilter: (collectionId: string | null) => void;
  addCollection: (name: string) => void;
  removeCollection: (id: string) => void;
  setLightsFromPreset: (lights: Light[]) => void;
  clearAllLights: () => void;
}

export const useLightsStore = create<LightsState>((set, get) => ({
  lights: [],
  selectedLightId: null,
  collections: [
    { id: 'default', name: 'Default' },
    { id: 'key', name: 'Key Lights' },
    { id: 'fill', name: 'Fill Lights' },
    { id: 'rim', name: 'Rim Lights' },
  ],
  collectionFilter: null,

  addLight: (templateKey) => {
    history.record('Add Light');
    const template = templateKey && LIGHT_TEMPLATES[templateKey]
      ? LIGHT_TEMPLATES[templateKey]
      : {};
    const newLight = createDefaultLight(template);
    set((state) => ({
      lights: [...state.lights, newLight],
      selectedLightId: newLight.id,
    }));
  },

  removeLight: (id) => {
    history.record('Delete Light');
    set((state) => ({
      lights: state.lights.filter((l) => l.id !== id),
      selectedLightId: state.selectedLightId === id ? null : state.selectedLightId,
    }));
  },

  duplicateLight: (id) => {
    history.record('Duplicate Light');
    const state = get();
    const source = state.lights.find((l) => l.id === id);
    if (!source) return;
    const dup = createDefaultLight({
      ...JSON.parse(JSON.stringify(source)),
      id: undefined,
      name: `${source.name} (copy)`,
    });
    const idx = state.lights.findIndex((l) => l.id === id);
    const newLights = [...state.lights];
    newLights.splice(idx + 1, 0, dup);
    set({ lights: newLights, selectedLightId: dup.id });
  },

  updateLight: (id, updates) => {
    // Throttle for continuous slider drags
    history.recordThrottled('Update Light');
    set((state) => ({
      lights: state.lights.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    }));
  },

  updateLightTransform: (id, transformUpdates) => {
    // Throttle for continuous gizmo drags
    history.recordThrottled('Move Light');
    set((state) => ({
      lights: state.lights.map((l) =>
        l.id === id
          ? { ...l, transform: { ...l.transform, ...transformUpdates } }
          : l
      ),
    }));
  },

  selectLight: (id) => {
    // Selection changes are NOT recorded — they don't mutate scene data
    set({ selectedLightId: id });
  },

  toggleLightVisibility: (id) => {
    history.record('Toggle Visibility');
    set((state) => ({
      lights: state.lights.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
    }));
  },

  toggleLightSolo: (id) => {
    history.record('Toggle Solo');
    set((state) => {
      const light = state.lights.find((l) => l.id === id);
      if (!light) return state;
      const newSolo = !light.solo;
      return {
        lights: state.lights.map((l) =>
          l.id === id ? { ...l, solo: newSolo } : { ...l, solo: false }
        ),
      };
    });
  },

  reorderLights: (startIndex, endIndex) => {
    history.record('Reorder Lights');
    set((state) => {
      const newLights = [...state.lights];
      const [removed] = newLights.splice(startIndex, 1);
      newLights.splice(endIndex, 0, removed);
      return { lights: newLights };
    });
  },

  setCollectionFilter: (collectionId) => {
    // Filter changes are NOT recorded — they are UI-only
    set({ collectionFilter: collectionId });
  },

  addCollection: (name) => {
    history.record('Add Collection');
    const id = `col_${Date.now()}`;
    set((state) => ({
      collections: [...state.collections, { id, name }],
    }));
  },

  removeCollection: (id) => {
    history.record('Remove Collection');
    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
      collectionFilter: state.collectionFilter === id ? null : state.collectionFilter,
    }));
  },

  setLightsFromPreset: (lights) => {
    history.record('Apply Preset');
    set({ lights, selectedLightId: lights.length > 0 ? lights[0].id : null });
  },

  clearAllLights: () => {
    history.record('Clear All Lights');
    set({ lights: [], selectedLightId: null });
  },
}));