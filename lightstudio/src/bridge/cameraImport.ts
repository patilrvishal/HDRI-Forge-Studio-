import { applyCameras, bridgeCameraStoreId, type BridgeCameraData } from './BlenderBridgeListener';
import { useCameraStore } from '../store/cameraStore';

/** Erik cameras are authored around the car at Erik's own scale and origin, but Forge
 *  rescales the .erik car to 4 units and re-centres it. Apply the same uniform scale and
 *  shift to the camera positions (rotation is unchanged by both) so each camera keeps its
 *  position relative to the car. With no Erik car loaded, positions pass through as-is. */
function placeRelativeToCar(cams: BridgeCameraData[], source: CameraSource): BridgeCameraData[] {
  if (source !== 'erik') return cams;
  const model = (window as unknown as { __getErikModel?: () => { scale: { x: number }; position: { x: number; y: number; z: number } } | null })
    .__getErikModel?.();
  if (!model) return cams;
  const s = model.scale.x;
  const p = model.position;
  return cams.map((c) => ({
    ...c,
    position: { x: c.position.x * s + p.x, y: c.position.y * s + p.y, z: c.position.z * s + p.z },
  }));
}

/** Apps Forge can pull cameras from. */
export type CameraSource = 'erik' | 'blender' | 'maya';

export const CAMERA_SOURCE_LABEL: Record<CameraSource, string> = {
  erik: 'Erik',
  blender: 'Blender',
  maya: 'Maya',
};

const CAMERAS_PATH = '/__hdri_bridge_cameras';
// Each addon runs a tiny loopback listener (see BLENDER_RECEIVE_PORT / MAYA_RECEIVE_PORT).
const DCC_PORT: Record<'blender' | 'maya', number> = { blender: 8975, maya: 8976 };
const HOSTS = ['127.0.0.1', '[::1]'];

export interface RemoteCamera extends BridgeCameraData {
  /** Present when this camera is already in Forge's camera list. */
  alreadyImported?: boolean;
}

async function fetchJson(url: string, timeoutMs = 4000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Where Erik's cameras are published: the same local bridge Erik Live already uses. */
async function erikBase(): Promise<string> {
  const ok = async (base: string, ms: number) => {
    try {
      const j = await fetchJson(`${base}/status`, ms);
      return !!j && j.ok === true;
    } catch { return false; }
  };
  // Dev server / any page that serves the bridge itself.
  if (/^https?:/.test(window.location.origin) && (await ok(`${window.location.origin}/__erik_live`, 800))) {
    return `${window.location.origin}/__erik_live`;
  }
  // Desktop app: its bridge listens on the first free port in 5173-5180.
  for (let port = 5173; port <= 5180; port++) {
    for (const host of HOSTS) {
      const base = `http://${host}:${port}/__erik_live`;
      if (await ok(base, 500)) return base;
    }
  }
  throw new Error('no bridge');
}

/** List every camera in the source app's current scene. Throws a readable Error. */
export async function listSourceCameras(source: CameraSource): Promise<RemoteCamera[]> {
  let cams: BridgeCameraData[];
  if (source === 'erik') {
    let j: any;
    try {
      j = await fetchJson(`${await erikBase()}/cameras`);
    } catch {
      throw new Error('Could not reach the Erik link. Open Erik Adjuster with the Forge link on.');
    }
    cams = j?.cameras ?? [];
    if (!cams.length) throw new Error('Erik has not sent any cameras yet. In Erik, open a project and use "Send cameras to Forge".');
  } else {
    let j: any = null;
    let lastErr: unknown = null;
    for (const host of HOSTS) {
      try {
        j = await fetchJson(`http://${host}:${DCC_PORT[source]}${CAMERAS_PATH}`);
        break;
      } catch (e) { lastErr = e; }
    }
    if (!j) {
      throw new Error(`Could not reach ${CAMERA_SOURCE_LABEL[source]}. Make sure it is open with the HDRI Forge Bridge ${source === 'blender' ? 'add-on enabled' : 'plug-in loaded'}.` +
        (lastErr ? '' : ''));
    }
    if (!j.ok) throw new Error(j.error || `${CAMERA_SOURCE_LABEL[source]} returned an error.`);
    cams = j.cameras ?? [];
    if (!cams.length) throw new Error(`No cameras found in the ${CAMERA_SOURCE_LABEL[source]} scene.`);
  }
  const existing = new Set(useCameraStore.getState().cameras.map((c) => c.id));
  return cams.map((c) => ({ ...c, alreadyImported: existing.has(bridgeCameraStoreId(c, source)) }));
}

/** Import only the chosen cameras (new ones are added, previously imported ones are refreshed). */
export function importSelectedCameras(source: CameraSource, cams: RemoteCamera[], ids: Set<string>): number {
  const chosen = cams.filter((c) => ids.has(c.id));
  if (chosen.length) applyCameras(placeRelativeToCar(chosen, source), source);
  return chosen.length;
}

/** Forge camera id -> the camera's id inside its source app, or null for manual cameras. */
export function sourceOf(cameraId: string): { source: CameraSource; remoteId: string } | null {
  const m = /^bridge-(blender|maya|erik)-(.+)$/.exec(cameraId);
  return m ? { source: m[1] as CameraSource, remoteId: m[2] } : null;
}

/** Re-pull ONE camera from its source app and update only that camera in Forge. */
export async function syncCamera(cameraId: string): Promise<string> {
  const src = sourceOf(cameraId);
  if (!src) throw new Error('This camera was not imported from Erik, Blender or Maya.');
  let cam: BridgeCameraData | undefined;
  if (src.source === 'erik') {
    const j = await fetchJson(`${await erikBase()}/cameras`).catch(() => {
      throw new Error('Could not reach the Erik link.');
    });
    cam = (j?.cameras ?? []).find((c: BridgeCameraData) => c.id === src.remoteId);
  } else {
    let j: any = null;
    for (const host of HOSTS) {
      try {
        j = await fetchJson(`http://${host}:${DCC_PORT[src.source]}${CAMERAS_PATH}?id=${encodeURIComponent(src.remoteId)}`);
        break;
      } catch { /* next host */ }
    }
    if (!j) throw new Error(`Could not reach ${CAMERA_SOURCE_LABEL[src.source]}.`);
    if (!j.ok) throw new Error(j.error || 'Sync failed.');
    cam = (j.cameras ?? [])[0];
  }
  if (!cam) throw new Error(`Camera "${src.remoteId}" no longer exists in ${CAMERA_SOURCE_LABEL[src.source]}.`);
  // applyCameras updates by store id, so only this camera changes; the active camera is restored.
  applyCameras(placeRelativeToCar([cam], src.source), src.source);
  return cam.name;
}
