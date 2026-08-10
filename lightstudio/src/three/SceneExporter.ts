import { useSceneStore } from '../store/sceneStore';
import { useLightsStore } from '../store/lightsStore';
import { useAnimationStore } from '../store/animationStore';
import { useMaterialEditorStore } from '../store/materialEditorStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { history } from '../store/historyStore';
import { getRawModelDataBase64 } from '../store/modelDataStore';
import { getRawHDRIDataBase64 } from '../store/hdriDataStore';
import type { AnimationState } from '../types/Animation';
import type { SceneState } from '../types/Scene';

// ── Scene file schema ───────────────────────────────────────────────────────

export interface SceneFile {
  /** File format version for forward compatibility */
  version: string;
  /** ISO 8601 timestamp of when this file was created */
  exportedAt: string;
  /** Application name and version */
  appInfo: {
    name: string;
    version: string;
  };

  // ── Core scene data ──────────────────────────────────────────────────────
  scene: {
    modelName: string;
    /** Base64-encoded GLB binary data (embedded for self-contained scene files) */
    modelDataBase64: string | null;
    camera: {
      position: [number, number, number];
      target: [number, number, number];
      fov: number;
    };
    environment: {
      hdri: string | null;
      presetId: string;
      rotation: number;
      background: string;
      intensity: number;
      showBackground: boolean;
      customHDRIDataBase64: string | null;
      backplate: string | null;
      backplateOpacity: number;
    };
    renderSettings: {
      engine: string;
      tonemapping: string;
      exposure: number;
      quality: string;
      antialiasing: string;
      shadowQuality: string;
      bloom: { enabled: boolean; intensity: number; threshold: number; radius: number };
      ao: { enabled: boolean; radius: number; intensity: number };
      ground: {
        visible: boolean;
        reflections: boolean;
        reflectionSharpness: number;
        color: string;
        roughness: number;
        metalness: number;
        fadeRadius: number;
      };
      vignette: { enabled: boolean; intensity: number };
      colorGrading: { enabled: boolean; brightness: number; contrast: number; saturation: number };
      exportFormat: string;
      renderResolution: string;
      customWidth: number;
      customHeight: number;
      autoSave: boolean;
      autoSaveInterval: number;
    };
    showGrid: boolean;
    turntable: { active: boolean; speed: number };
  };

  // ── Lights ───────────────────────────────────────────────────────────────
  lights: unknown[];

  // ── Animation (Phase 5) ──────────────────────────────────────────────────
  animation: AnimationState | null;

  // ── Camera bookmarks ─────────────────────────────────────────────────────
  cameraBookmarks: Array<{
    id: string;
    name: string;
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  }>;

  // ── Material Editor state (Phase 10) ─────────────────────────────────────
  materials: unknown[] | null;
  // ── HDRI Assets ──────────────────────────────────────────────────────────
  hdriAssets: unknown[] | null;
}

// ── SceneExporter ──────────────────────────────────────────────────────────

export class SceneExporter {
  private static readonly FILE_VERSION = '1.0';
  private static readonly APP_NAME = 'LightForge Studio';
  private static readonly APP_VERSION = '1.0.0';
  private static readonly FILE_EXTENSION = '.lightscene';
  private static readonly MIME_TYPE = 'application/json';

  /**
   * Serialize the entire application state into a SceneFile object.
   * Reads current state from all Zustand stores.
   */
  static exportScene(): SceneFile {
    const sceneState = useSceneStore.getState();
    const lightsState = useLightsStore.getState();
    const animState = useAnimationStore.getState();

    return {
      version: this.FILE_VERSION,
      exportedAt: new Date().toISOString(),
      appInfo: {
        name: this.APP_NAME,
        version: this.APP_VERSION,
      },
      scene: {
        modelName: sceneState.modelName,
        modelDataBase64: getRawModelDataBase64(),
        camera: { ...sceneState.camera },
        environment: {
          ...sceneState.environment,
          customHDRIDataBase64: sceneState.environment.presetId === '__custom__'
            ? getRawHDRIDataBase64()
            : null,
        },
        renderSettings: {
          engine: sceneState.renderSettings.engine,
          tonemapping: sceneState.renderSettings.tonemapping,
          exposure: sceneState.renderSettings.exposure,
          quality: sceneState.renderSettings.quality,
          antialiasing: sceneState.renderSettings.antialiasing,
          shadowQuality: sceneState.renderSettings.shadowQuality,
          bloom: { ...sceneState.renderSettings.bloom },
          ao: { ...sceneState.renderSettings.ao },
          ground: { ...sceneState.renderSettings.ground },
          vignette: { ...sceneState.renderSettings.vignette },
          colorGrading: { ...sceneState.renderSettings.colorGrading },
          exportFormat: sceneState.renderSettings.exportFormat,
          renderResolution: sceneState.renderSettings.renderResolution,
          customWidth: sceneState.renderSettings.customWidth,
          customHeight: sceneState.renderSettings.customHeight,
          autoSave: sceneState.renderSettings.autoSave,
          autoSaveInterval: sceneState.renderSettings.autoSaveInterval,
        },
        showGrid: sceneState.showGrid,
        turntable: { ...sceneState.turntable },
      },
      lights: JSON.parse(JSON.stringify(lightsState.lights)),
      animation: animState.exportAnimation(),
      cameraBookmarks: sceneState.cameraBookmarks.map((b) => ({
        id: b.id,
        name: b.name,
        position: [...b.position] as [number, number, number],
        target: [...b.target] as [number, number, number],
        fov: b.fov,
      })),
      materials: useMaterialEditorStore.getState().exportMaterials(),
      hdriAssets: useHDRIAssetStore.getState().exportAssets(),
    };
  }

  /**
   * Validate that a parsed object conforms to the SceneFile schema.
   * Returns an error message string if invalid, or null if valid.
   */
  static validateSceneFile(data: unknown): string | null {
    if (!data || typeof data !== 'object') {
      return 'Invalid file: not a valid JSON object.';
    }
    const obj = data as Record<string, unknown>;

    if (!obj.version || typeof obj.version !== 'string') {
      return 'Invalid file: missing or invalid version field.';
    }

    if (!obj.scene || typeof obj.scene !== 'object') {
      return 'Invalid file: missing scene data.';
    }

    const scene = obj.scene as Record<string, unknown>;
    if (!scene.camera || !scene.environment || !scene.renderSettings) {
      return 'Invalid file: scene data is incomplete (missing camera, environment, or render settings).';
    }

    if (!Array.isArray(obj.lights)) {
      return 'Invalid file: lights array is missing or not an array.';
    }

    // Animation is optional (null is fine for pre-Phase-5 files)
    if (obj.animation !== undefined && obj.animation !== null && typeof obj.animation !== 'object') {
      return 'Invalid file: animation field should be null or an object.';
    }

    return null;
  }

  /**
   * Import a SceneFile object into the application stores.
   * Restores scene, lights, animation, and camera bookmarks.
   * Returns an error message if something goes wrong, or null on success.
   */
  static importScene(data: SceneFile): string | null {
    try {
      // Pause history during import to avoid recording the restore as an undo point
      history.pause();

      // ── Restore scene state ─────────────────────────────────────────────
      const sceneData = data.scene;
      useSceneStore.getState().loadSceneState({
        modelName: sceneData.modelName,
        camera: sceneData.camera,
        environment: sceneData.environment as SceneFile['scene']['environment'],
        renderSettings: sceneData.renderSettings as unknown as SceneState['renderSettings'],
        showGrid: sceneData.showGrid,
        turntable: sceneData.turntable as SceneFile['scene']['turntable'],
      });

      // ── Restore lights ──────────────────────────────────────────────────
      if (Array.isArray(data.lights) && data.lights.length > 0) {
        useLightsStore.getState().setLightsFromPreset(data.lights as never[]);
      } else {
        useLightsStore.getState().clearAllLights();
      }

      // ── Restore animation (Phase 5) ─────────────────────────────────────
      if (data.animation) {
        useAnimationStore.getState().importAnimation(data.animation);
      } else {
        useAnimationStore.getState().clearAllTracks();
      }

      // ── Restore camera bookmarks ────────────────────────────────────────
      // These were being written to the file and then silently dropped on
      // load, so every saved camera slot came back empty.
      useSceneStore.getState().setCameraBookmarks(
        Array.isArray(data.cameraBookmarks) ? data.cameraBookmarks : [],
      );

      // ── Restore materials (Phase 10) ─────────────────────────────────────
      if (Array.isArray(data.materials) && data.materials.length > 0) {
        useMaterialEditorStore.getState().importMaterials(data.materials as never[]);
      } else {
        useMaterialEditorStore.getState().clearMaterials();
      }

      // ── Restore HDRI assets ────────────────────────────────────────────
      if (Array.isArray(data.hdriAssets) && data.hdriAssets.length > 0) {
        useHDRIAssetStore.getState().importAssets(data.hdriAssets as never[]);
        // Restore blob URLs for each asset that has base64 data
        for (const asset of data.hdriAssets) {
          const a = asset as { id: string; dataBase64: string | null; fileName: string };
          if (a.dataBase64) {
            const binary = atob(a.dataBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes.buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            useHDRIAssetStore.getState().setAssetBlobUrl(a.id, url);
          }
        }
      } else {
        useHDRIAssetStore.getState().clearAssets();
      }

      // ── Restore model GLB data ──────────────────────────────────────────
      if (data.scene.modelDataBase64) {
        useSceneStore.getState().setPendingModelData(
          data.scene.modelDataBase64,
          sceneData.modelName || 'model.glb',
        );
      }

      // ── Restore custom HDRI data ─────────────────────────────────────────
      if (data.scene.environment.customHDRIDataBase64 && sceneData.environment.presetId === '__custom__') {
        useSceneStore.getState().setPendingHDRIData(
          data.scene.environment.customHDRIDataBase64,
          'custom.hdr',
        );
      }

      return null;
    } catch (err) {
      history.resume();
      const message = err instanceof Error ? err.message : 'Unknown error during import';
      return `Failed to import scene: ${message}`;
    } finally {
      history.resume();
    }
  }

  /**
   * Convert a SceneFile to a JSON string.
   */
  static toJSON(data: SceneFile): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Parse a JSON string into a SceneFile (with validation).
   * Returns the parsed data or throws an error.
   */
  static fromJSON(jsonString: string): SceneFile {
    const data = JSON.parse(jsonString);
    const error = this.validateSceneFile(data);
    if (error) {
      throw new Error(error);
    }
    return data as SceneFile;
  }

  /**
   * Trigger a browser file download for a scene JSON file.
   * Generates filename with timestamp.
   */
  static downloadSceneFile(data: SceneFile, filename?: string): void {
    const json = this.toJSON(data);
    const blob = new Blob([json], { type: this.MIME_TYPE });
    const url = URL.createObjectURL(blob);

    const name = filename ?? `lightforge_${this.sanitizeFilename(data.scene.modelName)}_${Date.now()}${this.FILE_EXTENSION}`;

    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    }, 200);
  }

  /**
   * Open a file picker for .lightscene or .json files and read the content.
   * Returns the file text content, or null if the user cancelled.
   */
  static async openSceneFile(): Promise<{ text: string; filename: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.lightscene,.json';
      input.style.display = 'none';

      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            text: reader.result as string,
            filename: file.name,
          });
        };
        reader.onerror = () => {
          resolve(null);
        };
        reader.readAsText(file);

        // Cleanup
        setTimeout(() => {
          if (input.parentNode) {
            input.parentNode.removeChild(input);
          }
        }, 200);
      };

      input.oncancel = () => {
        resolve(null);
      };

      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Sanitize a model name for use in filenames.
   * Removes special characters and replaces spaces with underscores.
   */
  private static sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase()
      || 'scene';
  }

  /**
   * Quick-save to localStorage (session recovery).
   *
   * An embedded model blows the ~5-20MB localStorage quota outright (a car GLB
   * base64s to 40MB+), which used to throw QuotaExceededError into a silent
   * catch - the save simply never happened and nothing told the user. Now the
   * model is dropped and the rest of the rig is still saved, and the caller
   * gets a result it can surface.
   */
  static quickSave(): { ok: boolean; modelIncluded: boolean; error?: string } {
    const data = this.exportScene();

    try {
      localStorage.setItem('lightstudio_quicksave', JSON.stringify(data));
      return { ok: true, modelIncluded: data.scene.modelDataBase64 !== null };
    } catch {
      // Retry without the model payload - the lighting rig is the part worth
      // recovering, and it is orders of magnitude smaller.
      try {
        const slim: SceneFile = { ...data, scene: { ...data.scene, modelDataBase64: null } };
        localStorage.setItem('lightstudio_quicksave', JSON.stringify(slim));
        return { ok: true, modelIncluded: false };
      } catch {
        return {
          ok: false,
          modelIncluded: false,
          error: 'Browser storage is full. Use Project > Save Scene to save to a file instead.',
        };
      }
    }
  }

  /**
   * Quick-load from localStorage (for Ctrl+O fallback).
   * Returns null if no save exists.
   */
  static quickLoad(): SceneFile | null {
    try {
      const raw = localStorage.getItem('lightstudio_quicksave');
      if (!raw) return null;
      const data = JSON.parse(raw);
      const error = this.validateSceneFile(data);
      if (error) return null;
      return data as SceneFile;
    } catch {
      return null;
    }
  }
}