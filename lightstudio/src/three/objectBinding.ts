import * as THREE from 'three';

/**
 * Binding between a scene object and a light / HDRI setting.
 *
 * Objects imported from a GLB get new UUIDs on every load, so bindings are
 * keyed by something that survives a reload: the id of a modelled mesh, or
 * the chain of node names from the model root for imported meshes.
 */
export function objectKey(obj: THREE.Object3D): string {
  const editableId = obj.userData?.editableId as string | undefined;
  if (editableId) return 'e:' + editableId;
  const names: string[] = [];
  let cur: THREE.Object3D | null = obj;
  while (cur && cur.type !== 'Scene') {
    let label = cur.name || cur.type;
    // Siblings with the same (or no) name are told apart by their order.
    const parent: THREE.Object3D | null = cur.parent;
    if (parent && parent.type !== 'Scene') {
      const same = parent.children.filter((c) => (c.name || c.type) === label);
      if (same.length > 1) label += '#' + same.indexOf(cur);
    }
    names.push(label);
    cur = parent;
  }
  return 'n:' + names.reverse().join('/');
}

export function findObjectByKey(scene: THREE.Scene, key: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if (found || o.userData?.isHelper || o.userData?.isProxy || (o as THREE.Light).isLight) return;
    if (objectKey(o) === key) found = o;
  });
  return found;
}

export type EmitterSide = 'auto' | '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface EmitterRect {
  center: THREE.Vector3;
  /** Direction light is emitted (out of the chosen face). */
  normal: THREE.Vector3;
  /** Vector along the rectangle's width. */
  right: THREE.Vector3;
  /** Vector along the rectangle's height. */
  up: THREE.Vector3;
  width: number;
  height: number;
}

const _tmp = new THREE.Vector3();

function meshesOf(obj: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !o.userData?.isHelper && !o.userData?.isProxy && m.geometry) out.push(m);
  });
  return out;
}

/**
 * The rectangle an object presents as a light: the box face pointing at
 * `focus` (or the explicit side). A single mesh uses its own oriented bounding
 * box, so a rotated plane or softbox lights exactly along its own face; a group
 * of meshes uses the world-aligned box.
 */
export function computeEmitterRect(obj: THREE.Object3D, focus: THREE.Vector3, side: EmitterSide = 'auto'): EmitterRect | null {
  obj.updateWorldMatrix(true, true);
  const meshes = meshesOf(obj);
  if (!meshes.length) return null;

  let center: THREE.Vector3;
  let axes: THREE.Vector3[];
  let half: number[];

  if (meshes.length === 1) {
    const mesh = meshes[0];
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const m = mesh.matrixWorld;
    axes = [0, 1, 2].map((i) => new THREE.Vector3().setFromMatrixColumn(m, i));
    const scales = axes.map((a) => a.length());
    axes = axes.map((a, i) => (scales[i] > 1e-9 ? a.clone().divideScalar(scales[i]) : a));
    const size = bb.getSize(new THREE.Vector3());
    half = [0, 1, 2].map((i) => Math.max(1e-4, (size.getComponent(i) * scales[i]) / 2));
    center = bb.getCenter(new THREE.Vector3()).applyMatrix4(m);
  } else {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    center = box.getCenter(new THREE.Vector3());
    axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    half = [Math.max(1e-4, size.x / 2), Math.max(1e-4, size.y / 2), Math.max(1e-4, size.z / 2)];
  }

  // Pick the face.
  let axis = 0;
  let sign = 1;
  if (side === 'auto') {
    const toFocus = _tmp.copy(focus).sub(center);
    let best = -Infinity;
    for (let i = 0; i < 3; i++) {
      const d = axes[i].dot(toFocus);
      for (const s of [1, -1]) {
        const score = s * d;
        if (score > best) {
          best = score;
          axis = i;
          sign = s;
        }
      }
    }
  } else {
    axis = side[1] === 'x' ? 0 : side[1] === 'y' ? 1 : 2;
    sign = side[0] === '+' ? 1 : -1;
  }

  const normal = axes[axis].clone().multiplyScalar(sign);
  const faceCenter = center.clone().addScaledVector(normal, half[axis]);

  // Height axis: the in-plane axis closest to world up (world Z if the face looks up/down).
  const others = [0, 1, 2].filter((i) => i !== axis);
  const worldUp = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const upIdx = Math.abs(axes[others[0]].dot(worldUp)) >= Math.abs(axes[others[1]].dot(worldUp)) ? others[0] : others[1];
  const rightIdx = others[0] === upIdx ? others[1] : others[0];
  let up = axes[upIdx].clone();
  if (up.dot(worldUp) < 0) up.negate();
  // Right-handed light basis: local +Z = -normal, X = up x Z
  const z = normal.clone().negate();
  const right = new THREE.Vector3().crossVectors(up, z).normalize();
  up = new THREE.Vector3().crossVectors(z, right).normalize();

  return {
    center: faceCenter,
    normal,
    right,
    up,
    width: half[rightIdx] * 2,
    height: half[upIdx] * 2,
  };
}
