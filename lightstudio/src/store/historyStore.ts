/**
 * Undo/Redo History Store (Phase 7)
 *
 * Snapshot-based history using a finite-depth undo/redo stack.
 * Supports:
 *   - Labeled snapshots (e.g. "Add Light", "Change Exposure")
 *   - Grouping: multiple mutations batch into a single undo step
 *   - Throttled snapshots: slider drags only record once per interval
 *   - Max depth limit (default 50) to cap memory usage
 *   - Pause/resume: temporarily disable recording (e.g. during scene import)
 */

import { create } from 'zustand';
import { captureSnapshot, restoreSnapshot } from '../utils/undoSnapshot';
import type { UndoSnapshot } from '../utils/undoSnapshot';

// ── Types ──────────────────────────────────────────────────────────────────

interface HistoryEntry {
  snapshot: UndoSnapshot;
  /** The label of the *next* action that caused this snapshot to be saved.
   *  When we undo, we show this label as "Undo {label}". */
  label: string;
}

interface HistoryState {
  /** Stack of past states (newest at the end). */
  undoStack: HistoryEntry[];
  /** Stack of states that were undone (newest at the end). */
  redoStack: HistoryEntry[];

  /** Whether recording is currently paused (during imports, bulk operations). */
  paused: boolean;

  /** Whether we're currently inside a group (batch). */
  _groupActive: boolean;
  /** The snapshot captured at the start of a group. */
  _groupSnapshot: UndoSnapshot | null;
  /** The label for the group. */
  _groupLabel: string;

  // ── Public actions ────────────────────────────────────────────────────
  undo: () => string | null;
  redo: () => string | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoLabel: () => string | null;
  getRedoLabel: () => string | null;
  clear: () => void;

  // ── Recording ────────────────────────────────────────────────────────
  /** Record a single undo point with a label. Call BEFORE the mutation. */
  record: (label: string) => void;

  /**
   * Throttled record — only records once within `intervalMs`.
   * Use for continuous changes (slider drags, gizmo moves).
   * Always records the *first* call, then suppresses until the interval elapses.
   */
  recordThrottled: (label: string, intervalMs?: number) => void;

  /** Start a group — all mutations until endGroup() become one undo step. */
  beginGroup: (label: string) => void;
  /** End the group and push the combined undo entry. */
  endGroup: () => void;

  /** Pause recording (e.g. during scene import/restore). */
  pause: () => void;
  /** Resume recording. */
  resume: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_HISTORY_DEPTH = 50;
const DEFAULT_THROTTLE_MS = 400;

// ── Throttle state (module-level, outside Zustand) ─────────────────────────

let _throttleTimers: Map<string, { lastRecord: number; timerId: ReturnType<typeof setTimeout> | null }> = new Map();

// ── Store ──────────────────────────────────────────────────────────────────

export const useHistoryStore = create<HistoryState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  paused: false,
  _groupActive: false,
  _groupSnapshot: null,
  _groupLabel: '',

  // ── Undo ─────────────────────────────────────────────────────────────

  undo: () => {
    const { undoStack, redoStack, paused, _groupActive } = get();
    if (paused || _groupActive || undoStack.length === 0) return null;

    // Capture current state as the "redo" point
    const currentSnapshot = captureSnapshot('redo-point');

    // Pop the last undo entry
    const newUndoStack = [...undoStack];
    const entry = newUndoStack.pop()!;

    // Push current state onto redo stack
    const redoEntry: HistoryEntry = {
      snapshot: currentSnapshot,
      label: entry.label,
    };

    // Restore the snapshot
    restoreSnapshot(entry.snapshot);

    set({
      undoStack: newUndoStack,
      redoStack: [...redoStack, redoEntry],
    });

    return entry.label;
  },

  // ── Redo ─────────────────────────────────────────────────────────────

  redo: () => {
    const { undoStack, redoStack, paused, _groupActive } = get();
    if (paused || _groupActive || redoStack.length === 0) return null;

    // Capture current state as the "undo" point
    const currentSnapshot = captureSnapshot('undo-point');

    // Pop the last redo entry
    const newRedoStack = [...redoStack];
    const entry = newRedoStack.pop()!;

    // Push current state onto undo stack
    const undoEntry: HistoryEntry = {
      snapshot: currentSnapshot,
      label: entry.label,
    };

    // Restore the redo snapshot
    restoreSnapshot(entry.snapshot);

    set({
      undoStack: [...undoStack, undoEntry],
      redoStack: newRedoStack,
    });

    return entry.label;
  },

  // ── Queries ──────────────────────────────────────────────────────────

  canUndo: () => get().undoStack.length > 0 && !get().paused,
  canRedo: () => get().redoStack.length > 0 && !get().paused,

  getUndoLabel: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    return undoStack[undoStack.length - 1].label;
  },

  getRedoLabel: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;
    return redoStack[redoStack.length - 1].label;
  },

  clear: () => {
    set({ undoStack: [], redoStack: [] });
  },

  // ── Recording ────────────────────────────────────────────────────────

  record: (label) => {
    const { paused, _groupActive } = get();
    if (paused) return;

    if (_groupActive) {
      // Inside a group — don't record individual entries
      return;
    }

    const snapshot = captureSnapshot(label);

    set((state) => {
      const newUndo = [...state.undoStack, { snapshot, label }];
      // Trim to max depth
      if (newUndo.length > MAX_HISTORY_DEPTH) {
        newUndo.splice(0, newUndo.length - MAX_HISTORY_DEPTH);
      }
      return {
        undoStack: newUndo,
        // Any new mutation clears the redo stack
        redoStack: [],
      };
    });
  },

  recordThrottled: (label, intervalMs = DEFAULT_THROTTLE_MS) => {
    const { paused, _groupActive } = get();
    if (paused || _groupActive) return;

    const now = Date.now();
    const entry = _throttleTimers.get(label);

    if (entry) {
      // Clear any pending timer
      if (entry.timerId !== null) {
        clearTimeout(entry.timerId);
      }

      if (now - entry.lastRecord >= intervalMs) {
        // Enough time has passed — record now
        get().record(label);
        entry.lastRecord = now;
        entry.timerId = null;
      } else {
        // Schedule a deferred record so the final value is captured
        const remaining = intervalMs - (now - entry.lastRecord);
        entry.timerId = setTimeout(() => {
          entry.lastRecord = Date.now();
          entry.timerId = null;
          // Check if still the same "drag session" — only record if paused is false
          if (!useHistoryStore.getState().paused) {
            useHistoryStore.getState().record(label);
          }
        }, remaining);
      }
    } else {
      // First call — always record immediately
      get().record(label);
      _throttleTimers.set(label, { lastRecord: now, timerId: null });
    }
  },

  // ── Grouping ─────────────────────────────────────────────────────────

  beginGroup: (label) => {
    if (get().paused) return;
    const snapshot = captureSnapshot(label);
    set({
      _groupActive: true,
      _groupSnapshot: snapshot,
      _groupLabel: label,
    });
  },

  endGroup: () => {
    const { _groupActive, _groupSnapshot, _groupLabel } = get();
    if (!_groupActive || !_groupSnapshot) return;

    set((state) => {
      const newUndo = [...state.undoStack, { snapshot: _groupSnapshot, label: _groupLabel }];
      if (newUndo.length > MAX_HISTORY_DEPTH) {
        newUndo.splice(0, newUndo.length - MAX_HISTORY_DEPTH);
      }
      return {
        undoStack: newUndo,
        redoStack: [],
        _groupActive: false,
        _groupSnapshot: null,
        _groupLabel: '',
      };
    });
  },

  // ── Pause / Resume ───────────────────────────────────────────────────

  pause: () => set({ paused: true }),
  resume: () => set({ paused: false }),
}));

// ── Convenience singleton accessors (for non-React contexts) ──────────────

export const history = {
  /** Record a single undo point. Call BEFORE the mutation. */
  record: (label: string) => useHistoryStore.getState().record(label),

  /** Throttled record for continuous changes. */
  recordThrottled: (label: string, intervalMs?: number) =>
    useHistoryStore.getState().recordThrottled(label, intervalMs),

  undo: () => useHistoryStore.getState().undo(),
  redo: () => useHistoryStore.getState().redo(),
  canUndo: () => useHistoryStore.getState().canUndo(),
  canRedo: () => useHistoryStore.getState().canRedo(),
  getUndoLabel: () => useHistoryStore.getState().getUndoLabel(),
  getRedoLabel: () => useHistoryStore.getState().getRedoLabel(),

  beginGroup: (label: string) => useHistoryStore.getState().beginGroup(label),
  endGroup: () => useHistoryStore.getState().endGroup(),

  pause: () => useHistoryStore.getState().pause(),
  resume: () => useHistoryStore.getState().resume(),
  clear: () => useHistoryStore.getState().clear(),
};