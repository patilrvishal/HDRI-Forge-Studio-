import * as THREE from 'three';
import type { RigSetKind } from '../data/rigSets';

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

function keepOutOfPicking(obj: THREE.Object3D): void {
  // The set is scenery: clicks, LightPaint and material picking must go through it to the model.
  obj.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });
}

/**
 * Builds the studio set for a rig as plain meshes, so the viewport (and the path tracer) show the same room as the card.
 * Everything sits on y = 0, the model's ground.
 */
export function buildRigSet(kind: RigSetKind): THREE.Group {
  const group = new THREE.Group();
  group.name = RIG_SET_NAME;
  group.userData.rigSet = kind;

  if (kind === 'cyc_white') {
    // White infinity cove: floor curving up into the back wall (back = -Z, where the rig's Back Wall light is).
    const R = 2.6, floorFront = 9, wallZ = -8, wallTop = 11;
    const profile: [number, number][] = [[floorFront, 0], [wallZ + R, 0]];
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      profile.push([wallZ + R - Math.sin(a) * R, R - Math.cos(a) * R]);
    }
    profile.push([wallZ, wallTop]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2f3f6, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    const cyc = new THREE.Mesh(sweepProfile(profile, 12), mat);
    cyc.receiveShadow = true;
    group.add(cyc);
  } else {
    // Dark studio: a glossy black floor that mirrors the panels.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 96),
      new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.16, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    group.add(floor);
  }
  keepOutOfPicking(group);
  return group;
}

export function disposeRigSet(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
}
