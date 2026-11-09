import * as THREE from 'three';
import type { RigSetKind } from '../data/rigSets';
import type { Light } from '../types/Light';
import { buildCycStudio } from './cycStudio';
import { buildStripTunnel } from './tunnelStudio';
import { buildHighKeyStudio } from './highKeyStudio';
import { disposeSetReflections } from './setReflections';

export const RIG_SET_NAME = 'StudioRigSet';

/** Sweep a (z, y) profile along X into a surface (used for the curved cyc wall). */
function sweepProfile(profile: [number, number][], halfWidth: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [z, y] = profile[i];
    pos.push(-halfWidth, y, z, halfWidth, y, z);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const METAL = () => new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.45, metalness: 0.7 });

/**
 * One physical light fixture, like the ones drawn on the rig cards: a glowing face, a dark stepped housing behind it
 * and, for lights at working height, a stand with a tripod base. The face looks at the model.
 */
function buildFixture(l: Light, set: THREE.Group): void {
  const p = l.transform.position;
  const w = Math.max(0.12, l.areaWidth ?? 1);
  const h = Math.max(0.12, l.areaHeight ?? 1);
  const col = new THREE.Color(l.color || '#ffffff');

  const fx = new THREE.Group();
  fx.name = `${l.name} Fixture`;
  fx.position.set(p.x, p.y, p.z);
  fx.lookAt(0, Math.min(1, Math.max(0, p.y * 0.2)), 0);           // +Z (the face) toward the model

  // glowing face (pushed a hair forward so it never fights the light's own helper card)
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(1, 1, 1), 0.55), toneMapped: false, side: THREE.DoubleSide }),
  );
  face.position.z = 0.03;
  fx.add(face);

  // dark rim around the face
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.1, h + 0.1), new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
  rim.position.z = 0.02;
  fx.add(rim);

  // stepped housing behind the face (a softbox shell)
  const depth = Math.min(0.9, Math.max(0.16, 0.22 * Math.max(w, h)));
  const shell1 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, h * 0.98, depth * 0.55), METAL());
  shell1.position.z = -depth * 0.275;
  const shell2 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, h * 0.62, depth * 0.55), METAL());
  shell2.position.z = -depth * 0.55 - depth * 0.275;
  fx.add(shell1, shell2);
  set.add(fx);

  // stand with a tripod base for lights at working height (not for ceiling lights)
  if (p.y > 0.5 && p.y < 4.6) {
    const bottom = Math.max(0.05, p.y - h / 2 - 0.05);
    const dir = new THREE.Vector3(p.x, 0, p.z);
    if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, -1);
    const sx = p.x + dir.x * (depth + 0.15), sz = p.z + dir.z * (depth + 0.15);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bottom, 10), METAL());
    pole.position.set(sx, bottom / 2, sz);
    set.add(pole);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.atan2(dir.x, dir.z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.75, 8), METAL());
      leg.position.set(sx + Math.sin(a) * 0.3, 0.2, sz + Math.cos(a) * 0.3);
      leg.lookAt(sx, 0.55, sz);
      leg.rotateX(Math.PI / 2);
      set.add(leg);
    }
  }
}

/**
 * Builds the physical studio set for a rig: the room (glossy black floor, or the white infinity cove) plus a real fixture
 * at every light of the rig, so the viewport shows what the card shows. Everything sits on y = 0.
 */
export function buildRigSet(kind: RigSetKind, lights: Light[]): THREE.Group {
  const group = new THREE.Group();
  group.name = RIG_SET_NAME;
  group.userData.rigSet = kind;

  if (kind === 'high_key') {
    buildHighKeyStudio(group, lights);
    group.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });
    return group;
  }
  if (kind === 'strip_tunnel') {
    buildStripTunnel(group, lights);
    group.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });
    return group;
  }
  if (kind === 'cyc_white') {
    // The full Cyc Wall White studio from the rig sheet (cyclorama, truss ceiling with panel row, softboxes on tripods).
    buildCycStudio(group, lights);
    group.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });
    return group;
  } else {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 96),
      new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.16, metalness: 0.05 }),
    );
    floor.name = 'Floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    group.add(floor);
  }

  for (const l of lights) {
    if (!(l.type === 'area' || l.areaLight)) continue;
    buildFixture(l, group);
  }

  // scenery: clicks, LightPaint and material picking must go through it to the model
  group.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });
  return group;
}

export function disposeRigSet(group: THREE.Object3D): void {
  disposeSetReflections(group);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
}
