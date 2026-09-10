import * as THREE from 'three';
import { useLightsStore } from '../store/lightsStore';
import { useSceneStore } from '../store/sceneStore';
import type { Light, LightRotation, LightType } from '../types/Light';

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
  error?: string;
}

interface BridgePayload {
  lights?: BridgeLightData[];
  camera?: BridgeCameraData;
  world?: { hdri_path?: string; strength?: number };
  mesh?: BridgeMeshPayload;
}

// ─── Axis conversion ───────────────────────────────────────────────────────
// Blender Z-up -> Three.js Y-up: X=X  Y=Z  Z=-Y
function blToThreePos(b: Vec3): THREE.Vector3 {
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
function applyLights(lightsData: BridgeLightData[]) {
  const { lights, addLight, updateLight } = useLightsStore.getState();
  const existingIds = new Set(lights.map((l) => l.id));

  lightsData.forEach((bl) => {
    const studioType = blenderTypeToStudio(bl.type);

    // Cartesian -> the spherical form the engine actually renders from
    // (radius = horizontal distance, height = world Y; see LightManager._updateLight)
    const threePos = blToThreePos(bl.position);
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
      ...(bl.aim_target ? { aimTarget: blToThreePos(bl.aim_target) } : {}),
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

// ─── Apply mesh ────────────────────────────────────────────────────────────
function applyMesh(mesh: BridgeMeshPayload) {
  if (mesh.error) {
    console.warn('[BlenderBridge] mesh export error:', mesh.error);
    return;
  }
  // skipFit=true so the engine preserves the Blender-space transform instead
  // of auto-centering/rescaling the loaded model.
  useSceneStore.getState().setPendingModelData(mesh.dataBase64, mesh.fileName, true);
}

// ─── Main handler ──────────────────────────────────────────────────────────
function handleBridgePayload(payload: BridgePayload) {
  console.log('[BlenderBridge] received payload', payload);

  if (payload.lights?.length) {
    applyLights(payload.lights);
  }
  if (payload.mesh) {
    applyMesh(payload.mesh);
  }
  // Camera and world/HDRI handling can be extended here
}

// ─── Init (call once from main.tsx) ────────────────────────────────────────
export function initBlenderBridge() {
  if (import.meta.hot) {
    import.meta.hot.on(HDRI_BRIDGE_EVENT, (data: BridgePayload) => {
      handleBridgePayload(data);
    });
    console.log('[BlenderBridge] listening for Blender pushes on', HDRI_BRIDGE_EVENT);
  }
}
