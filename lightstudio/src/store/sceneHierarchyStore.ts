import { create } from 'zustand';

export type HierarchyFilterType = 'all' | 'mesh' | 'light' | 'camera' | 'group';

interface SceneHierarchyState {
  /** Currently selected object UUID */
  selectedId: string | null;
  /** UUID of the isolated object (only it and children visible), null = no isolation */
  isolatedId: string | null;
  /** Set of UUIDs that are manually hidden */
  hiddenIds: string[];
  /** Set of UUIDs that are expanded in the tree */
  expandedIds: string[];
  /** Type filter for the tree */
  filterType: HierarchyFilterType;
  /** Search query */
  searchQuery: string;

  // ── Actions ────────────────────────────────────────────────────
  select: (id: string | null) => void;
  toggleVisibility: (id: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  isolate: (id: string | null) => void;
  showAll: () => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  expandAll: (ids: string[]) => void;
  collapseAll: () => void;
  setFilterType: (t: HierarchyFilterType) => void;
  setSearchQuery: (q: string) => void;
  isHidden: (id: string) => boolean;
  clearAll: () => void;
}

export const useSceneHierarchyStore = create<SceneHierarchyState>((set, get) => ({
  selectedId: null,
  isolatedId: null,
  hiddenIds: [],
  expandedIds: [],
  filterType: 'all',
  searchQuery: '',

  select: (id) => set({ selectedId: id }),

  toggleVisibility: (id) => {
    const hidden = get().hiddenIds;
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    set({ hiddenIds: next });
  },

  setHidden: (id, hidden) => {
    const hiddenIds = get().hiddenIds;
    if (hidden && !hiddenIds.includes(id)) {
      set({ hiddenIds: [...hiddenIds, id] });
    } else if (!hidden) {
      set({ hiddenIds: hiddenIds.filter((x) => x !== id) });
    }
  },

  isolate: (id) => {
    set({ isolatedId: id, hiddenIds: [] });
  },

  showAll: () => set({ hiddenIds: [], isolatedId: null }),

  toggleExpanded: (id) => {
    const expanded = get().expandedIds;
    const next = expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id];
    set({ expandedIds: next });
  },

  setExpanded: (id, expanded) => {
    const list = get().expandedIds;
    if (expanded && !list.includes(id)) {
      set({ expandedIds: [...list, id] });
    } else if (!expanded) {
      set({ expandedIds: list.filter((x) => x !== id) });
    }
  },

  expandAll: (ids) => set({ expandedIds: ids }),

  collapseAll: () => set({ expandedIds: [] }),

  setFilterType: (t) => set({ filterType: t }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  isHidden: (id) => get().hiddenIds.includes(id),

  clearAll: () => set({
    selectedId: null,
    isolatedId: null,
    hiddenIds: [],
    expandedIds: [],
    searchQuery: '',
    filterType: 'all',
  }),
}));