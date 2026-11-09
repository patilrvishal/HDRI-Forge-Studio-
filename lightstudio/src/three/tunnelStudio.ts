import * as THREE from 'three';
import type { Light } from '../types/Light';

/**
 * The "Strip Tunnel" studio, built to the rig sheet: a dark linear tunnel 6.0 m wide and 3.0 m high with a charcoal cyc cove
 * at the far end (1.0 m radius), a polished concrete floor, a dark steel ceiling and a row of LED strip lights hung
 * across it. Each strip is a real emissive fixture (aluminium housing, glowing diffuser), so it lights the room and
 * reflects in the floor in the path tracer.
 *
 * Coordinates: the model stands at the origin, the far wall is at -Z, the camera looks in from +Z.
 */
const HALF_W = 3.0;
const H = 3.0;
const WALL_Z = -4.0;
const FRONT_Z = 4.0;
const R = 1.0;

const std = (color: number, roughness: number, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function sweep(profile: [number, number][], halfWidth: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
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

function stripFixture(len: number, wid: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.05, 0.06, len + 0.06), std(0x16171b, 0.4, 0.8));
  housing.position.y = 0.03;
  g.add(housing);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.07, 0.012, len + 0.08), std(0x2a2c32, 0.3, 0.9));
  lip.position.y = -0.002;
  g.add(lip);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(wid, len),
    std(0xffffff, 0.8, 0, { emissive: color.clone().lerp(new THREE.Color(1, 1, 1), 0.7), emissiveIntensity: 9.0, side: THREE.DoubleSide }),
  );
  face.rotation.x = Math.PI / 2;                              // glows downward
  face.position.y = -0.012;
  g.add(face);
  for (const s of [-1, 1]) {                                    // end caps
    const cap = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.07, 0.07, 0.03), std(0x0d0e10, 0.5, 0.6));
    cap.position.set(0, 0.025, s * (len / 2 + 0.035));
    g.add(cap);
  }
  return g;
}

export function buildStripTunnel(group: THREE.Group, lights: Light[]): void {
  // floor: polished concrete (dark, glossy)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 0.01, FRONT_Z - WALL_Z), std(0x5b5d63, 0.3, 0.0));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.002, (FRONT_Z + WALL_Z) / 2);
  group.add(floor);
  // beyond the opening, so the model never floats in a void
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), std(0x1c1d20, 0.5, 0));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0, FRONT_Z + 15);
  group.add(apron);

  // far wall: charcoal cyc with a 1 m cove into the floor
  const profile: [number, number][] = [[FRONT_Z - 0.0, 0.004], [WALL_Z + R, 0.004]];
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    profile.push([WALL_Z + R - Math.sin(a) * R, R - Math.cos(a) * R + 0.004]);
  }
  profile.push([WALL_Z, H]);
  const cyc = new THREE.Mesh(sweep(profile, HALF_W), std(0x44454a, 0.85, 0, { side: THREE.DoubleSide }));
  group.add(cyc);

  // side walls: dark panelled steel, with vertical panel seams
  const wallMat = std(0x303136, 0.75, 0.2);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(FRONT_Z - WALL_Z, H), wallMat);
    w.position.set(sx * HALF_W, H / 2, (FRONT_Z + WALL_Z) / 2);
    w.rotation.y = -sx * Math.PI / 2;
    group.add(w);
    for (let z = WALL_Z + 1.5; z < FRONT_Z; z += 1.5) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, H, 0.03), std(0x0b0b0d, 0.6, 0.5));
      seam.position.set(sx * (HALF_W - 0.01), H / 2, z);
      group.add(seam);
    }
  }
  // ceiling and two steel beams
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FRONT_Z - WALL_Z), std(0x1a1b1f, 0.9, 0.2));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, (FRONT_Z + WALL_Z) / 2);
  group.add(ceil);
  for (const z of [-2.6, 2.4]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.16, 0.12), std(0x111216, 0.45, 0.85));
    beam.position.set(0, H - 0.08, z);
    group.add(beam);
  }

  // the LED strips, placed from the rig's own lights (hung just under the ceiling)
  for (const l of lights) {
    if (!/strip/i.test(l.name)) continue;
    const p = l.transform.position;
    const fx = stripFixture(l.areaHeight ?? 2.0, l.areaWidth ?? 0.15, new THREE.Color(l.color || '#ffffff'));
    fx.position.set(p.x, p.y, p.z);
    group.add(fx);
    for (const dz of [-0.7, 0.7]) {                             // two short hangers to the ceiling
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, H - p.y - 0.02, 6), std(0x0a0a0c, 0.5, 0.8));
      rod.position.set(p.x, (H + p.y) / 2 + 0.03, p.z + dz);
      group.add(rod);
    }
  }
}
