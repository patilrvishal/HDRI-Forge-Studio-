import { create } from 'zustand';
import type { HDRIShape, HDRIShapeGroup, HDRIShapeType } from '../types/HDRIShape';
import { createDefaultHDRIShape, createDefaultHDRIShapeGroup } from '../types/HDRIShape';

interface HDRIShapesStore {
  /** Stacking order = array order. Index 0 paints first (bottom), last index paints last (top). */
  shapes: HDRIShape[];
  /** HDR Light Studio's "Composite Lights" - see the groupId note on
   *  HDRIShape. Order doesn't matter here, only shapes[].groupId does. */
  groups: HDRIShapeGroup[];
  selectedShapeId: string | null;
  /** Shared with the HDRI Preview panel and the live 3D viewport, so both
   *  react to the same on/off switch instead of the toggle being private
   *  React state that the viewport can never see. */
  livePreview: boolean;
  /** Bumped to trigger a single one-off HDRI Preview render regardless of
   *  the livePreview toggle - e.g. right after a bridge push from Blender/
   *  Maya, where continuous auto-render would be overkill but the user very
   *  much wants to see the result without hunting for the Refresh button. */
  previewRefreshRequestId: number;

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
  /** Replace the whole shape stack in one go, with fresh ids so restoring
   *  the same Look twice never collides with whatever's already on screen -
   *  used by looksStore when applying a saved Look. */
  setShapesFromLook: (shapes: HDRIShape[]) => void;
  setLivePreview: (on: boolean) => void;
  requestPreviewRefresh: () => void;

  /** Create a new group containing just this one shape and return its id -
   *  the starting point for building a composite, since there's no
   *  multi-select yet: add more members afterward via setShapeGroup. */
  createGroup: (shapeId: string, name?: string) => string;
  /** Add a shape to an existing group, or pass null to remove it from
   *  whichever group it's currently in. */
  setShapeGroup: (shapeId: string, groupId: string | null) => void;
  renameGroup: (id: string, name: string) => void;
  /** Ungroups every member (they keep their current position/visibility/
   *  lock state, just lose the shared-group behavior) and removes the group. */
  deleteGroup: (id: string) => void;
  /** Toggles every member's visibility together - reads the current
   *  majority state among members and flips all of them to the opposite,
   *  so one click always produces one consistent all-on or all-off result. */
  toggleGroupVisible: (id: string) => void;
  toggleGroupLocked: (id: string) => void;
  /** Move a shape to (newU, newV) and carry every OTHER member of its group
   *  along by the same delta, skipping any member that's individually
   *  locked. This is what every shape-drag interaction should call instead
   *  of updateShape directly, so dragging a grouped shape moves the whole
   *  composite - ungrouped shapes fall through to a plain single-shape move. */
  moveShapeAndGroup: (shapeId: string, newU: number, newV: number) => void;
}

export const useHDRIShapesStore = create<HDRIShapesStore>((set, get) => ({
  shapes: [],
  groups: [],
  selectedShapeId: null,
  livePreview: false,
  previewRefreshRequestId: 0,

  addShape: (type) => {
    const shape = createDefaultHDRIShape(type, get().shapes.length);
    set((s) => ({ shapes: [...s.shapes, shape], selectedShapeId: shape.id }));
    return shape;
  },

  removeShape: (id) => {
    set((s) => {
      const removed = s.shapes.find((sh) => sh.id === id);
      const shapes = s.shapes.filter((sh) => sh.id !== id);
      // If that was the last member of its group, the group is now empty -
      // drop it rather than leave a nameless orphan in the group list.
      const groups = removed?.groupId && !shapes.some((sh) => sh.groupId === removed.groupId)
        ? s.groups.filter((g) => g.id !== removed.groupId)
        : s.groups;
      return {
        shapes,
        groups,
        selectedShapeId: s.selectedShapeId === id ? null : s.selectedShapeId,
      };
    });
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

  setShapesFromLook: (shapes) => {
    // A Look doesn't capture the groups array (see types/Look.ts) - strip
    // groupId too, rather than leave members pointing at a group id that
    // no longer resolves to anything in the (now-cleared) groups list.
    const fresh = shapes.map((sh) => {
      const { groupId: _groupId, ...rest } = sh;
      return {
        ...rest,
        id: `hdrishape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      };
    });
    set({ shapes: fresh, groups: [], selectedShapeId: null });
  },

  setLivePreview: (on) => set({ livePreview: on }),

  requestPreviewRefresh: () => set((s) => ({ previewRefreshRequestId: s.previewRefreshRequestId + 1 })),

  createGroup: (shapeId, name) => {
    const group = createDefaultHDRIShapeGroup(name ?? `Group ${get().groups.length + 1}`);
    set((s) => ({
      groups: [...s.groups, group],
      shapes: s.shapes.map((sh) => (sh.id === shapeId ? { ...sh, groupId: group.id } : sh)),
    }));
    return group.id;
  },

  setShapeGroup: (shapeId, groupId) => {
    set((s) => ({
      shapes: s.shapes.map((sh) => {
        if (sh.id !== shapeId) return sh;
        if (groupId === null) {
          const { groupId: _drop, ...rest } = sh;
          return rest as HDRIShape;
        }
        return { ...sh, groupId };
      }),
    }));
    // Clean up a group left with zero members after this reassignment.
    set((s) => ({
      groups: s.groups.filter((g) => s.shapes.some((sh) => sh.groupId === g.id)),
    }));
  },

  renameGroup: (id, name) => {
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)) }));
  },

  deleteGroup: (id) => {
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      shapes: s.shapes.map((sh) => {
        if (sh.groupId !== id) return sh;
        const { groupId: _drop, ...rest } = sh;
        return rest as HDRIShape;
      }),
    }));
  },

  toggleGroupVisible: (id) => {
    set((s) => {
      const members = s.shapes.filter((sh) => sh.groupId === id);
      const visibleCount = members.filter((sh) => sh.visible).length;
      const nextVisible = visibleCount < members.length; // majority-off -> turn all on, else all off
      return {
        shapes: s.shapes.map((sh) => (sh.groupId === id ? { ...sh, visible: nextVisible } : sh)),
      };
    });
  },

  toggleGroupLocked: (id) => {
    set((s) => {
      const members = s.shapes.filter((sh) => sh.groupId === id);
      const lockedCount = members.filter((sh) => sh.locked).length;
      const nextLocked = lockedCount < members.length;
      return {
        shapes: s.shapes.map((sh) => (sh.groupId === id ? { ...sh, locked: nextLocked } : sh)),
      };
    });
  },

  moveShapeAndGroup: (shapeId, newU, newV) => {
    set((s) => {
      const target = s.shapes.find((sh) => sh.id === shapeId);
      if (!target || target.locked) return s;
      const du = newU - target.u;
      const dv = newV - target.v;
      if (!target.groupId) {
        return { shapes: s.shapes.map((sh) => (sh.id === shapeId ? { ...sh, u: newU, v: newV } : sh)) };
      }
      return {
        shapes: s.shapes.map((sh) => {
          if (sh.locked) return sh;
          if (sh.id === shapeId) return { ...sh, u: newU, v: newV };
          if (sh.groupId === target.groupId) {
            return { ...sh, u: Math.min(1, Math.max(0, sh.u + du)), v: Math.min(1, Math.max(0, sh.v + dv)) };
          }
          return sh;
        }),
      };
    });
  },
}));
