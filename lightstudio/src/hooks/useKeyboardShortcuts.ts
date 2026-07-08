import { useEffect } from 'react';
import type { ActiveTool } from '../store/uiStore';
import { useAnimationStore } from '../store/animationStore';

interface KeyboardShortcutCallbacks {
  onSave?: () => void;
  onOpen?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  setActiveTool?: (tool: ActiveTool) => void;
  onFrameAll?: () => void;
  toggleIsolate?: () => void;
  toggleVisibility?: () => void;
  toggleTurntable?: () => void;
  toggleFullscreen?: () => void;
  setViewMode?: (mode: string) => void;
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            callbacks.onSave?.();
            return;
          case 'o':
            e.preventDefault();
            callbacks.onOpen?.();
            return;
          case 'z':
            e.preventDefault();
            callbacks.onUndo?.();
            return;
          case 'y':
            e.preventDefault();
            callbacks.onRedo?.();
            return;
        }
      }

      // Don't handle single keys when in an input field
      if (isInput) return;

      // ── Animation shortcuts (take priority when tracks exist) ─────────
      const animState = useAnimationStore.getState();
      const hasTracks = animState.tracks.length > 0;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (hasTracks) {
            // Space toggles animation play/pause when tracks exist
            useAnimationStore.getState().togglePlaying();
          } else {
            // Fall back to turntable toggle when no animation tracks
            callbacks.toggleTurntable?.();
          }
          break;

        // Arrow keys for frame stepping
        case 'ArrowRight':
          if (hasTracks) {
            e.preventDefault();
            if (e.shiftKey) {
              useAnimationStore.getState().jumpToEnd();
            } else {
              useAnimationStore.getState().stepForward();
            }
          }
          break;
        case 'ArrowLeft':
          if (hasTracks) {
            e.preventDefault();
            if (e.shiftKey) {
              useAnimationStore.getState().jumpToStart();
            } else {
              useAnimationStore.getState().stepBackward();
            }
          }
          break;
        case 'Home':
          if (hasTracks) {
            e.preventDefault();
            useAnimationStore.getState().jumpToStart();
          }
          break;
        case 'End':
          if (hasTracks) {
            e.preventDefault();
            useAnimationStore.getState().jumpToEnd();
          }
          break;

        case 'Delete':
        case 'Backspace':
          // Delete selected keyframe if in animation context
          if (hasTracks && animState.selectedKeyframeId && animState.selectedTrackId) {
            e.preventDefault();
            useAnimationStore.getState().removeKeyframe(animState.selectedTrackId, animState.selectedKeyframeId);
          } else {
            callbacks.onDelete?.();
          }
          break;

        case 'g':
          callbacks.setActiveTool?.('move');
          break;
        case 'r':
          callbacks.setActiveTool?.('rotate');
          break;
        case 's':
          callbacks.setActiveTool?.('select');
          break;
        case 'f':
          callbacks.onFrameAll?.();
          break;
        case 'i':
          callbacks.toggleIsolate?.();
          break;
        case 'h':
          callbacks.toggleVisibility?.();
          break;
        case 'F11':
          e.preventDefault();
          callbacks.toggleFullscreen?.();
          break;
        // Numpad view shortcuts
        case '1':
          if (e.code === 'Numpad1' || e.location === 3) {
            callbacks.setViewMode?.('front');
          }
          break;
        case '3':
          if (e.code === 'Numpad3' || e.location === 3) {
            callbacks.setViewMode?.('right');
          }
          break;
        case '7':
          if (e.code === 'Numpad7' || e.location === 3) {
            callbacks.setViewMode?.('top');
          }
          break;
        case '0':
          if (e.code === 'Numpad0' || e.location === 3) {
            callbacks.setViewMode?.('perspective');
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [callbacks]);
}