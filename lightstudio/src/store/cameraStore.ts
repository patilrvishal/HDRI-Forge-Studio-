import { create } from 'zustand';

export interface SceneCamera {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  targetId: string | null;
  fov: number;
  focalLength: number;
  sensorFit: 'auto' | 'horizontal' | 'vertical';
  sensorWidth: number;
  sensorHeight: number;
  shiftX: number;
  shiftY: number;
  clipStart: number;
  clipEnd: number;
  dofEnabled: boolean;
  dofFocusObjectId: string | null;
  dofFocusDistance: number;
  dofFStop: number;
  dofBlades: number;
  /** Where this camera came from - purely informational (a badge in
   *  CameraPanel), never gates behavior. */
  source: 'manual' | 'blender' | 'maya';
  /** Which workspace(s) this camera shows up in - a camera defaults to both,
   *  so a pushed or manually-created camera is immediately usable in 360
   *  Workspace and Angle Hunt Mode; the user narrows it via CameraPanel to
   *  "swap" a camera between workspaces. */
  workspaces: ('360' | 'angleHunt')[];
  /** When true, orbit-drag can't touch this camera even in 360 Workspace
   *  (Angle Hunt Mode already always locks the active camera regardless of
   *  this flag). Off by default so 360 Workspace's existing "active camera
   *  is drag-adjustable" behavior is unchanged until the user explicitly
   *  locks a specific camera via the lock button next to the camera
   *  switcher. */
  locked: boolean;
}

interface CameraState {
  cameras: SceneCamera[];
  activeCameraId: string | null;
  addCamera: (fromView?: Partial<SceneCamera>) => string;
  removeCamera: (id: string) => void;
  renameCamera: (id: string, name: string) => void;
  updateCamera: (id: string, updates: Partial<SceneCamera>) => void;
  setActiveCamera: (id: string | null) => void;
  getActiveCamera: () => SceneCamera | null;
}

let counter = 1;

export const useCameraStore = create<CameraState>((set, get) => ({
  cameras: [],
  activeCameraId: null,

  addCamera: (fromView) => {
    const id = `camera_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const cam: SceneCamera = {
      id,
      name: fromView?.name ?? `Camera ${counter++}`,
      position: fromView?.position ?? {
        x: 5 + (counter % 5) * 2,
        y: 3,
        z: 5 - (counter % 5) * 2,
      },
      rotation: fromView?.rotation ?? { x: 0, y: 0, z: 0 },
      targetId: fromView?.targetId ?? null,
      fov: fromView?.fov ?? 45,
      focalLength: fromView?.focalLength ?? 50,
      sensorFit: fromView?.sensorFit ?? 'horizontal',
      sensorWidth: fromView?.sensorWidth ?? 36,
      sensorHeight: fromView?.sensorHeight ?? 24,
      shiftX: fromView?.shiftX ?? 0,
      shiftY: fromView?.shiftY ?? 0,
      clipStart: fromView?.clipStart ?? 0.1,
      clipEnd: fromView?.clipEnd ?? 1000,
      dofEnabled: fromView?.dofEnabled ?? false,
      dofFocusObjectId: fromView?.dofFocusObjectId ?? null,
      dofFocusDistance: fromView?.dofFocusDistance ?? 10,
      dofFStop: fromView?.dofFStop ?? 2.8,
      dofBlades: fromView?.dofBlades ?? 6,
      source: fromView?.source ?? 'manual',
      workspaces: fromView?.workspaces ?? ['360', 'angleHunt'],
      locked: fromView?.locked ?? false,
    };
    set((s) => ({ cameras: [...s.cameras, cam], activeCameraId: id }));
    return id;
  },

  removeCamera: (id) =>
    set((s) => ({
      cameras: s.cameras.filter((c) => c.id !== id),
      activeCameraId: s.activeCameraId === id ? null : s.activeCameraId,
    })),

  renameCamera: (id, name) =>
    set((s) => ({
      cameras: s.cameras.map((c) => (c.id === id ? { ...c, name } : c)),
    })),

  updateCamera: (id, updates) =>
    set((s) => ({
      cameras: s.cameras.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  setActiveCamera: (id) => set({ activeCameraId: id }),

  getActiveCamera: () => {
    const { cameras, activeCameraId } = get();
    return cameras.find((c) => c.id === activeCameraId) ?? null;
  },
}));
