import * as THREE from 'three';
import { objectKey } from './objectBinding';
import { useObjectHdriStore, defaultObjectHdri, type ObjectHdriSettings } from '../store/objectHdriStore';
import { disposeRigSet } from './rigSet';
import { useRigSetStore, type MatOverride } from '../store/rigSetStore';

/** The hierarchy group a rig makes in the scene: named after the rig, holding its lights and its studio-set parts. */
export function findRigGroup(scene: THREE.Scene): THREE.Group | null {
  return (scene.children.find((o) => o.userData.isRigSet) as THREE.Group | undefined) ?? null;
}

export function makeRigGroup(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.userData._isCollection = true;   // shows as a group in the Scene hierarchy
  g.userData.isRigSet = true;
  return g;
}

/** Drops the group: its set parts are disposed, any lights it still holds go back under the scene. */
export function removeRigGroup(scene: THREE.Scene, group: THREE.Group): void {
  for (const c of [...group.children]) {
    if (c.userData.rigPart) { group.remove(c); disposeRigSet(c); }
    else scene.add(c);
  }
  scene.remove(group);
}

/** Moves the freshly built set parts into the group, giving each a stable, readable name. */
export function fillRigGroup(group: THREE.Group, built: THREE.Group): void {
  for (const c of [...group.children]) {
    if (c.userData.rigPart) { group.remove(c); disposeRigSet(c); }
  }
  const used = new Map<string, number>();
  let i = 0;
  for (const child of [...built.children]) {
    const geo = (child as THREE.Mesh).geometry?.type?.replace('Geometry', '') ?? 'Part';
    const base = child.name || (geo === 'Part' || geo === '' ? 'Part' : geo);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    child.name = n === 1 && child.name ? base : `${base} ${n}`;
    child.userData.rigPart = true;
    group.add(child);
    i++;
  }
  group.userData.reflBox = built.userData.reflBox;
  group.userData.rigSet = built.userData.rigSet;
}

/**
 * Every part of a rig is rendered into the HDRI by default (emissive parts as bright cards at their emission strength).
 * Switching a part off in its HDRI settings sticks: only parts with no setting yet are given one.
 * Settings of the previous rig's group are dropped.
 */
export function applyDefaultHdriInclude(group: THREE.Group, previousName?: string): void {
  const add: Record<string, ObjectHdriSettings> = {};
  for (const child of group.children) {
    if (!child.userData.rigPart) continue;
    const key = objectKey(child);
    let emissive = 1;
    child.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.01) emissive = Math.max(emissive, m.emissiveIntensity ?? 1);
    });
    add[key] = { ...defaultObjectHdri(), include: true, intensity: emissive };
  }
  useObjectHdriStore.setState((s) => {
    const next: Record<string, ObjectHdriSettings> = {};
    const stale = previousName ? 'n:' + previousName + '/' : null;
    for (const [k, v] of Object.entries(s.settings)) if (!(stale && k.startsWith(stale) && !(k in add))) next[k] = v;
    for (const [k, v] of Object.entries(add)) if (!next[k]) next[k] = v;     // keep any manual choice
    return { settings: next, version: s.version + 1 };
  });
}

const isGlow = (m: THREE.MeshStandardMaterial): boolean => !!m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.01;

/** The standard materials of a part, split into the lit body and the glowing (emissive) surfaces. */
export function partMaterials(part: THREE.Object3D): { body: THREE.MeshStandardMaterial[]; glow: THREE.MeshStandardMaterial[] } {
  const body = new Set<THREE.MeshStandardMaterial>();
  const glow = new Set<THREE.MeshStandardMaterial>();
  part.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    (isGlow(m) ? glow : body).add(m);
  });
  return { body: [...body], glow: [...glow] };
}

/** Net strength the look gives the lights (brightness x how much darkness is left), never fully zero so it can be undone. */
export const lookFactor = (look: { brightness: number; darkness: number }): number => Math.max(0.02, look.brightness * (1 - look.darkness * 0.9));

/**
 * Applies the remembered per-part edits and the whole-rig look (brightness, darkness, tint) to the materials. Every part starts
 * from the colours it was built with (or the user's edit), so moving a slider back always returns to the original.
 */
export function applyMaterialOverrides(group: THREE.Group, overrides: Record<string, MatOverride> | null): void {
  if (overrides === null) return;
  const look = useRigSetStore.getState().look;
  const tint = new THREE.Color(look.tint);
  const dark = 1 - look.darkness * 0.92;
  for (const part of group.children) {
    if (!part.userData.rigPart) continue;
    const ov = overrides[part.name] ?? {};
    const { body, glow } = partMaterials(part);
    for (const m of body) {
      const o = (m.userData.rigOrig ??= { color: m.color.clone(), roughness: m.roughness, metalness: m.metalness });
      const base = ov.color !== undefined ? new THREE.Color(ov.color) : (o.color as THREE.Color).clone();
      m.color.copy(base).lerp(tint, look.tintAmount).multiplyScalar(dark);
      m.roughness = ov.roughness ?? o.roughness;
      m.metalness = ov.metalness ?? o.metalness;
      m.needsUpdate = true;
    }
    for (const m of glow) {
      const o = (m.userData.rigOrig ??= { emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
      const base = ov.glowColor !== undefined ? new THREE.Color(ov.glowColor) : (o.emissive as THREE.Color).clone();
      m.emissive.copy(base).lerp(tint, look.tintAmount);
      m.emissiveIntensity = (ov.glow ?? o.intensity) * look.brightness * (1 - look.darkness * 0.5);
      m.needsUpdate = true;
    }
  }
}
