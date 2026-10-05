import * as THREE from 'three';

type EmissiveMaterial = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };

interface Applied {
  mesh: THREE.Mesh;
  /** Original material(s) when we swapped in clones. */
  original: THREE.Material | THREE.Material[] | null;
  /** Original emissive values when we edited an owned material in place. */
  saved: { emissive: THREE.Color; intensity: number }[] | null;
  key: string;
}

const hasEmissive = (m: THREE.Material): m is EmissiveMaterial => 'emissive' in m && (m as EmissiveMaterial).emissive instanceof THREE.Color;

/**
 * Makes objects visibly glow when they are used as lights. Materials that
 * belong to a modelled mesh are edited in place (and restored); materials of
 * imported models are cloned so other meshes sharing them don't glow too.
 */
export class ObjectEmitters {
  private applied = new Map<string, Applied>();

  apply(root: THREE.Object3D, key: string, color: THREE.Color, intensity: number): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o.userData?.isHelper || o.userData?.isProxy) return;
      let entry = this.applied.get(mesh.uuid);
      if (!entry || entry.key !== key) {
        if (entry) this.restore(entry);
        entry = this.attach(mesh, key);
        this.applied.set(mesh.uuid, entry);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || !hasEmissive(m)) continue;
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      }
    });
  }

  private attach(mesh: THREE.Mesh, key: string): Applied {
    const owned = !!mesh.userData?.editableId;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (owned) {
      return {
        mesh,
        original: null,
        saved: mats.map((m) => (m && hasEmissive(m) ? { emissive: m.emissive.clone(), intensity: m.emissiveIntensity } : { emissive: new THREE.Color(0, 0, 0), intensity: 1 })),
        key,
      };
    }
    const original = mesh.material;
    const clones = mats.map((m) => (m ? m.clone() : m));
    mesh.material = Array.isArray(original) ? clones : clones[0];
    return { mesh, original, saved: null, key };
  }

  private restore(e: Applied): void {
    if (e.original) {
      const cur = Array.isArray(e.mesh.material) ? e.mesh.material : [e.mesh.material];
      e.mesh.material = e.original;
      for (const m of cur) m?.dispose();
    } else if (e.saved) {
      const mats = Array.isArray(e.mesh.material) ? e.mesh.material : [e.mesh.material];
      mats.forEach((m, i) => {
        if (m && hasEmissive(m) && e.saved![i]) {
          m.emissive.copy(e.saved![i].emissive);
          m.emissiveIntensity = e.saved![i].intensity;
        }
      });
    }
  }

  /** Stop glowing for every key that is not in `active`. */
  keepOnly(active: Set<string>): void {
    for (const [id, e] of Array.from(this.applied)) {
      if (!active.has(e.key) || !e.mesh.parent) {
        this.restore(e);
        this.applied.delete(id);
      }
    }
  }

  releaseAll(): void {
    for (const e of this.applied.values()) this.restore(e);
    this.applied.clear();
  }
}
