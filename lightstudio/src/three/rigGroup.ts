import * as THREE from 'three';
import { objectKey } from './objectBinding';
import { useObjectHdriStore, defaultObjectHdri, type ObjectHdriSettings } from '../store/objectHdriStore';
import { disposeRigSet } from './rigSet';

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
