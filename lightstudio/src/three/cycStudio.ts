import * as THREE from 'three';
import type { Light } from '../types/Light';

/**
 * The "Cyc Wall White" studio, built to the rig sheet: a 6.0 m wide cyclorama (3.0 m high, 1.0 m cove radius) in a dark
 * studio with a steel-truss ceiling carrying a row of four panel lights, polished concrete floor, and two 1.2 x 1.2 m
 * softboxes on tripods either side at 45 degrees. Real PBR materials throughout, so it reads in the raster viewport and
 * in the path tracer (emissive faces, not unlit colours).
 *
 * Coordinates: the model stands at the origin, the cyc wall is behind it (-Z), the camera looks from +Z.
 */
const WALL_Z = -3.2;      // the cyc wall plane
const CYC_HALF = 3.0;     // width 6.0 m
const CYC_H = 3.0;
const CYC_R = 1.0;
const CEIL_Y = 3.6;

const std = (color: number, roughness: number, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function sweep(profile: [number, number][], halfWidth: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [z, y] = profile[i];
    pos.push(-halfWidth, y, z, halfWidth, y, z);
    uv.push(0, i / (n - 1), 1, i / (n - 1));
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hollow tapered box (the softbox shell): front w x h, back bw x bh, depth along -Z. */
function taperedShell(w: number, h: number, bw: number, bh: number, depth: number): THREE.BufferGeometry {
  const f = [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]];
  const b = [[-bw / 2, -bh / 2, -depth], [bw / 2, -bh / 2, -depth], [bw / 2, bh / 2, -depth], [-bw / 2, bh / 2, -depth]];
  const pos: number[] = [];
  [...f, ...b].forEach((v) => pos.push(v[0], v[1], v[2]));
  const idx: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(i, j, 4 + j, i, 4 + j, 4 + i);
  }
  idx.push(4, 6, 5, 4, 7, 6);                               // back plate
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function softbox(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const shellMat = std(0x0c0d0f, 0.62, 0.15, { side: THREE.DoubleSide });
  const depth = 0.85;
  g.add(new THREE.Mesh(taperedShell(w, h, w * 0.28, h * 0.28, depth), shellMat));

  // front frame (the rim the diffuser is stretched over)
  const t = 0.035;
  for (const [fw, fh, x, y] of [[w, t, 0, h / 2], [w, t, 0, -h / 2], [t, h, w / 2, 0], [t, h, -w / 2, 0]] as [number, number, number, number][]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.04), std(0x17181b, 0.4, 0.6));
    bar.position.set(x, y, 0.005);
    g.add(bar);
  }
  // diffuser: glows, with a fabric-like slightly rough surface
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.02, h - 0.02),
    std(0xffffff, 0.85, 0, { emissive: 0xffffff, emissiveIntensity: 2.2 }),
  );
  face.position.z = 0.008;
  g.add(face);
  // inner baffle ghosting behind the diffuser
  const baffle = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.82), std(0xffffff, 0.9, 0, { emissive: 0xffffff, emissiveIntensity: 1.1, transparent: true, opacity: 0.0 }));
  baffle.position.z = -0.12;
  g.add(baffle);
  // speed ring and head
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 24), std(0x1b1c20, 0.35, 0.8));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -depth - 0.04;
  g.add(ring);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.22, 20), std(0x24262b, 0.4, 0.7));
  head.rotation.x = Math.PI / 2;
  head.position.z = -depth - 0.2;
  g.add(head);
  return g;
}

export function tripod(x: number, z: number, topY: number, outFrom: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const metal = std(0x14151a, 0.38, 0.85);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, topY, 14), metal);
  col.position.set(x, topY / 2, z);
  g.add(col);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 14), metal);
  hub.position.set(x, 0.62, z);
  g.add(hub);
  const base = Math.atan2(outFrom.x, outFrom.z);
  for (let i = 0; i < 3; i++) {
    const a = base + (i / 3) * Math.PI * 2 + Math.PI / 3;
    const fx = x + Math.sin(a) * 0.78, fz = z + Math.cos(a) * 0.78;
    const len = Math.hypot(fx - x, 0.62, fz - z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 8), metal);
    leg.position.set((x + fx) / 2, 0.31, (z + fz) / 2);
    leg.lookAt(fx, 0, fz);
    leg.rotateX(Math.PI / 2);
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), std(0x050506, 0.9));
    foot.position.set(fx, 0.02, fz);
    g.add(foot);
  }
  return g;
}

export function buildCycStudio(group: THREE.Group, lights: Light[]): void {
  // ── floor: polished concrete everywhere, white sweep in front of the cyc ────────────────────
  const concrete = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), std(0x74767b, 0.34, 0.0));
  concrete.name = 'Floor';
  concrete.rotation.x = -Math.PI / 2;
  concrete.position.set(0, 0.0, -5);
  group.add(concrete);

  // ── cyclorama: floor sweep + 1 m cove + wall, 6 m wide, matte white ─────────────────────────
  const profile: [number, number][] = [[3.2, 0.004], [WALL_Z + CYC_R, 0.004]];
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    profile.push([WALL_Z + CYC_R - Math.sin(a) * CYC_R, CYC_R - Math.cos(a) * CYC_R + 0.004]);
  }
  profile.push([WALL_Z, CYC_H]);
  const cyc = new THREE.Mesh(sweep(profile, CYC_HALF), std(0xeeeeee, 0.78, 0, { side: THREE.DoubleSide }));
  cyc.name = 'Cyclorama';
  cyc.receiveShadow = true;
  group.add(cyc);

  // ── room: charcoal side walls, back wall above and around the cyc, ceiling ──────────────────
  const wallMat = std(0x1b1c1f, 0.9);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(16, CEIL_Y), wallMat);
    w.position.set(sx * 4.4, CEIL_Y / 2, -2);
    w.rotation.y = -sx * Math.PI / 2;
    group.add(w);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, CEIL_Y), wallMat);
  back.position.set(0, CEIL_Y / 2, WALL_Z - 0.05);
  group.add(back);
  // dark returns beside the cyc so its edges read as a free-standing sweep
  for (const sx of [-1, 1]) {
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(1.4, CEIL_Y), wallMat);
    ret.position.set(sx * (CYC_HALF + 0.7), CEIL_Y / 2, WALL_Z - 0.02);
    group.add(ret);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 16), std(0x101113, 0.95));
  ceil.name = 'Ceiling';
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, CEIL_Y, -2);
  group.add(ceil);

  // ── steel truss grid with the four ceiling panel lights ─────────────────────────────────────
  const steel = std(0x15161a, 0.4, 0.85);
  for (const z of [-2.55, -0.55]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.2, 0.1), steel);
    beam.position.set(0, CEIL_Y - 0.18, z);
    group.add(beam);
    for (let i = -5; i <= 5; i++) {                           // lattice posts
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6), steel);
      post.position.set(i * 0.8, CEIL_Y - 0.09, z);
      group.add(post);
    }
  }
  const panelXs = [-2.25, -0.75, 0.75, 2.25];
  for (const x of panelXs) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 0.74), std(0x16171a, 0.5, 0.6));
    frame.position.set(x, CEIL_Y - 0.3, -1.55);
    group.add(frame);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.66), std(0xffffff, 0.8, 0, { emissive: 0xffffff, emissiveIntensity: 3.0, side: THREE.DoubleSide }));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, CEIL_Y - 0.34, -1.55);
    group.add(glow);
  }

  // ── the two 1.2 x 1.2 m softboxes on tripods (placed from the rig's own lights) ─────────────
  const boxes = lights.filter((l) => /softbox/i.test(l.name));
  for (const l of boxes) {
    const p = l.transform.position;
    const sb = softbox(l.areaWidth ?? 1.2, l.areaHeight ?? 1.2);
    sb.name = l.name;
    sb.position.set(p.x, p.y, p.z);
    sb.lookAt(0, Math.min(1.3, p.y), 0);
    group.add(sb);
    const away = new THREE.Vector3(p.x, 0, p.z).normalize();       // the head sits behind the box, away from the model
    group.add(tripod(p.x + away.x * 1.05, p.z + away.z * 1.05, p.y - 0.1, away));
  }
}
