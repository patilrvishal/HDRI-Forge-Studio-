import { create } from 'zustand';
import type { Look, LookCamera, LookSnapshot } from '../types/Look';
import { useHDRIAssetStore } from './hdriAssetStore';
import { useObjectHdriStore } from './objectHdriStore';
import type { Light } from '../types/Light';
import type { HDRIShape } from '../types/HDRIShape';
import { presetToLights, generatePresetThumbnail } from '../types/Preset';
import { lookDB } from '../services/LookDB';
import { useLightsStore } from './lightsStore';
import { useHDRIShapesStore } from './hdriShapesStore';
import { useCameraStore } from './cameraStore';

function generateId(): string {
  return `look_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function captureSnapshot(): LookSnapshot {
  const ls = useLightsStore.getState();
  return {
    lights: clone(ls.lights),
    collections: clone(ls.collections),
    hdri: useHDRIAssetStore.getState().assets.map((a) => ({
      id: a.id, edits: clone(a.edits ?? []), sky: a.sky ? clone(a.sky) : undefined,
      intensity: a.intensity, rotation: a.rotation, opacity: a.opacity, contrast: a.contrast, gamma: a.gamma, saturation: a.saturation, active: a.active,
    })),
    objectHdri: useObjectHdriStore.getState().exportSettings(),
  };
}

function restoreSnapshot(snap: LookSnapshot): void {
  const ls = useLightsStore.getState();
  ls.clearAllLights();
  ls.setLightsFromPreset(clone(snap.lights));
  ls.setCollections(clone(snap.collections));
  const hs = useHDRIAssetStore.getState();
  for (const h of snap.hdri) {
    if (hs.assets.some((a) => a.id === h.id)) {
      const { id, ...patch } = h;
      hs.updateAsset(id, clone(patch));
    }
  }
  useObjectHdriStore.getState().importSettings(snap.objectHdri);
}

interface LooksState {
  looks: Look[];
  dbLoaded: boolean;

  loadFromDB: () => Promise<void>;
  /** Snapshot the live scene (lights + HDRI shapes + active camera) as a
   *  new named Look. */
  saveCurrentAsLook: (name: string) => Promise<Look>;
  /** Restore a saved Look's lights, HDRI shapes, and camera into the live
   *  scene, replacing whatever's there now. */
  applyLook: (id: string) => void;
  renameLook: (id: string, name: string) => void;
  /** Copy a Look so it can be edited without touching the original. */
  duplicateLook: (id: string) => Promise<Look | null>;
  /** Overwrite a Look with the scene as it is now. */
  updateLookFromCurrent: (id: string) => Promise<void>;
  deleteLook: (id: string) => Promise<void>;
}

export const useLooksStore = create<LooksState>((set, get) => ({
  looks: [],
  dbLoaded: false,

  loadFromDB: async () => {
    const looks = await lookDB.getAll();
    set({ looks, dbLoaded: true });
  },

  saveCurrentAsLook: async (name) => {
    const lights = useLightsStore.getState().lights;
    const shapes = useHDRIShapesStore.getState().shapes;
    const activeCamera = useCameraStore.getState().getActiveCamera();

    const presetLights = lights.map((l) => ({
      name: l.name,
      type: l.type,
      color: l.color,
      brightness: l.brightness,
      opacity: l.opacity,
      colorProfile: l.colorProfile,
      areaLight: l.areaLight,
      falloff: l.falloff,
      transform: JSON.parse(JSON.stringify(l.transform)),
      areaWidth: l.areaWidth,
      areaHeight: l.areaHeight,
      spotAngle: l.spotAngle,
      spotPenumbra: l.spotPenumbra,
      edgeSoftness: l.edgeSoftness,
    }));

    const camera: LookCamera | null = activeCamera
      ? {
          position: { ...activeCamera.position },
          rotation: { ...activeCamera.rotation },
          fov: activeCamera.fov,
        }
      : null;

    const look: Look = {
      id: generateId(),
      name,
      thumbnail: generatePresetThumbnail(presetLights),
      createdAt: Date.now(),
      lights: presetLights,
      hdriShapes: JSON.parse(JSON.stringify(shapes)) as HDRIShape[],
      camera,
      snapshot: captureSnapshot(),
    };

    set((s) => ({ looks: [...s.looks, look] }));
    await lookDB.put(look);
    return look;
  },

  applyLook: (id) => {
    const look = get().looks.find((l) => l.id === id);
    if (!look) return;

    // Full-fidelity Looks restore everything; older ones fall back to the reduced light data.
    if (look.snapshot) {
      restoreSnapshot(look.snapshot);
    } else {
    const newLights: Light[] = presetToLights({
      id: look.id,
      name: look.name,
      category: 'custom',
      description: '',
      thumbnail: '',
      tags: [],
      lights: look.lights,
      createdAt: look.createdAt,
      isDefault: false,
    });
    // setLightsFromPreset is deliberately additive (presets are meant to
    // stack on an existing rig) - a Look is the opposite: a whole-scene
    // checkpoint that should REPLACE whatever's there, so it needs the
    // explicit clear first, exactly like its own doc comment says to.
    useLightsStore.getState().clearAllLights();
    useLightsStore.getState().setLightsFromPreset(newLights);
    }

    useHDRIShapesStore.getState().setShapesFromLook(look.hdriShapes);

    if (look.camera) {
      const camState = useCameraStore.getState();
      const active = camState.getActiveCamera();
      if (active) {
        camState.updateCamera(active.id, {
          position: { ...look.camera.position },
          rotation: { ...look.camera.rotation },
          fov: look.camera.fov,
        });
      } else {
        // addCamera already makes the new camera active - no separate
        // setActiveCamera call needed, and its return value is the new
        // camera's id (a string), not the camera object.
        camState.addCamera({
          position: look.camera.position,
          rotation: look.camera.rotation,
          fov: look.camera.fov,
        });
      }
    }
  },

  renameLook: (id, name) => {
    set((s) => ({ looks: s.looks.map((l) => (l.id === id ? { ...l, name } : l)) }));
    const look = get().looks.find((l) => l.id === id);
    if (look) void lookDB.put(look);
  },

  duplicateLook: async (id) => {
    const src = get().looks.find((l) => l.id === id);
    if (!src) return null;
    const copy: Look = { ...clone(src), id: generateId(), name: src.name + ' copy', createdAt: Date.now() };
    set((s) => ({ looks: [...s.looks, copy] }));
    await lookDB.put(copy);
    return copy;
  },

  updateLookFromCurrent: async (id) => {
    const cur = get().looks.find((l) => l.id === id);
    if (!cur) return;
    const lights = useLightsStore.getState().lights;
    const cam = useCameraStore.getState().getActiveCamera();
    const presetLights = lights.map((l) => ({ name: l.name, type: l.type, color: l.color, brightness: l.brightness, opacity: l.opacity, colorProfile: l.colorProfile, areaLight: l.areaLight, falloff: l.falloff, transform: JSON.parse(JSON.stringify(l.transform)), areaWidth: l.areaWidth, areaHeight: l.areaHeight, spotAngle: l.spotAngle, spotPenumbra: l.spotPenumbra, edgeSoftness: l.edgeSoftness }));
    const next: Look = {
      ...cur,
      thumbnail: generatePresetThumbnail(presetLights),
      lights: presetLights,
      hdriShapes: JSON.parse(JSON.stringify(useHDRIShapesStore.getState().shapes)) as HDRIShape[],
      camera: cam ? { position: { ...cam.position }, rotation: { ...cam.rotation }, fov: cam.fov } : cur.camera,
      snapshot: captureSnapshot(),
    };
    set((s) => ({ looks: s.looks.map((l) => (l.id === id ? next : l)) }));
    await lookDB.put(next);
  },

  deleteLook: async (id) => {
    set((s) => ({ looks: s.looks.filter((l) => l.id !== id) }));
    await lookDB.del(id);
  },
}));
