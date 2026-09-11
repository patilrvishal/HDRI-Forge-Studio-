import * as THREE from 'three';
import { useLightsStore } from '../store/lightsStore';
import { useSceneStore } from '../store/sceneStore';
import { useHDRIShapesStore } from '../store/hdriShapesStore';
import { useCameraStore, type SceneCamera } from '../store/cameraStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { base64ToArrayBuffer } from '../store/modelDataStore';
import type { Light, LightRotation, LightType } from '../types/Light';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const HDRI_BRIDGE_EVENT = 'hdri-bridge:scene-update';

// ─── Payload interfaces ────────────────────────────────────────────────────
interface Vec3 { x: number; y: number; z: number; }
interface Color { r: number; g: number; b: number; }

interface BridgeLightData {
  id: string;
  name: string;
  type: 'POINT' | 'SUN' | 'SPOT' | 'AREA';
  color: Color;
  energy: number;
  position: Vec3;  // Blender world-space (Z-up)
  rotation: Vec3;  // Three.js Euler degrees (XYZ), pre-converted in the addon
  spot_size?: number; // radians, SPOT lights only (full cone angle)
  aim_target?: Vec3;  // optional explicit aim target (world-space, Three.js coords)
}

interface BridgeCameraData {
  position: Vec3;
  rotation: Vec3;
  fov: number;
}

interface BridgeMeshPayload {
  fileName: string;
  dataBase64: string;
  objectNames: string[];
  /** Which loader to run this through - defaults to 'glb' (e.g. Blender's
   *  export). Maya has no native glTF export, so its addon sends 'obj'. */
  format?: 'glb' | 'obj';
  error?: string;
}

interface BridgePayload {
  /** Which DCC/addon sent this - controls axis conversion. Blender is Z-up
   *  and needs remapping to Three.js's Y-up; Maya is already Y-up and needs
   *  none. Missing/unrecognized defaults to 'blender' for older addon builds
   *  that predate this field. */
  source?: 'blender' | 'maya';
  lights?: BridgeLightData[];
  camera?: BridgeCameraData;
  world?: { fileName?: string; dataBase64?: string; strength?: number; error?: string };
  mesh?: BridgeMeshPayload;
}

// ─── Axis conversion ───────────────────────────────────────────────────────
// Blender is Z-up: X=X  Y=Z  Z=-Y maps it to Three.js's Y-up. Maya is already
// Y-up/right-handed like Three.js, so its coordinates pass through unchanged.
function toThreePos(b: Vec3, source: BridgePayload['source']): THREE.Vector3 {
  if (source === 'maya') {
    return new THREE.Vector3(b.x, b.y, b.z);
  }
  return new THREE.Vector3(b.x, b.z, -b.y);
}

function blenderTypeToStudio(t: BridgeLightData['type']): LightType {
  switch (t) {
    case 'POINT': return 'point';
    case 'SUN': return 'directional';
    case 'SPOT': return 'spot';
    case 'AREA': return 'area';
    default: return 'point';
  }
}

function colorToHex(c: Color): string {
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

// Studio brightness is a unitless 0-1000 slider; Blender's energy is watts for
// Point/Spot/Area (default ~1000) but irradiance W/m^2 for Sun (default ~1) -
// scale Sun up so it lands in a comparable range instead of reading as near-zero.
function energyToBrightness(type: BridgeLightData['type'], energy: number): number {
  const raw = type === 'SUN' ? energy * 200 : energy;
  return Math.max(0, Math.min(1000, raw));
}

// ─── Apply lights ──────────────────────────────────────────────────────────
function applyLights(lightsData: BridgeLightData[], source: BridgePayload['source']) {
  const { lights, addLight, updateLight } = useLightsStore.getState();
  const existingIds = new Set(lights.map((l) => l.id));

  lightsData.forEach((bl) => {
    const studioType = blenderTypeToStudio(bl.type);

    // Cartesian -> the spherical form the engine actually renders from
    // (radius = horizontal distance, height = world Y; see LightManager._updateLight)
    const threePos = toThreePos(bl.position, source);
    const radius = Math.sqrt(threePos.x ** 2 + threePos.z ** 2);
    const lng = radius > 1e-6 ? (Math.atan2(threePos.z, threePos.x) * 180) / Math.PI : 0;

    const rotation: LightRotation & { aimTarget?: { x: number; y: number; z: number } } = {
      x: bl.rotation.x,
      y: bl.rotation.y,
      z: bl.rotation.z,
      mode: 'euler',
      enabled: true,
      repeat: false,
      advanced: { lR: 0, p1: 0, p2: 0, p3: 0, rR: 0, ro: 0, roat: 0 },
      ...(bl.aim_target ? { aimTarget: toThreePos(bl.aim_target, source) } : {}),
    };

    const updates: Partial<Light> = {
      name: bl.name,
      type: studioType,
      color: colorToHex(bl.color),
      brightness: energyToBrightness(bl.type, bl.energy),
      transform: {
        spherical: { lat: 0, lng, radius, height: threePos.y },
        position: { x: threePos.x, y: threePos.y, z: threePos.z },
        rotation,
      },
      ...(studioType === 'spot' && bl.spot_size !== undefined
        ? { spotAngle: Math.max(1, Math.min(90, THREE.MathUtils.radToDeg(bl.spot_size / 2))) }
        : {}),
    };

    if (existingIds.has(bl.id)) {
      updateLight(bl.id, updates);
    } else {
      // The store only creates lights from a template key, not an arbitrary
      // object - add a default light, then overwrite it (including its id,
      // so a later push for the same Blender object updates it in place).
      addLight();
      const newId = useLightsStore.getState().selectedLightId;
      if (newId) updateLight(newId, { ...updates, id: bl.id });
    }
  });
}

// ─── Apply camera ──────────────────────────────────────────────────────────
// One reserved camera slot for all bridge pushes, so pushing again updates
// the same camera in place instead of piling up duplicates.
const BRIDGE_CAMERA_ID = 'bridge-camera';

function applyCamera(bc: BridgeCameraData, source: BridgePayload['source']) {
  const { cameras, addCamera, updateCamera, setActiveCamera } = useCameraStore.getState();
  const threePos = toThreePos(bc.position, source);

  const updates: Partial<SceneCamera> = {
    name: 'Bridge Camera',
    position: { x: threePos.x, y: threePos.y, z: threePos.z },
    // Already Three.js-space Euler degrees, pre-converted by the addon (same
    // as light rotation) - the engine applies this directly when the camera
    // has no targetId (see SceneManager.applyActiveCamera).
    rotation: { x: bc.rotation.x, y: bc.rotation.y, z: bc.rotation.z },
    targetId: null,
    fov: bc.fov,
  };

  const existing = cameras.find((c) => c.id === BRIDGE_CAMERA_ID);
  if (existing) {
    updateCamera(BRIDGE_CAMERA_ID, updates);
  } else {
    const newId = addCamera(updates);
    updateCamera(newId, { id: BRIDGE_CAMERA_ID });
  }
  setActiveCamera(BRIDGE_CAMERA_ID);
}

// ─── Apply mesh ────────────────────────────────────────────────────────────
function applyMesh(mesh: BridgeMeshPayload) {
  if (mesh.error) {
    console.warn('[BlenderBridge] mesh export error:', mesh.error);
    return;
  }
  // skipFit=true so the engine preserves the DCC-space transform instead of
  // auto-centering/rescaling the loaded model.
  useSceneStore.getState().setPendingModelData(mesh.dataBase64, mesh.fileName, true, mesh.format ?? 'glb');
}

// ─── Apply world/HDRI ──────────────────────────────────────────────────────
// Prefix marks an asset as bridge-owned, so a later push for the same file
// can find and replace it instead of piling up duplicates - the store's
// public addAsset()/updateAsset() API has no id parameter to reuse directly
// (unlike lights/camera), so identity here is tracked through the name.
const BRIDGE_WORLD_PREFIX = 'Bridge: ';

function applyWorld(world: NonNullable<BridgePayload['world']>) {
  if (world.error) {
    console.warn('[BlenderBridge] world/HDRI push error:', world.error);
    return;
  }
  if (!world.dataBase64 || !world.fileName) {
    return;
  }

  const { assets, removeAsset, addAsset, updateAsset } = useHDRIAssetStore.getState();
  const bridgeFileName = BRIDGE_WORLD_PREFIX + world.fileName;

  const existing = assets.find((a) => a.fileName === bridgeFileName);
  if (existing) {
    removeAsset(existing.id);
  }

  const arrayBuffer = base64ToArrayBuffer(world.dataBase64);
  const file = new File([arrayBuffer], bridgeFileName, { type: 'application/octet-stream' });
  const asset = useHDRIAssetStore.getState().addAsset(file, arrayBuffer);

  if (world.strength !== undefined) {
    updateAsset(asset.id, { intensity: world.strength });
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────
function handleBridgePayload(payload: BridgePayload) {
  console.log('[BlenderBridge] received payload', payload);

  if (payload.lights?.length) {
    applyLights(payload.lights, payload.source ?? 'blender');
  }
  if (payload.mesh) {
    applyMesh(payload.mesh);
  }
  if (payload.camera) {
    applyCamera(payload.camera, payload.source ?? 'blender');
  }
  if (payload.world) {
    applyWorld(payload.world);
  }

  if (payload.lights?.length || payload.mesh || payload.camera || payload.world) {
    // A push is a deliberate, one-off action (unlike a slider drag) - render
    // the HDRI Preview once so the result is visible without the user having
    // to also flip on Live Preview or hunt for the Refresh button.
    useHDRIShapesStore.getState().requestPreviewRefresh();
  }
}

// ─── Init (call once from main.tsx) ────────────────────────────────────────
// Two transports carry the same event name/payload shape, picked by runtime:
// - `npm run dev` (Vite dev server, browser or `tauri dev`): the dev-server
//   plugin relays pushes over Vite's own HMR WebSocket.
// - the built desktop app (no dev server exists): the Rust backend's own
//   HTTP listener (src-tauri/src/lib.rs) relays pushes as a Tauri event.
export function initBlenderBridge() {
  if (import.meta.hot) {
    import.meta.hot.on(HDRI_BRIDGE_EVENT, (data: BridgePayload) => {
      handleBridgePayload(data);
    });
    console.log('[BlenderBridge] listening for Blender pushes (dev server) on', HDRI_BRIDGE_EVENT);
    return;
  }

  if (isTauri()) {
    listen<BridgePayload>(HDRI_BRIDGE_EVENT, (event) => {
      handleBridgePayload(event.payload);
    })
      .then(() => {
        console.log('[BlenderBridge] listening for Blender pushes (desktop app) on', HDRI_BRIDGE_EVENT);
      })
      .catch((e) => {
        console.error('[BlenderBridge] failed to attach desktop listener', e);
      });
  }
}
