import { create } from 'zustand';

/**
 * Which scene file is open, and the list behind File > Open Recent.
 *
 * Only paths and names are kept (never scene data). The list survives restarts through localStorage; if storage is
 * unavailable it simply starts empty each session.
 */

const STORAGE_KEY = 'lightforge.recentScenes';
const MAX_RECENT = 10;
const DEFAULT_TITLE = 'HDRI Forge Studio — 3D Lighting Studio';

export interface RecentScene {
  path: string;
  name: string;
  openedAt: number;
}

export const baseName = (path: string): string => path.split(/[\\/]/).pop() || path;

export const dirName = (path: string): string => {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('\\');
};

/** Windows paths are case-insensitive */
const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function load(): RecentScene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is RecentScene => !!r && typeof r.path === 'string' && typeof r.name === 'string')
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function persist(list: RecentScene[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable or full - the list just will not survive a restart */
  }
}

interface SceneFileState {
  /** Full path of the file this scene was last saved to or opened from; null for a new, never-saved scene. */
  currentPath: string | null;
  recent: RecentScene[];
  setCurrent: (path: string | null) => void;
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecent: () => void;
}

export const useSceneFileStore = create<SceneFileState>((set, get) => ({
  currentPath: null,
  recent: load(),

  setCurrent: (path) => {
    set({ currentPath: path });
    // The window title shows which file is open
    if (typeof document !== 'undefined') {
      document.title = path ? `${baseName(path)} — HDRI Forge Studio` : DEFAULT_TITLE;
    }
  },

  addRecent: (path) => {
    const entry: RecentScene = { path, name: baseName(path), openedAt: Date.now() };
    const next = [entry, ...get().recent.filter((r) => !samePath(r.path, path))].slice(0, MAX_RECENT);
    persist(next);
    set({ recent: next });
  },

  removeRecent: (path) => {
    const next = get().recent.filter((r) => !samePath(r.path, path));
    persist(next);
    set({ recent: next });
  },

  clearRecent: () => {
    persist([]);
    set({ recent: [] });
  },
}));
