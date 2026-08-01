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
