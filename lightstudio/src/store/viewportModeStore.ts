import { create } from 'zustand';

/**
 * The two top-level viewport workflows:
 * - '360'       - free-orbit, edit-the-environment-from-any-angle (today's
 *                 only mode, unchanged).
 * - 'angleHunt' - locked to one camera "shot" (HDR Light Studio's Camera/
 *                 Light-Editor view) so lights can be positioned precisely
 *                 against a specific real render angle.
 *
 * Deliberately a separate store from uiStore's PanelLayout - that's purely a
 * panel-visibility preset (which side panels are open), unrelated to camera/
 * viewport behavior, and conflating the two would make them impossible to
 * vary independently.
 */
export type WorkspaceMode = '360' | 'angleHunt';

interface ViewportModeState {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

export const useViewportModeStore = create<ViewportModeState>((set) => ({
  mode: '360',
  setMode: (mode) => set({ mode }),
}));
