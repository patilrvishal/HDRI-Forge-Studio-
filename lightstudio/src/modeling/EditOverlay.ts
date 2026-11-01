import * as THREE from 'three';
import { Selection, ekLo, ekHi, v3, type SelectMode, type V3 } from './EditMesh';
import type { EditableObject } from './EditableObject';
import { triangulateLoop } from './triangulate';

const ORANGE = new THREE.Color(1.0, 0.55, 0.05);
const WHITE = new THREE.Color(1, 1, 1);
const DARK = new THREE.Color(0.02, 0.02, 0.03);
const SEAM = new THREE.Color(0.95, 0.1, 0.1);
const SHARP = new THREE.Color(0.1, 0.9, 0.9);

let dotTexture: THREE.Texture | null = null;
function getDotTexture(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

function markHelper<T extends THREE.Object3D>(o: T): T {
  o.userData.isHelper = true;
  o.frustumCulled = false;
  o.raycast = () => {};
  o.renderOrder = 10;
  return o;
}

/** Vertex / edge / face overlay drawn on top of the mesh while it is in Edit Mode. */
export class EditOverlay {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private selLines: THREE.LineSegments;
  private points: THREE.Points;
  private selPoints: THREE.Points;
  private activePoint: THREE.Points;
  private faceFill: THREE.Mesh;
  private activeFill: THREE.Mesh;
  private faceDots: THREE.Points;
  private normals: THREE.LineSegments;
  private mats: THREE.Material[] = [];
  private xray = false;

  constructor(private readonly obj: EditableObject) {
    this.group.userData.isHelper = true;
    const lineMat = this.track(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    const selLineMat = this.track(new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false, toneMapped: false, linewidth: 2 }));
    const ptMat = (size: number, color: number) =>
      this.track(new THREE.PointsMaterial({ size, sizeAttenuation: false, color, map: getDotTexture(), alphaTest: 0.5, transparent: true, depthWrite: false, toneMapped: false }));
    const fillMat = (opacity: number) =>
      this.track(new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));

    this.faceFill = markHelper(new THREE.Mesh(new THREE.BufferGeometry(), fillMat(0.3)));
    this.activeFill = markHelper(new THREE.Mesh(new THREE.BufferGeometry(), fillMat(0.5)));
    this.lines = markHelper(new THREE.LineSegments(new THREE.BufferGeometry(), lineMat));
    this.selLines = markHelper(new THREE.LineSegments(new THREE.BufferGeometry(), selLineMat));
    this.points = markHelper(new THREE.Points(new THREE.BufferGeometry(), ptMat(6, 0x0a0a0a)));
    this.selPoints = markHelper(new THREE.Points(new THREE.BufferGeometry(), ptMat(8, 0xff8c0d)));
    this.activePoint = markHelper(new THREE.Points(new THREE.BufferGeometry(), ptMat(10, 0xffffff)));
    this.faceDots = markHelper(new THREE.Points(new THREE.BufferGeometry(), ptMat(5, 0x101010)));
    this.normals = markHelper(new THREE.LineSegments(new THREE.BufferGeometry(), this.track(new THREE.LineBasicMaterial({ color: 0x33c8ff, toneMapped: false }))));
    this.normals.visible = false;
    for (const o of [this.faceFill, this.activeFill, this.lines, this.selLines, this.points, this.selPoints, this.activePoint, this.faceDots, this.normals]) {
      this.group.add(o);
    }
    obj.object.add(this.group);
  }

  private track<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  setXray(on: boolean): void {
    this.xray = on;
    for (const m of this.mats) m.depthTest = !on;
    const mat = this.obj.material;
    mat.transparent = on;
    mat.opacity = on ? 0.45 : 1;
    mat.depthWrite = !on;
    mat.needsUpdate = true;
  }

  update(sel: Selection, mode: SelectMode, opts: { showNormals: boolean }): void {
    const m = this.obj.mesh;
    const co = m.co;
    // ── edges ──
    const em = m.edgeMap();
    const seg: number[] = [];
    const col: number[] = [];
    const sseg: number[] = [];
    const scol: number[] = [];
    const push = (a: V3, b: V3, c: THREE.Color, sel_: boolean) => {
      const P = sel_ ? sseg : seg;
      const C = sel_ ? scol : col;
      P.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      C.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    for (const e of em.values()) {
      if (m.hidden.has(e.a) || m.hidden.has(e.b)) continue;
      const isSel = sel.e.has(e.key);
      let c = DARK;
      if (isSel) c = sel.active && sel.active.type === 'edge' && sel.active.id === e.key ? WHITE : ORANGE;
      else if (m.seam.has(e.key)) c = SEAM;
      else if (m.sharp.has(e.key)) c = SHARP;
      push(co[e.a], co[e.b], c, isSel);
    }
    setLines(this.lines, seg, col);
    setLines(this.selLines, sseg, scol);

    // ── vertices ──
    const showVerts = mode === 'vert';
    const pv: number[] = [];
    const sv: number[] = [];
    const av: number[] = [];
    for (let i = 0; i < co.length; i++) {
      if (m.hidden.has(i)) continue;
      const p = co[i];
      if (sel.v.has(i)) {
        if (mode === 'vert') {
          if (sel.active && sel.active.type === 'vert' && sel.active.id === i) av.push(p[0], p[1], p[2]);
          else sv.push(p[0], p[1], p[2]);
        }
      } else if (showVerts) pv.push(p[0], p[1], p[2]);
    }
    setPoints(this.points, pv);
    setPoints(this.selPoints, sv);
    setPoints(this.activePoint, av);

    // ── faces ──
    const fp: number[] = [];
    const ap: number[] = [];
    const dots: number[] = [];
    for (const fi of sel.f) {
      if (fi >= m.faces.length) continue;
      const loop = m.faces[fi];
      if (loop.some((v) => m.hidden.has(v))) continue;
      const target = sel.active && sel.active.type === 'face' && sel.active.id === fi ? ap : fp;
      for (const t of triangulateLoop(co, loop)) for (const v of t) target.push(co[v][0], co[v][1], co[v][2]);
    }
    setTris(this.faceFill, fp);
    setTris(this.activeFill, ap);
    if (mode === 'face') {
      for (let fi = 0; fi < m.faces.length; fi++) {
        if (m.faces[fi].some((v) => m.hidden.has(v))) continue;
        const c = m.faceCenter(fi);
        dots.push(c[0], c[1], c[2]);
      }
    }
    setPoints(this.faceDots, dots);

    // ── normals ──
    this.normals.visible = opts.showNormals;
    if (opts.showNormals) {
      const n: number[] = [];
      const len = 0.25;
      for (let fi = 0; fi < m.faces.length; fi++) {
        const c = m.faceCenter(fi);
        const nn = m.faceNormal(fi);
        const e = v3.add(c, v3.scale(nn, len));
        n.push(c[0], c[1], c[2], e[0], e[1], e[2]);
      }
      this.normals.geometry.setAttribute('position', new THREE.Float32BufferAttribute(n, 3));
      this.normals.geometry.computeBoundingSphere();
    }
    // Keep X-ray state consistent after material re-creation.
    if (this.xray) this.setXray(true);
  }

  /** Vertices that are drawn as edges in vertex order (used to keep the overlay light while dragging). */
  dispose(): void {
    this.obj.object.remove(this.group);
    this.group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) g.dispose();
    });
    for (const m of this.mats) m.dispose();
    const mat = this.obj.material;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.needsUpdate = true;
  }
}

function setLines(l: THREE.LineSegments, pos: number[], col: number[]): void {
  const g = l.geometry;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  l.visible = pos.length > 0;
}
function setPoints(p: THREE.Points, pos: number[]): void {
  p.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  p.geometry.computeBoundingSphere();
  p.visible = pos.length > 0;
}
function setTris(mesh: THREE.Mesh, pos: number[]): void {
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mesh.geometry.computeBoundingSphere();
  mesh.visible = pos.length > 0;
}

export { ekLo, ekHi };
