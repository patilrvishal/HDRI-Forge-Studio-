import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { SceneManager } from '../../three/engine';

interface CameraBookmarksProps {
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
}

const MAX_BOOKMARKS = 8;

export const CameraBookmarks: React.FC<CameraBookmarksProps> = ({ sceneManagerRef }) => {
  const cameraBookmarks = useSceneStore((s) => s.cameraBookmarks);
  const saveCameraBookmark = useSceneStore((s) => s.saveCameraBookmark);
  const loadCameraBookmark = useSceneStore((s) => s.loadCameraBookmark);
  const removeCameraBookmark = useSceneStore((s) => s.removeCameraBookmark);

  const [activeBookmarkId, setActiveBookmarkId] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState(false);
  const [bookmarkName, setBookmarkName] = useState('');
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuId) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setContextMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenuId]);

  // Auto-focus name input when entering save mode
  useEffect(() => {
    if (saveMode && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [saveMode]);

  // Fill bookmark slots with placeholders
  const slots = Array.from({ length: MAX_BOOKMARKS }, (_, i) => {
    return cameraBookmarks[i] ?? null;
  });

  const handleSaveClick = useCallback(() => {
    if (cameraBookmarks.length >= MAX_BOOKMARKS) return;
    setSaveMode(true);
    setBookmarkName(`Camera ${cameraBookmarks.length + 1}`);
  }, [cameraBookmarks.length]);

  const handleConfirmSave = useCallback(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;
    const camState = sm.getCameraState();
    saveCameraBookmark(bookmarkName.trim() || `Camera ${cameraBookmarks.length + 1}`, camState.position, camState.target, camState.fov);
    setSaveMode(false);
    setBookmarkName('');
  }, [sceneManagerRef, saveCameraBookmark, bookmarkName, cameraBookmarks.length]);

  const handleCancelSave = useCallback(() => {
    setSaveMode(false);
    setBookmarkName('');
  }, []);

  const handleLoadBookmark = useCallback(
    (id: string) => {
      const bookmark = loadCameraBookmark(id);
      if (bookmark && sceneManagerRef.current) {
        sceneManagerRef.current.animateCameraTo(bookmark.position, bookmark.target, 500);
        sceneManagerRef.current.camera.fov = bookmark.fov;
        sceneManagerRef.current.camera.updateProjectionMatrix();
        setActiveBookmarkId(id);
      }
      setContextMenuId(null);
    },
    [loadCameraBookmark, sceneManagerRef]
  );

  const handleDeleteBookmark = useCallback(
    (id: string) => {
      removeCameraBookmark(id);
      setContextMenuId(null);
      if (activeBookmarkId === id) setActiveBookmarkId(null);
    },
    [removeCameraBookmark, activeBookmarkId]
  );

  // Right-click context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenuId(id);
  }, []);

  // Long-press handler for touch devices
  const handlePointerDown = useCallback((id: string) => {
    const timer = setTimeout(() => {
      setContextMenuId(id);
    }, 500);
    setLongPressTimer(timer);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleConfirmSave();
      } else if (e.key === 'Escape') {
        handleCancelSave();
      }
    },
    [handleConfirmSave, handleCancelSave]
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '3px 4px',
        zIndex: 5,
      }}
    >
      {/* Bookmark slots */}
      {slots.map((bookmark, i) => (
        <div key={bookmark?.id ?? `empty-${i}`} style={{ position: 'relative' }}>
          <button
            onClick={() => bookmark && handleLoadBookmark(bookmark.id)}
            onContextMenu={(e) => bookmark && handleContextMenu(e, bookmark.id)}
            onPointerDown={() => bookmark && handlePointerDown(bookmark.id)}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{
              width: 22,
              height: 22,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              cursor: bookmark ? 'pointer' : 'default',
              color: bookmark
                ? activeBookmarkId === bookmark.id
                  ? 'var(--accent)'
                  : 'var(--text-sec)'
                : 'var(--text-dim)',
              background: bookmark
                ? activeBookmarkId === bookmark.id
                  ? 'var(--accent-bg)'
                  : 'transparent'
                : 'var(--bg-input)',
              border: bookmark
                ? activeBookmarkId === bookmark.id
                  ? '1px solid var(--accent)'
                  : '1px solid transparent'
                : '1px solid var(--border)',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            title={bookmark ? `${bookmark.name} — Right-click to delete` : `Slot ${i + 1}`}
          >
            {bookmark ? i + 1 : i + 1}
          </button>

          {/* Context menu */}
          {contextMenuId === bookmark?.id && (
            <div
              className="context-menu"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                minWidth: 120,
              }}
            >
              <div
                className="context-menu-item"
                onClick={() => handleLoadBookmark(bookmark.id)}
              >
                Load View
              </div>
              <div
                className="context-menu-item"
                style={{ color: 'var(--danger)' }}
                onClick={() => handleDeleteBookmark(bookmark.id)}
              >
                Delete
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Save button */}
      {!saveMode ? (
        <button
          onClick={handleSaveClick}
          disabled={cameraBookmarks.length >= MAX_BOOKMARKS}
          className="btn-sm"
          style={{
            fontSize: 9,
            padding: '2px 6px',
            marginLeft: 4,
            opacity: cameraBookmarks.length >= MAX_BOOKMARKS ? 0.4 : 1,
          }}
          title="Save current camera as bookmark"
        >
          + Save
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>
          <input
            ref={nameInputRef}
            type="text"
            value={bookmarkName}
            onChange={(e) => setBookmarkName(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: 70,
              height: 20,
              padding: '0 4px',
              background: 'var(--bg-input)',
              border: '1px solid var(--accent)',
              borderRadius: 3,
              color: 'var(--text)',
              fontSize: 10,
              fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            onClick={handleConfirmSave}
            className="btn-sm"
            style={{ fontSize: 9, padding: '2px 5px', color: 'var(--success)', borderColor: 'var(--success)' }}
          >
            ✓
          </button>
          <button
            onClick={handleCancelSave}
            className="btn-sm"
            style={{ fontSize: 9, padding: '2px 5px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};