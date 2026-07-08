import { create } from 'zustand';
import type { SceneState, CameraBookmark } from '../types/Scene';
import { DEFAULT_SCENE_STATE, createDefaultCameraBookmark } from '../types/Scene';
import { history } from './historyStore';

interface SceneStore extends SceneState {
  // Camera bookmarks
  cameraBookmarks: CameraBookmark[];
  
  // Transient: pending model data (base64) from scene file restore
  // Not part of the persisted scene state — used to signal Viewport to reload the model
  _pendingModelDataBase64: string | null;
  _pendingModelFileName: string;
  
  // Model
  setModel: (path: string, name: string) => void;
  clearModel: () => void;
  
  // Camera
  setCamera: (position: [number, number, number], target: [number, number, number], fov?: number) => void;
  
  // Environment
  setEnvironment: (env: Partial<SceneState['environment']>) => void;
  toggleBackground: () => void;
  /** Phase 9: Set environment preset by ID */
  setEnvironmentPreset: (presetId: string) => void;
  /** Phase 9: Set environment rotation (0-360 degrees) */
  setEnvironmentRotation: (rotation: number) => void;
  
  // Render settings
  setRenderSettings: (settings: Partial<SceneState['renderSettings']>) => void;
  setBloom: (bloom: Partial<SceneState['renderSettings']['bloom']>) => void;
  setAO: (ao: Partial<SceneState['renderSettings']['ao']>) => void;
  setExposure: (exposure: number) => void;
  setVignette: (vignette: Partial<SceneState['renderSettings']['vignette']>) => void;
  setColorGrading: (cg: Partial<SceneState['renderSettings']['colorGrading']>) => void;
  
  // Grid & turntable
  toggleGrid: () => void;
  setTurntable: (active: boolean, speed?: number) => void;
  toggleTurntable: () => void;
  
  // Camera bookmarks
  saveCameraBookmark: (name: string, position: [number, number, number], target: [number, number, number], fov: number) => void;
  loadCameraBookmark: (id: string) => CameraBookmark | undefined;
  removeCameraBookmark: (id: string) => void;
  
  // Scene load
  loadSceneState: (state: Partial<SceneState>) => void;
  resetScene: () => void;
  
  // Model data restore
  setPendingModelData: (base64: string | null, fileName: string) => void;
  clearPendingModelData: () => void;
}

export const useSceneStore = create<SceneStore>((set, get) => ({
  ...DEFAULT_SCENE_STATE,
  cameraBookmarks: [],
  _pendingModelDataBase64: null,
  _pendingModelFileName: 'model.glb',

  setModel: (path, name) => {
    // Model loading is NOT recorded — it's a file operation, not an edit
    set({ modelPath: path, modelName: name });
  },

  clearModel: () => {
    set({ modelPath: null, modelName: 'No Model Loaded' });
  },

  setCamera: (position, target, fov) => {
    // Camera position from orbit controls is NOT recorded per-frame
    set((state) => ({
      camera: {
        position,
        target,
        fov: fov ?? state.camera.fov,
      },
    }));
  },

  setEnvironment: (env) => {
    history.record('Change Environment');
    set((state) => ({
      environment: { ...state.environment, ...env },
    }));
  },

  toggleBackground: () => {
    history.record('Toggle Background');
    set((state) => ({
      environment: { ...state.environment, showBackground: !state.environment.showBackground },
    }));
  },

  setEnvironmentPreset: (presetId) => {
    history.record('Change Environment Preset');
    set((state) => ({
      environment: { ...state.environment, presetId, hdri: null },
    }));
  },

  setEnvironmentRotation: (rotation) => {
    history.recordThrottled('Change Environment Rotation');
    set((state) => ({
      environment: { ...state.environment, rotation },
    }));
  },

  setRenderSettings: (settings) => {
    history.record('Change Render Settings');
    set((state) => ({
      renderSettings: { ...state.renderSettings, ...settings },
    }));
  },

  setBloom: (bloom) => {
    history.recordThrottled('Change Bloom');
    set((state) => ({
      renderSettings: {
        ...state.renderSettings,
        bloom: { ...state.renderSettings.bloom, ...bloom },
      },
    }));
  },

  setAO: (ao) => {
    history.recordThrottled('Change AO');
    set((state) => ({
      renderSettings: {
        ...state.renderSettings,
        ao: { ...state.renderSettings.ao, ...ao },
      },
    }));
  },

  setExposure: (exposure) => {
    history.recordThrottled('Change Exposure');
    set((state) => ({
      renderSettings: { ...state.renderSettings, exposure },
    }));
  },

  setVignette: (vignette) => {
    history.recordThrottled('Change Vignette');
    set((state) => ({
      renderSettings: {
        ...state.renderSettings,
        vignette: { ...state.renderSettings.vignette, ...vignette },
      },
    }));
  },

  setColorGrading: (cg) => {
    history.recordThrottled('Change Color Grading');
    set((state) => ({
      renderSettings: {
        ...state.renderSettings,
        colorGrading: { ...state.renderSettings.colorGrading, ...cg },
      },
    }));
  },

  toggleGrid: () => {
    history.record('Toggle Grid');
    set((state) => ({ showGrid: !state.showGrid }));
  },

  setTurntable: (active, speed) => {
    history.record('Change Turntable');
    set((state) => ({
      turntable: {
        active,
        speed: speed ?? state.turntable.speed,
      },
    }));
  },

  toggleTurntable: () => {
    history.record('Toggle Turntable');
    set((state) => ({
      turntable: { ...state.turntable, active: !state.turntable.active },
    }));
  },

  saveCameraBookmark: (name, position, target, fov) => {
    // Bookmarks are not part of the undoable scene data
    const state = get();
    if (state.cameraBookmarks.length >= 8) return;
    const bookmark = createDefaultCameraBookmark(state.cameraBookmarks.length);
    bookmark.name = name;
    bookmark.position = position;
    bookmark.target = target;
    bookmark.fov = fov;
    set((s) => ({
      cameraBookmarks: [...s.cameraBookmarks, bookmark],
    }));
  },

  loadCameraBookmark: (id) => {
    return get().cameraBookmarks.find((b) => b.id === id);
  },

  removeCameraBookmark: (id) => {
    set((state) => ({
      cameraBookmarks: state.cameraBookmarks.filter((b) => b.id !== id),
    }));
  },

  loadSceneState: (newState) => {
    // Scene import/restore — do NOT record (called by undo/redo itself, or by file open)
    set((state) => ({ ...state, ...newState }));
  },

  resetScene: () => {
    history.record('New Scene');
    set({ ...DEFAULT_SCENE_STATE, cameraBookmarks: [], _pendingModelDataBase64: null, _pendingModelFileName: 'model.glb' });
  },

  setPendingModelData: (base64, fileName) => {
    set({ _pendingModelDataBase64: base64, _pendingModelFileName: fileName });
  },

  clearPendingModelData: () => {
    set({ _pendingModelDataBase64: null, _pendingModelFileName: 'model.glb' });
  },
}));