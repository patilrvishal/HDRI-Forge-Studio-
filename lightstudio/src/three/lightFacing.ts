import * as THREE from 'three';

/** Direction an area light emits: its own -Z turned by its manual rotation, or toward the model when it is not rotated by hand. */
export function lightFacing(position: THREE.Vector3, rotation?: { enabled?: boolean; x: number; y: number; z: number }): THREE.Vector3 {
  if (rotation?.enabled) {
    const e = new THREE.Euler((rotation.x * Math.PI) / 180, (rotation.y * Math.PI) / 180, (rotation.z * Math.PI) / 180);
    return new THREE.Vector3(0, 0, -1).applyEuler(e).normalize();
  }
  return position.clone().negate().normalize();
}
