import * as THREE from 'three';
import type { Light } from '../types/Light';
import { softbox, tripod } from './cycStudio';

/**
 * The "High Key White" studio, built to the rig sheet: a white cyclorama room 6.0 m wide, 4.0 m deep and 3.0 m high with
 * every corner rounded (cove radius 1.0 m, vertical corners 1.0 m, the walls curling into a dark ceiling with a glowing
 * rim), a glossy white floor, a dark ceiling with two black track rails and spot heads, two rounded ceiling soft panels
 * (2.4 x 1.2 m and 1.8 x 1.0 m) and two 1.2 x 1.2 m softboxes on tripods at 45 degrees.
 *
 * Materials (colour / roughness / metalness), read off the reference:
 *   cyc walls     white painted, slightly glossy                 0xf1f2f4   rough 0.60  metal 0.00  (+ faint bounce glow)
 *   floor         polished white, soft reflections               0xe6e7ea   rough 0.16  metal 0.00
 *   ceiling       dark grey painted                               0x2c2d31   rough 0.80  metal 0.15
 *   rails         black steel                                     0x101113   rough 0.40  metal 0.80
 *   panel body    grey aluminium housing                          0x35373d   rough 0.50  metal 0.35
 *   panel face    opal diffuser, emissive                         0xffffff   rough 0.70  metal 0.00
 *   rim light     emissive LED line along the wall tops           0xffffff
 *
 * Coordinates: the model stands at the origin, the back wall is at -Z, the camera looks in from +Z through the open front.
 */
const HALF_W = 3.0;
const BACK_Z = -2.0;
const FRONT_Z = 2.0;
const H = 3.0;
const R_PLAN = 1.0;    // vertical corner radius
const R_COVE = 1.0;    // wall-to-floor fillet
const R_TOP = 0.8;     // wall-to-ceiling curl

const std = (color: number, roughness: number, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

interface PathPt { x: number; z: number; nx: number; nz: number }

/** The room outline in plan (left wall, rounded back corner, back wall, rounded back corner, right wall) with inward normals. */
function planPath(): PathPt[] {
  const pts: PathPt[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, n = 6) => {
    for (let i = 0; i <= n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz });
  };
  const arc = (cx: number, cz: number, a0: number, a1: number, n = 14) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + R_PLAN * Math.cos(a), z: cz + R_PLAN * Math.sin(a), nx: -Math.cos(a), nz: -Math.sin(a) });
    }
  };
  line(-HALF_W, FRONT_Z, -HALF_W, BACK_Z + R_PLAN, 1, 0, 6);
  arc(-HALF_W + R_PLAN, BACK_Z + R_PLAN, Math.PI, Math.PI * 1.5);
  line(-HALF_W + R_PLAN, BACK_Z, HALF_W - R_PLAN, BACK_Z, 0, 1, 8);
  arc(HALF_W - R_PLAN, BACK_Z + R_PLAN, Math.PI * 1.5, Math.PI * 2);
  line(HALF_W, BACK_Z + R_PLAN, HALF_W, FRONT_Z, -1, 0, 6);
  return pts;
}

/** Wall profile as (inward offset t, height y): floor fillet, straight wall, curl into the ceiling. */
function wallProfile(): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * (Math.PI / 2); p.push([R_COVE - R_COVE * Math.sin(a), R_COVE - R_COVE * Math.cos(a)]); }
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * (Math.PI / 2); p.push([R_TOP - R_TOP * Math.cos(a), H - R_TOP + R_TOP * Math.sin(a)]); }
  return p;
}

function room(path: PathPt[], profile: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const m = profile.length;
  for (const p of path) for (const [t, y] of profile) pos.push(p.x + p.nx * t, y, p.z + p.nz * t);
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = (i + 1) * m + j, c = a + 1, d = b + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** A rounded ceiling soft panel: grey housing with a glowing opal face looking down. */
function ceilingPanel(w: number, d: number, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const r = Math.min(w, d) * 0.22;
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 14 }),
    std(0x35373d, 0.5, 0.35),
  );
  body.rotation.x = Math.PI / 2;            // extrusion axis points down
  body.position.y = 0.0;
  g.add(body);
  const face = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(w - 0.12, d - 0.12, Math.max(0.05, r - 0.06)), 14),
    std(0xffffff, 0.7, 0, { emissive: 0xffffff, emissiveIntensity: 2.6, side: THREE.DoubleSide }),
  );
  face.rotation.x = Math.PI / 2;
  face.position.y = -0.14;                  // just under the housing so it reads as the lit face
  g.add(face);
  return g;
}

export function buildHighKeyStudio(group: THREE.Group, lights: Light[]): void {
  group.userData.reflBox = [-HALF_W, 0, BACK_Z, HALF_W, H, FRONT_Z + 6];

  // glossy white floor, running out past the open front so the model never floats in a void
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FRONT_Z - BACK_Z + 12), std(0xe6e7ea, 0.16, 0));
  floor.name = 'Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.002, (FRONT_Z + BACK_Z) / 2 + 6);
  floor.userData.reflective = true;
  floor.userData.reflectIntensity = 1.8;
  group.add(floor);

  // the white room: floor fillet, rounded corners, walls curling into the ceiling
  const path = planPath();
  const walls = new THREE.Mesh(
    room(path, wallProfile()),
    std(0xf1f2f4, 0.6, 0, { side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.03 }),   // a little glow stands in for the bounce light
  );
  walls.name = 'Cyc Walls';
  walls.userData.reflective = true;
  walls.userData.reflectIntensity = 0.5;
  group.add(walls);

  // dark ceiling inside the curl
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FRONT_Z - BACK_Z), std(0x2c2d31, 0.8, 0.15));
  ceil.name = 'Ceiling';
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, (FRONT_Z + BACK_Z) / 2);
  group.add(ceil);

  // glowing rim along the top of the walls
  const rimPts = path.map((p) => new THREE.Vector3(p.x + p.nx * R_TOP * 0.9, H - 0.07, p.z + p.nz * R_TOP * 0.9));
  const rim = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts), 160, 0.025, 6, false),
    std(0xffffff, 0.5, 0, { emissive: 0xffffff, emissiveIntensity: 4 }),
  );
  rim.name = 'Wall Rim Light';
  group.add(rim);

  // two black track rails across the ceiling, each with a couple of spot heads
  const rails = std(0x101113, 0.4, 0.8);
  [[-0.7, [-1.8, 1.4]], [0.75, [-1.2, 1.9]]].forEach(([z, xs], i) => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 - 0.4, 0.07, 0.09), rails);
    beam.name = `Track Rail ${i + 1}`;
    beam.position.set(0, H - 0.1, z as number);
    group.add(beam);
    (xs as number[]).forEach((x, k) => {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.16, 12), rails);
      head.name = `Spot Head ${i * 2 + k + 1}`;
      head.position.set(x, H - 0.24, z as number);
      group.add(head);
    });
  });

  // the two ceiling soft panels (placed from the rig's own lights)
  for (const l of lights) {
    if (!/ceiling panel/i.test(l.name)) continue;
    const p = l.transform.position;
    const panel = ceilingPanel(l.areaWidth ?? 2, l.areaHeight ?? 1, `${l.name} Fixture`);
    panel.position.set(p.x, p.y, p.z);
    group.add(panel);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                // four hangers to the ceiling
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, H - p.y, 6), rails);
      rod.name = `${l.name} Hanger`;
      rod.position.set(p.x + sx * ((l.areaWidth ?? 2) / 2 - 0.2), (H + p.y) / 2, p.z + sz * ((l.areaHeight ?? 1) / 2 - 0.15));
      group.add(rod);
    }
  }

  // the two 1.2 x 1.2 m softboxes on tripods
  for (const l of lights.filter((x) => /softbox/i.test(x.name))) {
    const p = l.transform.position;
    const sb = softbox(l.areaWidth ?? 1.2, l.areaHeight ?? 1.2);
    sb.name = `${l.name} Fixture`;
    sb.position.set(p.x, p.y, p.z);
    sb.lookAt(0, Math.min(1.3, p.y), 0);
    group.add(sb);
    const away = new THREE.Vector3(p.x, 0, p.z).normalize();
    const stand = tripod(p.x + away.x * 1.05, p.z + away.z * 1.05, p.y - 0.1, away);
    stand.name = `${l.name} Stand`;
    group.add(stand);
  }
}
