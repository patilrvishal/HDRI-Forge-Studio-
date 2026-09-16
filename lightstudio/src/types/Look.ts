import type { PresetLight } from './Preset';
import type { HDRIShape } from './HDRIShape';

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
export interface Look {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL, rendered from the lights only (v1)
  createdAt: number;
  lights: PresetLight[];
  hdriShapes: HDRIShape[];
  camera: LookCamera | null;
}
