import React, { useRef, useEffect, useMemo } from 'react';
import { useHistoryStore } from '../../store/historyStore';

/**
 * HistoryPanel — displays the undo/redo stack in a scrollable list.
 * Shows entries from newest (top) to oldest (bottom).
 * The current state is indicated with a blue left border.
 * Redo entries are shown in italic dim text.
 */

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export const HistoryPanel: React.FC = () => {
  const undoStack = useHistoryStore((s) => s.undoStack);
  const redoStack = useHistoryStore((s) => s.redoStack);
  const listRef = useRef<HTMLDivElement>(null);

  // Combined list: current state + redo entries (newest at top)
  // Undo entries are NOT shown (they represent past states already undone-from)
  const entries = useMemo(() => {
    // Show current state marker
    const result: Array<{ label: string; timestamp: number; type: 'current' | 'redo' }> = [
      { label: 'Current State', timestamp: Date.now(), type: 'current' },
    ];

    // Add redo entries (newest first)
    for (let i = redoStack.length - 1; i >= 0; i--) {
      const entry = redoStack[i];
      result.push({
        label: entry.label,
        timestamp: entry.snapshot.timestamp,
        type: 'redo',
      });
    }

    return result;
  }, [redoStack]);

  // Add undo entries (newest first) BELOW current state
  const undoEntries = useMemo(() => {
    const result: Array<{ label: string; timestamp: number }> = [];
    for (let i = undoStack.length - 1; i >= 0; i--) {
      const entry = undoStack[i];
      result.push({
        label: entry.label,
        timestamp: entry.snapshot.timestamp,
      });
    }
    return result;
  }, [undoStack]);

  const isEmpty = undoStack.length === 0 && redoStack.length === 0;

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <h3>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.6 }}>
            <path d="M2 5h6M7 3l2 2-2 2" stroke="currentColor" fill="none" strokeWidth="1.2" />
          </svg>
          History
        </h3>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
          {undoStack.length} / {undoStack.length + redoStack.length}
        </span>
      </div>

      <div className="history-list" ref={listRef}>
        {isEmpty ? (
          <div className="history-empty">No history yet</div>
        ) : (
          <>
            {/* Undo entries (actions that can be undone) */}
            {undoEntries.map((entry, idx) => (
              <div key={`undo-${idx}`} className="history-entry">
                <div className="history-entry-icon">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M3 5h4M6 3l2 2-2 2" />
                  </svg>
                </div>
                <span className="history-entry-label">{entry.label}</span>
                <span className="history-entry-time">{formatTime(entry.timestamp)}</span>
              </div>
            ))}

            {/* Current state marker */}
            <div className="history-entry current">
              <div className="history-entry-icon">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <circle cx="4" cy="4" r="3" />
                </svg>
              </div>
              <span className="history-entry-label">Current State</span>
              <span className="history-entry-time">now</span>
            </div>

            {/* Redo entries (actions that can be redone) */}
            {entries.slice(1).map((entry, idx) => (
              <div key={`redo-${idx}`} className="history-entry future">
                <div className="history-entry-icon">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M5 2v6M3 4l2-2 2 2" />
                  </svg>
                </div>
                <span className="history-entry-label">{entry.label}</span>
                <span className="history-entry-time">{formatTime(entry.timestamp)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};