/**
 * The environment the path tracer lights the scene with, built from the HDRI assets' own settings.
 *
 * The live PBR viewport can only show one raw HDRI file, so HDRI settings such as Exposure, Rotation X/Z, Flip,
 * Offset, Opacity, Highlights/Shadows, Blur and the colour grading never reached it. The path tracer takes any
 * equirect float image though, so it is given the same composite the HDRI Preview and the export produce
 * (every active asset, with every setting applied), minus the lights: those are traced as real 3D lights, and
 * baking them in as well would count them twice.
 *
 * Global environment intensity is left to `scene.environmentIntensity`, so it is not baked in here either.
 */

import * as THREE from 'three';
import { generateAnalyticalHDRI, loadActiveHDRILayers } from './HDRIExporter';

/** Width of the baked map. 2:1; plenty for lighting and reflections, quick enough to redo while a slider moves. */
export const PT_ENV_WIDTH = 1024;

/**
 * Bake the active HDRI assets into one linear float equirect texture, or null when no asset is active.
 * Throws HDRICancelled when `isCancelled` says a newer bake has superseded this one.
 */
export async function bakePathTracerEnvironment(isCancelled?: () => boolean, width = PT_ENV_WIDTH): Promise<THREE.DataTexture | null> {
  const layers = await loadActiveHDRILayers(1.0);
  if (layers.length === 0) return null;
  if (isCancelled?.()) return null;

  const height = Math.round(width / 2);
  const pixels = await generateAnalyticalHDRI(new THREE.Scene(), width, height, new THREE.Vector3(0, 0, 0), layers, {
    yieldEveryRows: 32,
    isCancelled,
  });
  const tex = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.flipY = false;                       // row 0 = top, like the loaders' equirect data
  tex.needsUpdate = true;
  return tex;
}
