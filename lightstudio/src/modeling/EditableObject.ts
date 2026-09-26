import * as THREE from 'three';
import { EditMesh, type V3 } from './EditMesh';
import { buildGeometry, disposeGeometry, enableAcceleratedRaycast } from './meshGeometry';

export interface EditableObjectJSON {
  id: string;
  name: string;
  co: V3[];
  faces: number[][];
  loose: number[];
  seam: number[];
  sharp: number[];
  smooth: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  material: { color: string; roughness: number; metalness: number; clearcoat: number; emissive: string; emissiveIntensity: number };
  visible: boolean;
}

let counter = 0;
export const newObjectId = (): string => `mesh_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** A mesh the user built with the modelling tools: EditMesh data + the THREE.Mesh that renders it. */
export class EditableObject {
  id: string;
  name: string;
  mesh: EditMesh;
  object: THREE.Mesh;
  triToFace: Int32Array = new Int32Array(0);
  private builtVersion = -1;

  constructor(name: string, mesh: EditMesh, id = newObjectId()) {
    this.id = id;
    this.name = name;
    this.mesh = mesh;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xc8c8cc,
      roughness: 0.5,
      metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.object = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.object.name = name;
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.userData.editableId = id;
    enableAcceleratedRaycast(this.object);
    this.rebuild(true);
  }

  get material(): THREE.MeshPhysicalMaterial {
    return this.object.material as THREE.MeshPhysicalMaterial;
  }

  setName(name: string): void {
    this.name = name;
    this.object.name = name;
  }

  /** Rebuild render geometry if the mesh changed since the last build. */
  rebuild(force = false): boolean {
    if (!force && this.builtVersion === this.mesh.version) return false;
    const old = this.object.geometry;
    const built = buildGeometry(this.mesh);
    this.object.geometry = built.geometry;
    this.triToFace = built.triToFace;
    this.builtVersion = this.mesh.version;
    disposeGeometry(old);
    return true;
  }

  dispose(): void {
    disposeGeometry(this.object.geometry);
    this.material.dispose();
  }

  toJSON(): EditableObjectJSON {
    const m = this.mesh;
    const mat = this.material;
    return {
      id: this.id,
      name: this.name,
      co: m.co.map((p) => [p[0], p[1], p[2]] as V3),
      faces: m.faces.map((f) => f.slice()),
      loose: Array.from(m.loose),
      seam: Array.from(m.seam),
      sharp: Array.from(m.sharp),
      smooth: m.smooth,
      position: this.object.position.toArray() as [number, number, number],
      rotation: [this.object.rotation.x, this.object.rotation.y, this.object.rotation.z],
      scale: this.object.scale.toArray() as [number, number, number],
      material: {
        color: '#' + mat.color.getHexString(),
        roughness: mat.roughness,
        metalness: mat.metalness,
        clearcoat: mat.clearcoat,
        emissive: '#' + mat.emissive.getHexString(),
        emissiveIntensity: mat.emissiveIntensity,
      },
      visible: this.object.visible,
    };
  }

  static fromJSON(j: EditableObjectJSON): EditableObject {
    const m = new EditMesh();
    m.co = j.co.map((p) => [p[0], p[1], p[2]] as V3);
    m.faces = j.faces.map((f) => f.slice());
    m.loose = new Set(j.loose);
    m.seam = new Set(j.seam);
    m.sharp = new Set(j.sharp);
    m.smooth = j.smooth;
    m.touch();
    const o = new EditableObject(j.name, m, j.id);
    o.object.position.fromArray(j.position);
    o.object.rotation.set(j.rotation[0], j.rotation[1], j.rotation[2]);
    o.object.scale.fromArray(j.scale);
    const mat = o.material;
    mat.color.set(j.material.color);
    mat.roughness = j.material.roughness;
    mat.metalness = j.material.metalness;
    mat.clearcoat = j.material.clearcoat;
    mat.emissive.set(j.material.emissive);
    mat.emissiveIntensity = j.material.emissiveIntensity;
    o.object.visible = j.visible;
    return o;
  }
}

/** Blender-style unique names: Cube, Cube.001, Cube.002 ... */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const set = new Set(existing);
  if (!set.has(base)) return base;
  let i = 1;
  for (;;) {
    const n = `${base}.${String(i).padStart(3, '0')}`;
    if (!set.has(n)) return n;
    i++;
  }
}
