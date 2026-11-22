import { useSceneStore } from '../store/sceneStore';
import { useSceneFileStore } from '../store/sceneFileStore';
import { useLightsStore } from '../store/lightsStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { useHDRIShapesStore } from '../store/hdriShapesStore';
import { useCameraStore } from '../store/cameraStore';
import { useMaterialEditorStore } from '../store/materialEditorStore';
import { useSceneHierarchyStore } from '../store/sceneHierarchyStore';
import { useObjectHdriStore } from '../store/objectHdriStore';
import { useRigSetStore } from '../store/rigSetStore';
import { useLumiCurveWindowStore } from '../store/lumiCurveWindowStore';
import { useAppearanceStore } from '../appearance/appearanceStore';
import { getModelingController } from '../modeling/bridge';

/** Event the 3D viewport listens for: it removes the loaded model (GLB or Erik) from the scene. */
export const NEW_SCENE_EVENT = 'forge:new-scene';

/**
 * Everything a new scene starts without: the lights, HDRI layers and shapes, the studio rig (its room and fixtures),
 * mesh objects, the loaded model and its materials, imported cameras, the hierarchy state and the object HDRI settings.
 * Before this only some of them were cleared, so the last scene's studio set and layers stayed on screen.
 */
export function resetForNewScene(): void {
  useSceneStore.getState().resetScene();
  useSceneFileStore.getState().setCurrent(null);
  useLightsStore.getState().clearAllLights();
  useHDRIAssetStore.getState().clearAssets();
  useHDRIShapesStore.getState().clearShapes();
  useAppearanceStore.getState().clearImages();
  getModelingController()?.deserialize([]);
  useObjectHdriStore.getState().clear();

  // the studio rig: clearing its kind makes the viewport remove the room, the fixtures and the shadow lights
  const rig = useRigSetStore.getState();
  rig.setKind(null);
  rig.clearOverrides();
  rig.resetLook();
  useRigSetStore.setState({ cameraRequest: null });

  useCameraStore.setState({ cameras: [], activeCameraId: null });
  useMaterialEditorStore.getState().clearMaterials();
  useSceneHierarchyStore.getState().clearAll();
  useLumiCurveWindowStore.getState().close();

  window.dispatchEvent(new Event(NEW_SCENE_EVENT));
}
