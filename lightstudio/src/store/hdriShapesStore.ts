import { create } from 'zustand';
import type { HDRIShape, HDRIShapeType } from '../types/HDRIShape';
import { createDefaultHDRIShape } from '../types/HDRIShape';

interface HDRIShapesStore {
  /** Stacking order = array order. Index 0 paints first (bottom), last index paints last (top). */
  shapes: HDRIShape[];
  selectedShapeId: string | null;
  /** Shared with the HDRI Preview panel and the live 3D viewport, so both
   *  react to the same on/off switch instead of the toggle being private
   *  React state that the viewport can never see. */
  livePreview: boolean;

  addShape: (type: HDRIShapeType) => HDRIShape;
  removeShape: (id: string) => void;
  selectShape: (id: string | null) => void;
  updateShape: (id: string, updates: Partial<Omit<HDRIShape, 'id'>>) => void;
  /** Move a shape's paint order up (later/top) or down (earlier/bottom) by one. */
  reorderShape: (id: string, direction: 'up' | 'down') => void;
  /** Reorder the whole shapes array to match the given id sequence - used to
   *  keep the unified cross-type layer list (Layers panel) and each store's
   *  own array order in sync after a drag that mixes shapes and lights.
   *  Ids that aren't shapes are ignored; any shape missing from `ids` keeps
   *  its relative position appended at the end. */
  setShapesOrder: (ids: string[]) => void;
  duplicateShape: (id: string) => void;
  clearShapes: () => void;
  setLivePreview: (on: boolean) => void;
}

export const useHDRIShapesStore = create<HDRIShapesStore>((set, get) => ({
  shapes: [],
  selectedShapeId: null,
  livePreview: false,

  addShape: (type) => {
    const shape = createDefaultHDRIShape(type, get().shapes.length);
    set((s) => ({ shapes: [...s.shapes, shape], selectedShapeId: shape.id }));
    return shape;
  },

  removeShape: (id) => {
    set((s) => ({
      shapes: s.shapes.filter((sh) => sh.id !== id),
      selectedShapeId: s.selectedShapeId === id ? null : s.selectedShapeId,
    }));
  },

  selectShape: (id) => set({ selectedShapeId: id }),

  updateShape: (id, updates) => {
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, ...updates } : sh)),
    }));
  },

  reorderShape: (id, direction) => {
    set((s) => {
      const idx = s.shapes.findIndex((sh) => sh.id === id);
      if (idx === -1) return s;
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= s.shapes.length) return s;
      const next = [...s.shapes];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return { shapes: next };
    });
  },

  setShapesOrder: (ids) => {
    set((s) => {
      const byId = new Map(s.shapes.map((sh) => [sh.id, sh]));
      const ordered: HDRIShape[] = [];
      for (const id of ids) {
        const sh = byId.get(id);
        if (sh) { ordered.push(sh); byId.delete(id); }
      }
      // Anything not mentioned (shouldn't normally happen) keeps its old
      // relative order, appended after the explicitly-ordered ones.
      for (const sh of s.shapes) {
        if (byId.has(sh.id)) ordered.push(sh);
      }
      return { shapes: ordered };
    });
  },

  duplicateShape: (id) => {
    set((s) => {
      const idx = s.shapes.findIndex((sh) => sh.id === id);
      if (idx === -1) return s;
      const original = s.shapes[idx];
      const copy: HDRIShape = {
        ...original,
        id: `hdrishape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: `${original.name} Copy`,
        u: Math.min(1, original.u + 0.04),
      };
      const next = [...s.shapes];
      next.splice(idx + 1, 0, copy);
      return { shapes: next, selectedShapeId: copy.id };
    });
  },

  clearShapes: () => set({ shapes: [], selectedShapeId: null }),

  setLivePreview: (on) => set({ livePreview: on }),
}));
