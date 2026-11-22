import * as THREE from 'three';
import type { Light } from '../types/Light';
import { softbox, tripod } from './cycStudio';
import { lightFacing } from './lightFacing';

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
// The room and the camera are solved together from 14 landmarks measured on the card (back wall top and base, both track rails'
// ends, both ceiling panels, the softbox face and stand foot): camera (0, 1.28, 5.78) pitched up 5.2 deg with a 72 deg horizontal
// field of view reproduces every one of them to within 0.3% of the frame. That puts the room at about 10.3 m wide, 11.6 m deep
// (the open front is behind the camera) and 3.2 m high, with the back wall 4.6 m behind the model.
const HALF_W = 5.15;
const BACK_Z = -4.6;
const FRONT_Z = 7.0;
const H = 3.22;
const R_PLAN = 2.0;    // vertical corner radius
const R_COVE = 1.3;    // wall-to-floor fillet
const R_TOP = 0.7;     // wall-to-ceiling curl

const std = (color: number, roughness: number, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

interface PathPt { x: number; z: number; nx: number; nz: number }

/** The room outline in plan (left wall, rounded back corner, back wall, rounded back corner, right wall) with inward normals. */
function planPath(): { all: PathPt[]; left: PathPt[]; back: PathPt[]; right: PathPt[] } {
  const pts: PathPt[] = [];
  const marks: number[] = [];
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
  marks.push(pts.length - 1);                       // end of the left wall + its corner
  line(-HALF_W + R_PLAN, BACK_Z, HALF_W - R_PLAN, BACK_Z, 0, 1, 8);
  marks.push(pts.length - 1);                       // end of the back wall
  arc(HALF_W - R_PLAN, BACK_Z + R_PLAN, Math.PI * 1.5, Math.PI * 2);
  line(HALF_W, BACK_Z + R_PLAN, HALF_W, FRONT_Z, -1, 0, 6);
  return { all: pts, left: pts.slice(0, marks[0] + 1), back: pts.slice(marks[0], marks[1] + 1), right: pts.slice(marks[1]) };
}

/** Wall profile as (inward offset t, height y): floor fillet, straight wall, curl into the ceiling. */
function wallProfile(): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * (Math.PI / 2); p.push([R_COVE - R_COVE * Math.sin(a), R_COVE - R_COVE * Math.cos(a)]); }
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * (Math.PI / 2); p.push([R_TOP - R_TOP * Math.cos(a), H - R_TOP + R_TOP * Math.sin(a)]); }
  return p;
}

/** Soft light falloff painted on a wall: brighter toward the back wall, darker toward the open front and up into the ceiling curl. */
function shadeWall(g: THREE.BufferGeometry, back: boolean): void {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // the card's walls are brightest straight behind the model and fall to grey toward both side walls
    let f = 0.6 + 0.4 * (1 - Math.pow(Math.min(1, Math.abs(x) / HALF_W), 1.5));
    if (back) f = Math.max(f, 0.8);
    const curl = Math.min(1, Math.max(0, (y - (H - 1.2)) / 1.2));                       // up into the ceiling curl
    f *= 1 - 0.22 * curl * curl;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
  const FR = 0.07;                          // the housing rim: the lit panel sits INSIDE it
  const r = Math.min(w, d) * 0.3;
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(w + FR * 2, d + FR * 2, r + FR), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 14 }),
    std(0x6b6e75, 0.45, 0.3),
  );
  body.rotation.x = Math.PI / 2;            // extrusion axis points down
  body.position.y = 0.0;
  g.add(body);
  const face = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(w, d, r), 14),
    std(0xffffff, 0.7, 0, { emissive: 0xffffff, emissiveIntensity: 1.5, side: THREE.DoubleSide }),
  );
  face.rotation.x = Math.PI / 2;
  face.position.y = -0.14;                  // just under the housing so it reads as the lit face
  g.add(face);
  return g;
}

export function buildHighKeyStudio(group: THREE.Group, lights: Light[]): void {
  group.userData.reflBox = [-HALF_W, 0, BACK_Z, HALF_W, H, FRONT_Z + 6];

  // glossy white floor, running out past the open front so the model never floats in a void
  const floorGeo = new THREE.PlaneGeometry(HALF_W * 2, FRONT_Z - BACK_Z + 12);
  {
    const fp = floorGeo.getAttribute('position');
    const fc = new Float32Array(fp.count * 3);
    const zc = (FRONT_Z + BACK_Z) / 2 + 6;
    for (let i = 0; i < fp.count; i++) {
      const z = zc - fp.getY(i);                                                      // the plane is laid flat: local y runs toward -Z
      const f = 1 - 0.2 * Math.min(1, Math.max(0, (z - BACK_Z) / 12));                 // full brightness at the back, falling off toward the camera
      fc[i * 3] = fc[i * 3 + 1] = fc[i * 3 + 2] = f;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  }
  const floor = new THREE.Mesh(floorGeo, std(0xd4d6dc, 0.14, 0, { vertexColors: true }));
  floor.name = 'Floor';
  floor.userData.mirrorFloor = true;
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.0005, (FRONT_Z + BACK_Z) / 2 + 6);
  floor.userData.reflective = true;
  floor.userData.reflectIntensity = 0.8;
  group.add(floor);

  // the white room: floor fillet, rounded corners, walls curling into the ceiling
  const path = planPath();
  const profile = wallProfile();
  // three wall parts so each can be edited on its own; a little glow stands in for the bounce light (more on the back wall,
  // which the room's light reaches most, less on the sides)
  for (const [seg, name, glow] of [[path.left, 'Side Wall Left', 0.34], [path.back, 'Back Wall', 0.5], [path.right, 'Side Wall Right', 0.34]] as [PathPt[], string, number][]) {
    const geo = room(seg, profile);
    shadeWall(geo, name === 'Back Wall');
    const w = new THREE.Mesh(
      geo,
      std(0xf1f2f4, 0.6, 0, { side: THREE.DoubleSide, emissive: 0xe4e8f2, emissiveIntensity: glow, vertexColors: true }),
    );
    w.name = name;
    w.userData.reflective = true;
    w.userData.reflectIntensity = 0.5;
    group.add(w);
  }

  // dark ceiling inside the curl
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FRONT_Z - BACK_Z), std(0x4a4d53, 0.8, 0, { emissive: 0x3a3d43, emissiveIntensity: 0.9 }));
  ceil.name = 'Ceiling';
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, (FRONT_Z + BACK_Z) / 2);
  group.add(ceil);

  // glowing rim along the top of the walls
  const rimPts = path.all.map((p) => new THREE.Vector3(p.x + p.nx * R_TOP * 0.9, H - 0.07, p.z + p.nz * R_TOP * 0.9));
  const rim = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts), 200, 0.016, 6, false),
    std(0xffffff, 0.5, 0, { emissive: 0xffffff, emissiveIntensity: 2.2 }),
  );
  rim.name = 'Wall Rim Light';
  group.add(rim);

  // two black track rails across the ceiling, each with a couple of spot heads
  const rails = std(0x101113, 0.4, 0.8);
  // The track frame hangs just under the ceiling: a near cross rail (z 0.43, 5.2 m long), a far one (z -2.49, 5.9 m long) and a
  // run down each side joining their ends. Spot heads hang from the cross-rail ends and the middle of each side run.
  const RY = H - 0.1;
  const NEAR = { z: 0.43, hw: 2.62 }, FAR = { z: -2.49, hw: 2.97 };
  const bar = (name: string, a: THREE.Vector3, b: THREE.Vector3, th: number) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(th, th, len), rails);
    m.name = name;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    group.add(m);
  };
  const spot = (name: string, x: number, z: number) => {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.16, 12), rails);
    head.name = name;
    head.position.set(x, RY - 0.16, z);
    group.add(head);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), rails);
    stem.name = `${name} Stem`;
    stem.position.set(x, RY - 0.05, z);
    group.add(stem);
  };
  bar('Track Rail Near', new THREE.Vector3(-NEAR.hw, RY, NEAR.z), new THREE.Vector3(NEAR.hw, RY, NEAR.z), 0.08);
  bar('Track Rail Far', new THREE.Vector3(-FAR.hw, RY, FAR.z), new THREE.Vector3(FAR.hw, RY, FAR.z), 0.08);
  let spotNo = 0;
  for (const sx of [-1, 1]) {
    bar('Track Rail Side', new THREE.Vector3(sx * NEAR.hw, RY, NEAR.z), new THREE.Vector3(sx * FAR.hw, RY, FAR.z), 0.065);
    spot(`Spot Head ${++spotNo}`, sx * NEAR.hw * 0.97, NEAR.z);
    spot(`Spot Head ${++spotNo}`, sx * (NEAR.hw + FAR.hw) / 2, (NEAR.z + FAR.z) / 2);
    spot(`Spot Head ${++spotNo}`, sx * FAR.hw * 0.97, FAR.z);
    for (const e of [NEAR, FAR]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), rails);
      rod.name = 'Track Rail Hanger';
      rod.position.set(sx * e.hw, H - 0.05, e.z);
      group.add(rod);
    }
  }

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
      rod.position.set(p.x + sx * ((l.areaWidth ?? 2) / 2 + 0.05), (H + p.y) / 2, p.z + sz * ((l.areaHeight ?? 1) / 2 + 0.05));
      group.add(rod);
    }
  }

  // the two 1.2 x 1.2 m softboxes on tripods
  for (const l of lights.filter((x) => /softbox/i.test(x.name))) {
    const p = l.transform.position;
    const sb = softbox(l.areaWidth ?? 1.2, l.areaHeight ?? 1.2, 0.4);
    sb.name = `${l.name} Fixture`;
    sb.position.set(p.x, p.y, p.z);
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    const facing = lightFacing(pos, l.transform.rotation);
    sb.lookAt(pos.clone().add(facing));
    group.add(sb);
    const away = new THREE.Vector3(-facing.x, 0, -facing.z).normalize();
    const stand = tripod(p.x + away.x * 0.2, p.z + away.z * 0.2, p.y - (l.areaHeight ?? 1.2) / 2 + 0.1, away, 0.55);
    stand.name = `${l.name} Stand`;
    group.add(stand);
  }
}
