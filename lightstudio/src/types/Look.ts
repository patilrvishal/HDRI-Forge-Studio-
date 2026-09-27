import type { PresetLight } from './Preset';
import type { HDRIShape } from './HDRIShape';
import type { Light } from './Light';
import type { LightCollection } from './Composite';
import type { EditLayer, SkyEnvParams } from '../hdriedit/types';
import type { ObjectHdriSettings } from '../store/objectHdriStore';

/** Snapshot of the active camera at save time - optional, since a Look
 *  saved with no active camera shouldn't force one into existence on
 *  every scene that applies it. */
export interface LookCamera {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  fov: number;
}

/**
 * A whole-scene lighting setup, HDR Light Studio's "Light Looks" - a
 * superset of a Preset (which only ever captured lights). Snapshots
 * lights, HDRI shapes (composite lights painted on the environment map),
 * and the camera view, so switching Looks reproduces the full shot, not
 * just the light rig.
 *
 * Deliberately does NOT embed the active HDRI/environment binary - that
 * already persists in its own asset library (hdriAssetStore) and
 * re-embedding a multi-MB HDR/EXR per Look would make every save heavy
 * for no benefit, since the asset itself doesn't change between Looks in
 * the common case (only the lighting on top of it does).
 */
/** Everything the lighting design consists of, captured verbatim so a Look restores exactly. */
export interface LookSnapshot {
  lights: Light[];
  collections: LightCollection[];
  hdri: { id: string; edits?: EditLayer[]; sky?: SkyEnvParams; intensity: number; rotation: number; opacity: number; contrast: number; gamma: number; saturation: number; active: boolean }[];
  objectHdri: Record<string, ObjectHdriSettings>;
}

export interface Look {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL, rendered from the lights only (v1)
  createdAt: number;
  lights: PresetLight[];
  hdriShapes: HDRIShape[];
  camera: LookCamera | null;
  /** Full-fidelity capture (appearances, composites, HDRI edits, object settings). Older Looks lack it. */
  snapshot?: LookSnapshot;
}
