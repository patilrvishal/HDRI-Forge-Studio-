import * as THREE from 'three';

export type PaintMode = 'reflection' | 'illumination' | 'shade' | 'rim' | 'shadow';

export const PAINT_MODES: Array<{ id: PaintMode; label: string; hint: string }> = [
  { id: 'reflection', label: 'Reflection', hint: 'Light appears in the reflection at the clicked point. Best for chrome and car paint.' },
  { id: 'illumination', label: 'Illumination', hint: 'Light faces the clicked point head-on. Best for matte surfaces.' },
  { id: 'shade', label: 'Shade', hint: 'Light moves to the opposite side, putting the clicked point in shadow.' },
  { id: 'rim', label: 'Rim', hint: 'Ignores the model. Places the light behind the scene along the camera ray.' },
  { id: 'shadow', label: 'Shadow', hint: 'Pivots the light so its shadow falls on the clicked point.' },
];

export interface PaintResult {
  position: THREE.Vector3;
  /** Euler angles in DEGREES, already aimed at the target. */
  rotation: { x: number; y: number; z: number };
}

/**
 * Distance a light should sit from the scene centre.
 *
 * HDR Light Studio places lights out at the environment boundary, not at a fixed
 * offset from the surface. A hardcoded offset breaks the moment the model's scale
 * changes - a 5-unit offset is enormous on a 2-unit model and lands *inside* a
 * 400-unit one. Deriving it from the scene's own bounding sphere makes LightPaint
 * scale-independent.
 *
 * @param distanceScale - user multiplier (Smart Dolly). 1.0 = at the boundary.
 */
export function computeLightDistance(
  scene: THREE.Scene,
  distanceScale = 1.0,
): { center: THREE.Vector3; distance: number } {
  const box = new THREE.Box3();

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.userData?.isHelper || obj.userData?.isProxy) return;
    if (obj.name === '__floor__') return;

    // Skip anything absurdly large. The grid, the fade overlay, and any backdrop
    // plane are hundreds of thousands of units across - letting one into the
    // bounding box drags the radius to ~74,000 and hurls the light to infinity.
    const b = new THREE.Box3().setFromObject(obj);
    const s = b.getSize(new THREE.Vector3());
    const maxDim = Math.max(s.x, s.y, s.z);
    if (!isFinite(maxDim) || maxDim > 500) return;

    box.expandByObject(obj);
  });

  if (box.isEmpty()) {
    return { center: new THREE.Vector3(0, 0, 0), distance: 5 * distanceScale };
  }

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  // 2.5x the model radius puts the light clearly outside the object but still
  // close enough that its size reads in the reflection.
  const distance = Math.max(0.5, sphere.radius * 2.5 * distanceScale);

  return { center: sphere.center.clone(), distance };
}

/** Look-at helper: build the Euler (in degrees) that aims `from` at `at`. */
function aimAt(from: THREE.Vector3, at: THREE.Vector3): { x: number; y: number; z: number } {
  const o = new THREE.Object3D();
  o.position.copy(from);
  o.lookAt(at);
  return {
    x: (o.rotation.x * 180) / Math.PI,
    y: (o.rotation.y * 180) / Math.PI,
    z: (o.rotation.z * 180) / Math.PI,
  };
}

/**
 * Work out where the light goes for a LightPaint click.
 *
 * @param mode     - which LightPaint method
 * @param P        - world-space hit point on the model (ignored in 'rim')
 * @param N        - world-space SMOOTH surface normal at P
 * @param camera   - the viewport camera
 * @param center   - scene bounding-sphere centre
 * @param distance - how far the light sits from `center`
 * @param pivot    - for 'shadow': the point the light was previously painted to
 */
export function solveLightPaint(
  mode: PaintMode,
  P: THREE.Vector3,
  N: THREE.Vector3,
  camera: THREE.Camera,
  center: THREE.Vector3,
  distance: number,
  pivot?: THREE.Vector3,
): PaintResult {
  switch (mode) {
    case 'reflection': {
      // Mirror the view ray about the surface normal. Anything sitting along the
      // reflected ray is what the camera sees mirrored at P.
      const V = P.clone().sub(camera.position).normalize();
      const R = V.clone().sub(N.clone().multiplyScalar(2 * V.dot(N))).normalize();
      const pos = P.clone().add(R.multiplyScalar(distance));
      return { position: pos, rotation: aimAt(pos, P) };
    }

    case 'illumination': {
      // Straight out along the normal - the light faces the surface head-on, so
      // this point receives the most light. Note this is NOT where the reflection
      // will appear; the two modes place the light in genuinely different spots.
      const pos = P.clone().add(N.clone().multiplyScalar(distance));
      return { position: pos, rotation: aimAt(pos, P) };
    }

    case 'shade': {
      // Normal, but the other way: the clicked point ends up facing away from the
      // light and falls into shadow.
      const pos = P.clone().sub(N.clone().multiplyScalar(distance));
      return { position: pos, rotation: aimAt(pos, P) };
    }

    case 'rim': {
      // Model is ignored entirely. Ride the camera ray straight through the scene
      // and out the back, so the light sits behind the subject.
      const dir = P.clone().sub(camera.position).normalize();
      const pos = center.clone().add(dir.multiplyScalar(distance));
      return { position: pos, rotation: aimAt(pos, center) };
    }

    case 'shadow': {
      // Pivot around the point the light was last painted onto, and swing the
      // light so its shadow is cast toward the newly clicked point.
      const anchor = pivot ?? center;
      const dir = anchor.clone().sub(P).normalize();
      const pos = anchor.clone().add(dir.multiplyScalar(distance));
      return { position: pos, rotation: aimAt(pos, anchor) };
    }

    default: {
      const pos = P.clone().add(N.clone().multiplyScalar(distance));
      return { position: pos, rotation: aimAt(pos, P) };
    }
  }
}

/**
 * Interpolated (smooth) surface normal at a raycast hit, in world space.
 *
 * The flat face normal is not what the shader reflects off - it uses the smooth
 * per-vertex normal. Placing a light using the face normal therefore puts the
 * highlight in a visibly different spot than the one that was clicked.
 */
export function smoothNormalAt(hit: THREE.Intersection): THREE.Vector3 {
  const N = new THREE.Vector3(0, 1, 0);
  const face = hit.face;
  const mesh = hit.object as THREE.Mesh;
  const geom = mesh.geometry as THREE.BufferGeometry;

  if (!face) return N;

  const nAttr = geom?.getAttribute('normal');
  const pAttr = geom?.getAttribute('position');

  if (nAttr && pAttr) {
    const nA = new THREE.Vector3().fromBufferAttribute(nAttr, face.a);
    const nB = new THREE.Vector3().fromBufferAttribute(nAttr, face.b);
    const nC = new THREE.Vector3().fromBufferAttribute(nAttr, face.c);

    const vA = new THREE.Vector3().fromBufferAttribute(pAttr, face.a);
    const vB = new THREE.Vector3().fromBufferAttribute(pAttr, face.b);
    const vC = new THREE.Vector3().fromBufferAttribute(pAttr, face.c);

    const localP = mesh.worldToLocal(hit.point.clone());
    const bary = new THREE.Vector3();
    THREE.Triangle.getBarycoord(localP, vA, vB, vC, bary);

    N.set(0, 0, 0)
      .addScaledVector(nA, bary.x)
      .addScaledVector(nB, bary.y)
      .addScaledVector(nC, bary.z);

    if (N.lengthSq() < 1e-8) N.copy(face.normal);
  } else {
    N.copy(face.normal);
  }

  N.transformDirection(mesh.matrixWorld).normalize();
  return N;
}
