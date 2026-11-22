import * as THREE from 'three';

const ORIG = '__ovOrigMaterial';   // the mesh's own material(s), kept while an override is showing

let overrideMat: THREE.MeshPhysicalMaterial | null = null;

function material(): THREE.MeshPhysicalMaterial {
  if (!overrideMat) {
    overrideMat = new THREE.MeshPhysicalMaterial();
    overrideMat.name = 'Material Override';
    overrideMat.userData.isMaterialOverride = true;
  }
  return overrideMat;
}

/** Grid, gizmo, rig set and other editor dressing are never overridden. */
function isDressing(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const u = n.userData;
    if (u?.isGrid || u?.isProxy || u?.isHelper || u?.isRigSet || u?.rigPart) return true;
  }
  return false;
}

function targets(scene: THREE.Scene, root: THREE.Object3D | null): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  (root ?? scene).traverse((o) => {
    if (o instanceof THREE.Mesh && !isDressing(o)) out.push(o);
  });
  return out;
}

/** Puts every mesh's own material(s) back, whatever the override was last showing on. */
export function restoreOriginalMaterials(scene: THREE.Scene): void {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData[ORIG] !== undefined) {
      o.material = o.userData[ORIG];
      delete o.userData[ORIG];
    }
  });
}

export interface OverrideLook { color: string; metalness: number; roughness: number; clearcoat: number }

/**
 * Shows one temporary material on the chosen meshes (Blender's Material Override). Each mesh keeps its own material(s) in
 * userData, so switching the override off restores the original slots exactly. `rootUuid` limits it to one object / group.
 * Safe to call again for every change: it first restores everything, then re-applies to the current targets.
 */
export function applyMaterialOverride(scene: THREE.Scene, enabled: boolean, look: OverrideLook, rootUuid: string | null): void {
  restoreOriginalMaterials(scene);
  if (!enabled) return;
  const m = material();
  m.color.set(look.color);
  m.metalness = look.metalness;
  m.roughness = look.roughness;
  m.clearcoat = look.clearcoat;
  m.clearcoatRoughness = Math.min(0.1, look.roughness);
  m.envMapIntensity = 1;
  m.needsUpdate = true;
  const root = rootUuid ? scene.getObjectByProperty('uuid', rootUuid) ?? null : null;
  if (rootUuid && !root) return;
  for (const mesh of targets(scene, root)) {
    mesh.userData[ORIG] = mesh.material;
    mesh.material = m;
  }
}
