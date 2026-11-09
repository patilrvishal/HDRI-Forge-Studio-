import * as THREE from 'three';
import type { HDRIPreset, EnvPanel } from '../types/Environment';

function addPanel(envScene: THREE.Scene, panel: EnvPanel): void {
  const geo = new THREE.PlaneGeometry(panel.size[0], panel.size[1]);
  const color = new THREE.Color(panel.color);
  color.multiplyScalar(panel.intensity);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
  if (panel.rotationX !== undefined) mesh.rotation.x = panel.rotationX;
  if (panel.rotationY !== undefined) mesh.rotation.y = panel.rotationY;
  envScene.add(mesh);
}

/**
 * The environment a preset describes: its coloured light panels, ground and ambient fill.
 * The viewport bakes THIS scene into the reflection map, and the Environment Browser thumbnails render THIS scene,
 * so an icon always matches what the preset looks like in the output.
 */
export function buildPresetEnvScene(preset: HDRIPreset, rotationDeg = 0): { scene: THREE.Scene; ground: THREE.Mesh } {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(preset.backgroundHint);
  for (const panel of preset.panels) addPanel(envScene, panel);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ color: preset.groundColor ?? 0x333344, side: THREE.DoubleSide }),
  );
  ground.position.set(0, -2, 0);
  ground.rotation.x = -Math.PI / 2;
  envScene.add(ground);

  if (preset.ambient) envScene.add(new THREE.AmbientLight(preset.ambient.color, preset.ambient.intensity));
  if (rotationDeg !== 0) envScene.rotation.y = (rotationDeg * Math.PI) / 180;
  return { scene: envScene, ground };
}
