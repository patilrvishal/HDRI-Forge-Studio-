import * as THREE from 'three';
import type { ModelingController } from './ModelingController';
import type { Modal, WorldSnapshot } from './ctlTypes';
import { falloffWeight } from './ctlTypes';
import { EditMesh, Selection, ek, ekLo, ekHi, flushSelection, selectionBoundsCenter, selectionMedian, selectionNormal, v3, type V3 } from './EditMesh';
import type { EditableObject } from './EditableObject';
import * as shape from './opsShape';
import * as loop from './opsLoop';
import { deleteSelection } from './opsCore';
import { isVisible, pickEdge, pickFace, pickVertex, pointInPolygon, projectAll, projectWorld, segIntersect, toWorld, type PickCtx } from './Picking';
import { useModelingStore } from '../store/modelingStore';

export type TransformKind = 'translate' | 'rotate' | 'scale' | 'shear';

const tmpV = new THREE.Vector3();

function restoreMesh(target: EditMesh, from: EditMesh): void {
  const c = from.clone();
  target.co = c.co;
  target.faces = c.faces;
  target.loose = c.loose;
  target.seam = c.seam;
  target.sharp = c.sharp;
  target.hidden = c.hidden;
  target.smooth = c.smooth;
  target.touch();
}

function rayAt(ctl: ModelingController, x: number, y: number): THREE.Raycaster {
  const r = ctl.dom.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), ctl.sm.camera);
  return ray;
}

/** Parameter along a line (p + t*a, |a|=1) closest to a ray. Null when parallel. */
function closestOnLine(ray: THREE.Ray, p: THREE.Vector3, a: THREE.Vector3): number | null {
  const d = ray.direction;
  const w = ray.origin.clone().sub(p);
  const ad = a.dot(d);
  const dw = d.dot(w);
  const aw = a.dot(w);
  const det = 1 - ad * ad;
  if (Math.abs(det) < 1e-6) return null;
  return (aw - ad * dw) / det;
}

function humanNum(n: number, digits = 3): string {
  return (Math.round(n * 10 ** digits) / 10 ** digits).toString();
}

// ── Transform (G / R / S / Shear) ─────────────────────────────────────────

export class TransformModal implements Modal {
  name: string;
  private start = { x: 0, y: 0 };
  private cur = { x: 0, y: 0 };
  private started = false;
  private pivot = new THREE.Vector3();
  private pivotScreen = { x: 0, y: 0 };
  private axis: 'x' | 'y' | 'z' | null = null;
  private axisPresses = 0;
  private plane = false;
  private space: 'global' | 'local' | 'normal' | 'view' = 'global';
  private constraintDir: THREE.Vector3 | null = null;
  private numeric = '';
  private precision = false;
  private shiftHeld = false;
  private ctrlHeld = false;
  private lastRaw = { x: 0, y: 0 };
  private precisionOffset = { x: 0, y: 0 };

  private edit: { obj: EditableObject; verts: number[]; orig: V3[]; weights: number[]; sel: Set<number> } | null = null;
  private objs: { obj: EditableObject; pos0: THREE.Vector3; quat0: THREE.Quaternion; scl0: THREE.Vector3 }[] = [];
  private editNormalWorld = new THREE.Vector3(0, 1, 0);
  private propRadius = 1;
  private snapPoint: THREE.Vector3 | null = null;

  constructor(
    private ctl: ModelingController,
    private kind: TransformKind,
    private snap: WorldSnapshot,
    private opts: { axis?: 'x' | 'y' | 'z'; normal?: V3 | null; label?: string; onCancelUndo?: WorldSnapshot },
  ) {
    this.name = opts.label ?? (kind === 'translate' ? 'Move' : kind === 'rotate' ? 'Rotate' : kind === 'scale' ? 'Resize' : 'Shear');
    const st = useModelingStore.getState();
    this.space = st.orientation;
    this.propRadius = st.proportional.size;
    if (opts.axis) {
      this.axis = opts.axis;
      this.axisPresses = 1;
      this.space = 'global';
    }
    if (opts.normal) this.constraintDir = new THREE.Vector3(...opts.normal).normalize();
    this.setup();
    this.updateText();
  }

  private setup(): void {
    const ctl = this.ctl;
    const st = useModelingStore.getState();
    const e = ctl.editObj;
    if (e) {
      e.object.updateMatrixWorld(true);
      const sel = ctl.sel;
      const verts = Array.from(sel.v);
      const weights: number[] = verts.map(() => 1);
      const orig: V3[] = verts.map((v) => v3.copy(e.mesh.co[v]));
      const selSet = new Set(verts);
      this.edit = { obj: e, verts, orig, weights, sel: selSet };
      // pivot
      const med = selectionMedian(e.mesh, sel);
      let pl: V3 = med;
      if (st.pivot === 'bounds') pl = selectionBoundsCenter(e.mesh, sel);
      if (st.pivot === 'active' && sel.active) {
        if (sel.active.type === 'vert') pl = e.mesh.co[sel.active.id];
        else if (sel.active.type === 'face') pl = e.mesh.faceCenter(sel.active.id);
      }
      this.pivot = st.pivot === 'cursor' ? ctl.cursor.clone() : toWorld(e, pl);
      const nl = selectionNormal(e.mesh, sel);
      this.editNormalWorld = new THREE.Vector3(nl[0], nl[1], nl[2]).transformDirection(e.object.matrixWorld).normalize();
      if (st.proportional.enabled) this.buildProportional(st.proportional.connected, st.proportional.falloff);
    } else {
      const ids = Array.from(ctl.selectedIds);
      for (const id of ids) {
        const o = ctl.objects.get(id);
        if (o) this.objs.push({ obj: o, pos0: o.object.position.clone(), quat0: o.object.quaternion.clone(), scl0: o.object.scale.clone() });
      }
      const c = new THREE.Vector3();
      for (const o of this.objs) c.add(o.pos0);
      c.multiplyScalar(1 / Math.max(1, this.objs.length));
      this.pivot = st.pivot === 'cursor' ? ctl.cursor.clone() : c;
      if (this.objs[0]) this.editNormalWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(this.objs[0].quat0);
    }
    const pr = projectWorld(ctl.sm.camera, ctl.dom.clientWidth, ctl.dom.clientHeight, this.pivot);
    this.pivotScreen = { x: pr.x, y: pr.y };
  }

  private buildProportional(connected: boolean, falloff: string): void {
    const ed = this.edit!;
    const m = ed.obj.mesh;
    const R = this.propRadius;
    const scale = ed.obj.object.scale.x || 1;
    const dist = new Float32Array(m.co.length).fill(Infinity);
    if (connected) {
      const ve = m.vertEdges();
      const open = new Set<number>();
      for (const v of ed.verts) {
        dist[v] = 0;
        open.add(v);
      }
      while (open.size) {
        let cur = -1;
        let best = Infinity;
        for (const v of open) if (dist[v] < best) {
          best = dist[v];
          cur = v;
        }
        open.delete(cur);
        if (best > R) continue;
        for (const k of ve[cur]) {
          const o = ekLo(k) === cur ? ekHi(k) : ekLo(k);
          const nd = best + v3.dist(m.co[cur], m.co[o]) * scale;
          if (nd < dist[o]) {
            dist[o] = nd;
            open.add(o);
          }
        }
      }
    } else {
      const src = ed.verts.map((v) => m.co[v]);
      for (let i = 0; i < m.co.length; i++) {
        if (ed.sel.has(i)) {
          dist[i] = 0;
          continue;
        }
        let best = Infinity;
        const p = m.co[i];
        for (const s of src) {
          const dx = p[0] - s[0];
          const dy = p[1] - s[1];
          const dz = p[2] - s[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) best = d2;
        }
        dist[i] = Math.sqrt(best) * scale;
      }
    }
    ed.verts = ed.verts.slice();
    ed.orig = ed.orig.slice();
    ed.weights = ed.weights.slice();
    for (let i = 0; i < m.co.length; i++) {
      if (ed.sel.has(i) || dist[i] > R) continue;
      const w = falloffWeight(falloff, dist[i], R, Math.random());
      if (w <= 0) continue;
      ed.verts.push(i);
      ed.orig.push(v3.copy(m.co[i]));
      ed.weights.push(w);
    }
  }

  private basis(): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
    const cam = this.ctl.sm.camera;
    switch (this.space) {
      case 'view': {
        const fwd = cam.getWorldDirection(new THREE.Vector3());
        const up = cam.up.clone().transformDirection(cam.matrixWorld).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
        return [right, up, fwd.clone().negate()];
      }
      case 'local': {
        const q = this.edit ? this.edit.obj.object.getWorldQuaternion(new THREE.Quaternion()) : this.objs[0]?.quat0 ?? new THREE.Quaternion();
        return [new THREE.Vector3(1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 1, 0).applyQuaternion(q), new THREE.Vector3(0, 0, 1).applyQuaternion(q)];
      }
      case 'normal': {
        const n = this.editNormalWorld.clone().normalize();
        const t = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const x = new THREE.Vector3().crossVectors(t, n).normalize();
        const y = new THREE.Vector3().crossVectors(n, x).normalize();
        return [x, y, n];
      }
      default:
        return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    }
  }

  private axisVec(): THREE.Vector3 | null {
    if (this.axis) {
      const b = this.basis();
      return b[this.axis === 'x' ? 0 : this.axis === 'y' ? 1 : 2].clone().normalize();
    }
    if (this.constraintDir && !this.plane) return this.constraintDir.clone();
    return null;
  }

  onMove(x: number, y: number, ev: PointerEvent): void {
    this.shiftHeld = ev.shiftKey;
    this.ctrlHeld = ev.ctrlKey;
    if (!this.started) {
      this.started = true;
      this.start = { x, y };
      this.lastRaw = { x, y };
      this.cur = { x, y };
      return;
    }
    // Shift = precision: movement counts a tenth.
    if (this.shiftHeld) {
      this.precisionOffset.x += (x - this.lastRaw.x) * 0.9;
      this.precisionOffset.y += (y - this.lastRaw.y) * 0.9;
    }
    this.lastRaw = { x, y };
    this.cur = { x: x - this.precisionOffset.x, y: y - this.precisionOffset.y };
    this.apply();
  }

  private snapIncrement(): boolean {
    const st = useModelingStore.getState();
    return this.ctrlHeld || (st.snapping.enabled && st.snapping.target === 'increment');
  }

  private computeTranslate(): THREE.Vector3 {
    const cam = this.ctl.sm.camera;
    const a = this.axisVec();
    const r0 = rayAt(this.ctl, this.start.x, this.start.y).ray;
    const r1 = rayAt(this.ctl, this.cur.x, this.cur.y).ray;
    let delta = new THREE.Vector3();
    if (a && !this.plane) {
      const t0 = closestOnLine(r0, this.pivot, a);
      const t1 = closestOnLine(r1, this.pivot, a);
      if (t0 !== null && t1 !== null) {
        let d = t1 - t0;
        if (this.snapIncrement()) d = Math.round(d / 0.1) * 0.1;
        delta = a.clone().multiplyScalar(d);
      }
    } else {
      const n = a && this.plane ? a : cam.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.pivot);
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      if (r0.intersectPlane(plane, p0) && r1.intersectPlane(plane, p1)) delta = p1.sub(p0);
      if (this.snapIncrement()) {
        const target = this.pivot.clone().add(delta);
        target.set(Math.round(target.x / 0.1) * 0.1, Math.round(target.y / 0.1) * 0.1, Math.round(target.z / 0.1) * 0.1);
        delta = target.sub(this.pivot);
      }
    }
    return delta;
  }

  private findSnapDelta(): THREE.Vector3 | null {
    const st = useModelingStore.getState();
    if (!st.snapping.enabled || st.snapping.target === 'increment') return null;
    const ctl = this.ctl;
    const r = ctl.dom.getBoundingClientRect();
    const cam = ctl.sm.camera;
    let target: THREE.Vector3 | null = null;
    if (st.snapping.target === 'face') {
      const ray = rayAt(ctl, this.lastRaw.x, this.lastRaw.y);
      const meshes = Array.from(ctl.objects.values()).filter((o) => o.object.visible && !this.movingObject(o)).map((o) => o.object);
      if (this.edit) meshes.push(this.edit.obj.object);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) target = hit.point.clone();
    } else {
      let best = 24;
      for (const o of ctl.objects.values()) {
        if (!o.object.visible) continue;
        o.object.updateMatrixWorld(true);
        const m = o.mesh;
        const skip = this.edit && this.edit.obj === o ? this.edit.sel : null;
        if (st.snapping.target === 'vertex') {
          for (let i = 0; i < m.co.length; i++) {
            if (skip && skip.has(i)) continue;
            const w = toWorld(o, m.co[i], tmpV);
            const sp = projectWorld(cam, r.width, r.height, w);
            if (!sp.ok) continue;
            const d = Math.hypot(sp.x - this.lastRaw.x, sp.y - this.lastRaw.y);
            if (d < best) {
              best = d;
              target = w.clone();
            }
          }
        } else {
          for (const e of m.edgeMap().values()) {
            if (skip && (skip.has(e.a) || skip.has(e.b))) continue;
            const a = toWorld(o, m.co[e.a]);
            const b = toWorld(o, m.co[e.b]);
            const sa = projectWorld(cam, r.width, r.height, a);
            const sb = projectWorld(cam, r.width, r.height, b);
            if (!sa.ok || !sb.ok) continue;
            const dx = sb.x - sa.x;
            const dy = sb.y - sa.y;
            const l2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((this.lastRaw.x - sa.x) * dx + (this.lastRaw.y - sa.y) * dy) / l2));
            const d = Math.hypot(this.lastRaw.x - (sa.x + dx * t), this.lastRaw.y - (sa.y + dy * t));
            if (d < best) {
              best = d;
              target = a.clone().lerp(b, t);
            }
          }
        }
      }
    }
    if (!target) return null;
    this.snapPoint = target;
    // Source: selected vertex closest to the pivot in edit mode, else the pivot.
    let source = this.pivot.clone();
    if (this.edit) {
      let bd = Infinity;
      for (let i = 0; i < this.edit.verts.length; i++) {
        if (this.edit.weights[i] < 1) continue;
        const w = toWorld(this.edit.obj, this.edit.orig[i], tmpV);
        const d = w.distanceTo(this.pivot);
        if (d < bd) {
          bd = d;
          source = w.clone();
        }
      }
    }
    return target.sub(source);
  }

  private movingObject(o: EditableObject): boolean {
    return this.objs.some((x) => x.obj === o);
  }

  private parseNumeric(): number | null {
    if (!this.numeric || this.numeric === '-' || this.numeric === '.') return null;
    const n = parseFloat(this.numeric);
    return Number.isFinite(n) ? n : null;
  }

  apply(): void {
    const ctl = this.ctl;
    const num = this.parseNumeric();
    let delta = new THREE.Vector3();
    let angle = 0;
    let scale = 1;
    let shear = 0;
    this.snapPoint = null;
    if (this.kind === 'translate') {
      delta = this.computeTranslate();
      const snapped = this.findSnapDelta();
      if (snapped) delta = snapped;
      if (num !== null) {
        const a = this.axisVec() ?? new THREE.Vector3(1, 0, 0);
        delta = a.clone().multiplyScalar(num);
      }
    } else if (this.kind === 'rotate') {
      const a0 = Math.atan2(this.start.y - this.pivotScreen.y, this.start.x - this.pivotScreen.x);
      const a1 = Math.atan2(this.cur.y - this.pivotScreen.y, this.cur.x - this.pivotScreen.x);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const axis = this.axisVec() ?? ctl.sm.camera.getWorldDirection(new THREE.Vector3());
      const fwd = ctl.sm.camera.getWorldDirection(new THREE.Vector3());
      angle = d * (axis.dot(fwd) >= 0 ? 1 : -1);
      if (this.snapIncrement()) angle = Math.round(angle / (Math.PI / 36)) * (Math.PI / 36);
      if (num !== null) angle = (num * Math.PI) / 180;
    } else if (this.kind === 'scale') {
      const d0 = Math.hypot(this.start.x - this.pivotScreen.x, this.start.y - this.pivotScreen.y) || 1;
      const d1 = Math.hypot(this.cur.x - this.pivotScreen.x, this.cur.y - this.pivotScreen.y);
      scale = d1 / d0;
      if (this.snapIncrement()) scale = Math.round(scale / 0.1) * 0.1;
      if (num !== null) scale = num;
    } else {
      shear = (this.cur.x - this.start.x) / 200;
      if (num !== null) shear = num;
    }
    this.applyTransform(delta, angle, scale, shear);
    this.updateText(delta, angle, scale, shear);
  }

  private applyTransform(delta: THREE.Vector3, angle: number, scale: number, shear: number): void {
    const ctl = this.ctl;
    const cam = ctl.sm.camera;
    const axis = this.axisVec();
    const rotAxis = (axis ?? cam.getWorldDirection(new THREE.Vector3())).clone().normalize();
    const shearDir = axis ?? new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const shearRef = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    const xf = (wp: THREE.Vector3, w: number): THREE.Vector3 => {
      if (this.kind === 'translate') return wp.clone().addScaledVector(delta, w);
      const rel = wp.clone().sub(this.pivot);
      if (this.kind === 'rotate') {
        rel.applyAxisAngle(rotAxis, angle * w);
        return this.pivot.clone().add(rel);
      }
      if (this.kind === 'scale') {
        const s = 1 + (scale - 1) * w;
        if (axis && !this.plane) {
          const along = axis.clone().multiplyScalar(rel.dot(axis));
          rel.add(along.multiplyScalar(s - 1));
        } else if (axis && this.plane) {
          const along = axis.clone().multiplyScalar(rel.dot(axis));
          rel.sub(along).multiplyScalar(s).add(along);
        } else rel.multiplyScalar(s);
        return this.pivot.clone().add(rel);
      }
      const amount = shear * w;
      rel.addScaledVector(shearDir, rel.dot(shearRef) * amount);
      return this.pivot.clone().add(rel);
    };

    if (this.edit) {
      const { obj, verts, orig, weights } = this.edit;
      obj.object.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(obj.object.matrixWorld).invert();
      for (let i = 0; i < verts.length; i++) {
        const lp = orig[i];
        const wp = new THREE.Vector3(lp[0], lp[1], lp[2]).applyMatrix4(obj.object.matrixWorld);
        const np = xf(wp, weights[i]).applyMatrix4(inv);
        obj.mesh.co[verts[i]] = [np.x, np.y, np.z];
      }
      obj.mesh.touch();
      ctl.refreshEdit();
    } else {
      for (const t of this.objs) {
        const o = t.obj.object;
        if (this.kind === 'translate') o.position.copy(t.pos0).add(delta);
        else if (this.kind === 'rotate') {
          const q = new THREE.Quaternion().setFromAxisAngle(rotAxis, angle);
          o.quaternion.copy(q).multiply(t.quat0);
          o.position.copy(this.pivot).add(t.pos0.clone().sub(this.pivot).applyQuaternion(q));
        } else if (this.kind === 'scale') {
          const ax = axis;
          if (ax && !this.plane) {
            // scale along a world axis: map to the nearest local axis of the object
            const local = ax.clone().applyQuaternion(t.quat0.clone().invert());
            const s = t.scl0.clone();
            const i = Math.abs(local.x) > Math.abs(local.y) ? (Math.abs(local.x) > Math.abs(local.z) ? 0 : 2) : Math.abs(local.y) > Math.abs(local.z) ? 1 : 2;
            s.setComponent(i, s.getComponent(i) * scale);
            o.scale.copy(s);
          } else o.scale.copy(t.scl0).multiplyScalar(scale);
          o.position.copy(this.pivot).add(t.pos0.clone().sub(this.pivot).multiplyScalar(scale));
        }
        o.updateMatrixWorld(true);
      }
      ctl.syncStore();
    }
    ctl.changed();
  }

  private updateText(delta = new THREE.Vector3(), angle = 0, scale = 1, shear = 0): void {
    const num = this.numeric ? ` [${this.numeric}]` : '';
    const ax = this.axis ? `  ${this.plane ? 'Plane excl. ' : 'Axis '}${this.axis.toUpperCase()} (${this.space})` : this.constraintDir ? '  along normal' : '';
    const snap = this.snapPoint ? '  snap' : '';
    let body = '';
    if (this.kind === 'translate') body = `D: ${humanNum(delta.length())}  dX ${humanNum(delta.x)}  dY ${humanNum(delta.y)}  dZ ${humanNum(delta.z)}`;
    else if (this.kind === 'rotate') body = `Rotation: ${humanNum((angle * 180) / Math.PI, 2)}°`;
    else if (this.kind === 'scale') body = `Scale: ${humanNum(scale)}`;
    else body = `Shear: ${humanNum(shear)}`;
    const prop = useModelingStore.getState().proportional.enabled && this.edit ? `  |  Proportional ${this.propRadius.toFixed(2)}` : '';
    this.ctl.setModalText(this.name, body + ax + num + snap + prop);
    useModelingStore.setState({ hint: 'LMB/Enter confirm · RMB/Esc cancel · X/Y/Z axis (again = local) · Shift+X/Y/Z exclude axis · type a value · Shift precision · Ctrl snap' });
  }

  onKey(ev: KeyboardEvent): boolean {
    const k = ev.key.toLowerCase();
    this.shiftHeld = ev.shiftKey;
    if (k === 'x' || k === 'y' || k === 'z') {
      if (ev.shiftKey) {
        this.plane = true;
        this.axis = k;
        this.axisPresses = 1;
        this.space = useModelingStore.getState().orientation;
      } else if (this.axis === k && !this.plane) {
        this.axisPresses++;
        if (this.axisPresses === 2) this.space = 'local';
        else {
          this.axis = null;
          this.axisPresses = 0;
          this.space = useModelingStore.getState().orientation;
        }
      } else {
        this.plane = false;
        this.axis = k;
        this.axisPresses = 1;
        this.space = useModelingStore.getState().orientation;
      }
      this.apply();
      return true;
    }
    if (/^[0-9.]$/.test(ev.key)) {
      this.numeric += ev.key;
      this.apply();
      return true;
    }
    if (ev.key === '-' || ev.key === 'Subtract') {
      this.numeric = this.numeric.startsWith('-') ? this.numeric.slice(1) : '-' + this.numeric;
      this.apply();
      return true;
    }
    if (ev.key === 'Backspace') {
      this.numeric = this.numeric.slice(0, -1);
      this.apply();
      return true;
    }
    if (k === 'o' && this.edit) {
      const st = useModelingStore.getState();
      useModelingStore.setState({ proportional: { ...st.proportional, enabled: !st.proportional.enabled } });
      this.reset();
      this.setup();
      this.apply();
      return true;
    }
    if (k === 'g' && this.kind === 'translate' && this.ctl.editObj && !this.opts.label) {
      // G G -> edge / vertex slide
      this.reset();
      const c = this.ctl;
      c.discardUndo(this.snap);
      c.endModal();
      c.slide(useModelingStore.getState().selectMode === 'vert' ? 'vertex' : 'edge');
      return true;
    }
    if (k === 'tab') return true;
    return false;
  }

  onWheel(ev: WheelEvent): boolean {
    const st = useModelingStore.getState();
    if (this.edit && st.proportional.enabled) {
      this.propRadius = Math.max(0.01, this.propRadius * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
      useModelingStore.setState({ proportional: { ...st.proportional, size: this.propRadius } });
      this.reset();
      this.setup();
      this.apply();
      return true;
    }
    return false;
  }

  private reset(): void {
    if (this.edit) {
      const { obj, verts, orig } = this.edit;
      for (let i = 0; i < verts.length; i++) obj.mesh.co[verts[i]] = v3.copy(orig[i]);
      obj.mesh.touch();
    } else {
      for (const t of this.objs) {
        t.obj.object.position.copy(t.pos0);
        t.obj.object.quaternion.copy(t.quat0);
        t.obj.object.scale.copy(t.scl0);
      }
    }
  }

  confirm(): void {
    const ctl = this.ctl;
    if (this.edit) {
      this.edit.obj.mesh.touch();
    }
    ctl.endModal();
    ctl.changed();
  }

  cancel(): void {
    this.reset();
    const ctl = this.ctl;
    if (!this.opts.onCancelUndo) ctl.discardUndo(this.snap);
    ctl.endModal();
    ctl.changed();
  }
}

// ── Inset (I) ─────────────────────────────────────────────────────────────

abstract class MeshDragModal implements Modal {
  abstract name: string;
  protected base: EditMesh;
  protected baseSel: Selection;
  protected obj: EditableObject;
  protected startDist = 0;
  protected pivotScreen = { x: 0, y: 0 };
  protected sizeRef = 1;
  protected numeric = '';
  protected started = false;
  protected mouse = { x: 0, y: 0 };

  constructor(protected ctl: ModelingController, protected snap: WorldSnapshot) {
    this.obj = ctl.editObj!;
    this.base = this.obj.mesh.clone();
    this.baseSel = ctl.sel.clone();
    const m = this.obj.mesh;
    const c = selectionMedian(m, ctl.sel);
    const pr = projectWorld(ctl.sm.camera, ctl.dom.clientWidth, ctl.dom.clientHeight, toWorld(this.obj, c));
    this.pivotScreen = { x: pr.x, y: pr.y };
    let r = 0;
    let n = 0;
    for (const v of ctl.sel.v) {
      r += v3.dist(m.co[v], c);
      n++;
    }
    this.sizeRef = Math.max(0.05, r / Math.max(1, n));
  }

  protected restore(): void {
    restoreMesh(this.obj.mesh, this.base);
    this.ctl.sel.v = new Set(this.baseSel.v);
    this.ctl.sel.e = new Set(this.baseSel.e);
    this.ctl.sel.f = new Set(this.baseSel.f);
    this.ctl.sel.active = this.baseSel.active ? { ...this.baseSel.active } : null;
  }

  abstract run(): void;
  abstract text(): string;
  abstract hintText(): string;
  abstract finish(): void;
  abstract key(ev: KeyboardEvent): boolean;

  protected numericValue(): number | null {
    if (!this.numeric || this.numeric === '-' || this.numeric === '.') return null;
    const n = parseFloat(this.numeric);
    return Number.isFinite(n) ? n : null;
  }

  onMove(x: number, y: number): void {
    this.mouse = { x, y };
    if (!this.started) {
      this.started = true;
      this.startDist = Math.hypot(x - this.pivotScreen.x, y - this.pivotScreen.y) || 1;
    }
    this.update();
  }

  protected update(): void {
    this.restore();
    this.run();
    this.obj.mesh.touch();
    flushSelection(this.obj.mesh, this.ctl.sel, this.ctl.selectMode);
    this.ctl.refreshEdit();
    this.ctl.changed();
    this.ctl.setModalText(this.name, this.text());
    useModelingStore.setState({ hint: this.hintText() });
  }

  onKey(ev: KeyboardEvent): boolean {
    if (/^[0-9.]$/.test(ev.key)) {
      this.numeric += ev.key;
      this.update();
      return true;
    }
    if (ev.key === '-') {
      this.numeric = this.numeric.startsWith('-') ? this.numeric.slice(1) : '-' + this.numeric;
      this.update();
      return true;
    }
    if (ev.key === 'Backspace') {
      this.numeric = this.numeric.slice(0, -1);
      this.update();
      return true;
    }
    return this.key(ev);
  }

  confirm(): void {
    this.finish();
    this.ctl.endModal();
    this.ctl.changed();
  }

  cancel(): void {
    this.restore();
    this.obj.mesh.touch();
    this.ctl.discardUndo(this.snap);
    flushSelection(this.obj.mesh, this.ctl.sel, this.ctl.selectMode);
    this.ctl.endModal();
    this.ctl.changed();
  }
}

export class InsetModal extends MeshDragModal {
  name = 'Inset Faces';
  private p = { thickness: 0, depth: 0, boundary: true, individual: false, outset: false };
  private depthMode = false;
  private depthStartY = 0;
  private depthStart = 0;

  run(): void {
    const num = this.numericValue();
    let t = this.p.thickness;
    if (num !== null) t = Math.abs(num);
    shape.insetFaces(this.obj.mesh, this.ctl.sel, { thickness: t, depth: this.p.depth, useBoundary: this.p.boundary, individual: this.p.individual, outset: this.p.outset });
  }

  onMove(x: number, y: number, ev?: PointerEvent): void {
    this.mouse = { x, y };
    if (!this.started) {
      this.started = true;
      this.startDist = Math.hypot(x - this.pivotScreen.x, y - this.pivotScreen.y) || 1;
      this.depthStartY = y;
    }
    if (ev?.ctrlKey) {
      if (!this.depthMode) {
        this.depthMode = true;
        this.depthStartY = y;
        this.depthStart = this.p.depth;
      }
      this.p.depth = this.depthStart + ((this.depthStartY - y) / 200) * this.sizeRef;
    } else {
      this.depthMode = false;
      const d = Math.hypot(x - this.pivotScreen.x, y - this.pivotScreen.y);
      this.p.thickness = Math.max(0, ((this.startDist - d) / this.startDist) * this.sizeRef);
    }
    this.update();
  }

  text(): string {
    const t = this.numericValue() ?? this.p.thickness;
    return `Thickness: ${humanNum(t)}  Depth: ${humanNum(this.p.depth)}  Boundary(B): ${this.p.boundary ? 'on' : 'off'}  Individual(I): ${this.p.individual ? 'on' : 'off'}  Outset(O): ${this.p.outset ? 'on' : 'off'}${this.numeric ? ` [${this.numeric}]` : ''}`;
  }
  hintText(): string {
    return 'Move mouse toward the centre to inset · hold Ctrl to change depth · B boundary · I individual · O outset · type a value · LMB/Enter confirm · RMB/Esc cancel';
  }
  key(ev: KeyboardEvent): boolean {
    const k = ev.key.toLowerCase();
    if (k === 'b') this.p.boundary = !this.p.boundary;
    else if (k === 'i') this.p.individual = !this.p.individual;
    else if (k === 'o') this.p.outset = !this.p.outset;
    else return false;
    this.update();
    return true;
  }
  finish(): void {
    const c = this.ctl;
    const p = { ...this.p, thickness: this.numericValue() ?? this.p.thickness };
    const base = this.base;
    const baseSel = this.baseSel;
    c.setLastOp('Inset Faces', [
      { key: 'thickness', label: 'Thickness', type: 'number', value: p.thickness, min: 0, max: 100, step: 0.01 },
      { key: 'depth', label: 'Depth', type: 'number', value: p.depth, min: -100, max: 100, step: 0.01 },
      { key: 'boundary', label: 'Boundary', type: 'bool', value: p.boundary },
      { key: 'individual', label: 'Individual', type: 'bool', value: p.individual },
      { key: 'outset', label: 'Outset', type: 'bool', value: p.outset },
    ], (v) => {
      const e = c.editObj;
      if (!e) return;
      restoreMesh(e.mesh, base);
      c.sel.v = new Set(baseSel.v);
      c.sel.e = new Set(baseSel.e);
      c.sel.f = new Set(baseSel.f);
      shape.insetFaces(e.mesh, c.sel, { thickness: Number(v.thickness), depth: Number(v.depth), useBoundary: Boolean(v.boundary), individual: Boolean(v.individual), outset: Boolean(v.outset) });
      e.mesh.touch();
      flushSelection(e.mesh, c.sel, c.selectMode);
      c.refreshEdit();
      c.changed();
    }, this.snap);
  }
}

export class BevelModal extends MeshDragModal {
  name = 'Bevel';
  private p = { width: 0, segments: 1, profile: 0.5, vertex: false };

  constructor(ctl: ModelingController, snap: WorldSnapshot, vertexOnly: boolean) {
    super(ctl, snap);
    this.p.vertex = vertexOnly;
  }

  run(): void {
    const w = this.numericValue() ?? this.p.width;
    if (w <= 1e-6) return;
    const opts = { width: w, segments: this.p.segments, profile: this.p.profile };
    if (this.p.vertex) shape.bevelVertices(this.obj.mesh, this.ctl.sel, opts);
    else if (this.ctl.sel.e.size) shape.bevelEdges(this.obj.mesh, this.ctl.sel, opts);
    else shape.bevelVertices(this.obj.mesh, this.ctl.sel, opts);
  }

  onMove(x: number, y: number): void {
    this.mouse = { x, y };
    if (!this.started) {
      this.started = true;
      this.startDist = Math.hypot(x - this.pivotScreen.x, y - this.pivotScreen.y) || 1;
    }
    const d = Math.hypot(x - this.pivotScreen.x, y - this.pivotScreen.y);
    this.p.width = Math.max(0, (Math.abs(d - this.startDist) / 150) * this.sizeRef);
    this.update();
  }

  text(): string {
    const w = this.numericValue() ?? this.p.width;
    return `${this.p.vertex ? 'Vertex ' : ''}Width: ${humanNum(w)}  Segments(wheel): ${this.p.segments}  Profile(P): ${this.p.profile.toFixed(2)}${this.numeric ? ` [${this.numeric}]` : ''}`;
  }
  hintText(): string {
    return 'Move mouse to change width · wheel = segments · P then move = profile · V toggles vertex bevel · type a value · LMB/Enter confirm · RMB/Esc cancel';
  }
  key(ev: KeyboardEvent): boolean {
    const k = ev.key.toLowerCase();
    if (k === 'v') this.p.vertex = !this.p.vertex;
    else if (k === 'p') this.p.profile = this.p.profile >= 0.95 ? 0.25 : this.p.profile + 0.25;
    else return false;
    this.update();
    return true;
  }
  onWheel(ev: WheelEvent): boolean {
    this.p.segments = Math.max(1, Math.min(32, this.p.segments + (ev.deltaY < 0 ? 1 : -1)));
    this.update();
    return true;
  }
  finish(): void {
    const c = this.ctl;
    const base = this.base;
    const baseSel = this.baseSel;
    const w = this.numericValue() ?? this.p.width;
    c.setLastOp('Bevel', [
      { key: 'width', label: 'Width', type: 'number', value: w, min: 0, max: 100, step: 0.01 },
      { key: 'segments', label: 'Segments', type: 'number', value: this.p.segments, min: 1, max: 32, step: 1 },
      { key: 'profile', label: 'Profile', type: 'number', value: this.p.profile, min: 0.05, max: 0.95, step: 0.05 },
      { key: 'vertex', label: 'Vertices Only', type: 'bool', value: this.p.vertex },
    ], (v) => {
      const e = c.editObj;
      if (!e) return;
      restoreMesh(e.mesh, base);
      c.sel.v = new Set(baseSel.v);
      c.sel.e = new Set(baseSel.e);
      c.sel.f = new Set(baseSel.f);
      const opts = { width: Number(v.width), segments: Math.round(Number(v.segments)), profile: Number(v.profile) };
      if (Boolean(v.vertex) || !c.sel.e.size) shape.bevelVertices(e.mesh, c.sel, opts);
      else shape.bevelEdges(e.mesh, c.sel, opts);
      e.mesh.touch();
      flushSelection(e.mesh, c.sel, c.selectMode);
      c.refreshEdit();
      c.changed();
    }, this.snap);
  }
}

// ── Loop cut (Ctrl+R) ─────────────────────────────────────────────────────

export class LoopCutModal implements Modal {
  name = 'Loop Cut and Slide';
  private obj: EditableObject;
  private cuts = 1;
  private ring: loop.EdgeRing | null = null;
  private hoverKey = -1;
  private phase: 'hover' | 'slide' = 'hover';
  private slide = 0;
  private slideStart = { x: 0, y: 0 };
  private slideDir = { x: 1, y: 0, len: 100 };
  private preview: THREE.LineSegments;

  constructor(private ctl: ModelingController, private snap: WorldSnapshot) {
    this.obj = ctl.editObj!;
    const mat = new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true, toneMapped: false });
    this.preview = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    this.preview.userData.isHelper = true;
    this.preview.raycast = () => {};
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 20;
    this.obj.object.add(this.preview);
    this.text();
  }

  private ctx(): PickCtx {
    return this.ctl.pickCtx(this.obj)!;
  }

  private text(): void {
    this.ctl.setModalText(this.name, `Number of Cuts (wheel): ${this.cuts}   Slide: ${this.slide.toFixed(2)}   ${this.phase === 'hover' ? 'Click to place the cut' : 'Move to slide, click to confirm'}`);
    useModelingStore.setState({ hint: 'Hover an edge · wheel = number of cuts · LMB places, move to slide, LMB confirms · RMB cancels slide · Esc cancel' });
  }

  private updatePreview(): void {
    const m = this.obj.mesh;
    const pos: number[] = [];
    if (this.ring) {
      const dirOf = new Map<number, [number, number]>();
      for (const [u, v] of this.ring.edges) dirOf.set(ek(u, v), [u, v]);
      const pointOn = (u: number, v: number, i: number): V3 => {
        const t = Math.min(0.98, Math.max(0.02, i / (this.cuts + 1) + this.slide / (this.cuts + 1)));
        return v3.lerp(m.co[u], m.co[v], t);
      };
      for (const fi of this.ring.faces) {
        const f = m.faces[fi];
        const edges: [number, number][] = [];
        for (let i = 0; i < f.length; i++) {
          const d = dirOf.get(ek(f[i], f[(i + 1) % f.length]));
          if (d) edges.push(d);
        }
        if (edges.length < 2) continue;
        for (let i = 1; i <= this.cuts; i++) {
          const a = pointOn(edges[0][0], edges[0][1], i);
          const b = pointOn(edges[1][0], edges[1][1], i);
          pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      }
    }
    this.preview.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.preview.geometry.computeBoundingSphere();
    this.preview.visible = pos.length > 0;
  }

  onMove(x: number, y: number): void {
    this.ctl.setMouse(x, y);
    if (this.phase === 'hover') {
      const ctx = this.ctx();
      const pick = pickEdge(ctx, x, y, 26);
      if (pick && pick.key !== this.hoverKey) {
        this.hoverKey = pick.key;
        this.ring = loop.edgeRing(this.obj.mesh, pick.key);
      } else if (!pick) {
        this.hoverKey = -1;
        this.ring = null;
      }
    } else {
      const dx = x - this.slideStart.x;
      const dy = y - this.slideStart.y;
      const proj = (dx * this.slideDir.x + dy * this.slideDir.y) / (this.slideDir.len * 0.5);
      this.slide = Math.max(-1, Math.min(1, proj));
    }
    this.updatePreview();
    this.text();
  }

  onDown(x: number, y: number, _ev?: PointerEvent): void {
    if (this.phase === 'hover') {
      if (!this.ring) return;
      // Establish the slide direction from the clicked edge on screen.
      const ctx = this.ctx();
      const S = projectAll(ctx);
      const key = this.hoverKey;
      const a = S[ekLo(key)];
      const b = S[ekHi(key)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // The ring stores direction u->v per edge; map to the picked edge's own direction.
      const dirEntry = this.ring.edges.find(([u, v]) => ek(u, v) === key)!;
      const sign = dirEntry[0] === ekLo(key) ? 1 : -1;
      this.slideDir = { x: (dx / len) * sign, y: (dy / len) * sign, len };
      this.slideStart = { x, y };
      this.slide = 0;
      this.phase = 'slide';
      this.text();
    } else this.confirm();
  }

  onKey(): boolean {
    return false;
  }

  onWheel(ev: WheelEvent): boolean {
    this.cuts = Math.max(1, Math.min(30, this.cuts + (ev.deltaY < 0 ? 1 : -1)));
    this.updatePreview();
    this.text();
    return true;
  }

  private dispose(): void {
    this.obj.object.remove(this.preview);
    this.preview.geometry.dispose();
    (this.preview.material as THREE.Material).dispose();
  }

  private applyCut(slide: number): void {
    const e = this.obj;
    if (!this.ring) return;
    const before = e.mesh.clone();
    const verts = loop.loopCut(e.mesh, this.ring, this.cuts, slide);
    const c = this.ctl;
    c.sel.clear();
    for (const v of verts) c.sel.v.add(v);
    flushSelection(e.mesh, c.sel, 'vert');
    // keep only edges between new verts, in the current select mode
    c.setSelectMode('edge');
    e.mesh.touch();
    const cuts = this.cuts;
    const ring = this.ring;
    void ring;
    c.setLastOp('Loop Cut', [
      { key: 'cuts', label: 'Number of Cuts', type: 'number', value: cuts, min: 1, max: 30, step: 1 },
      { key: 'slide', label: 'Edge Slide', type: 'number', value: slide, min: -1, max: 1, step: 0.05 },
    ], (v) => {
      const ed = c.editObj;
      if (!ed) return;
      restoreMesh(ed.mesh, before);
      const r = loop.edgeRing(ed.mesh, this.hoverKey);
      if (!r) return;
      const nv = loop.loopCut(ed.mesh, r, Math.round(Number(v.cuts)), Number(v.slide));
      c.sel.clear();
      for (const x of nv) c.sel.v.add(x);
      flushSelection(ed.mesh, c.sel, 'vert');
      flushSelection(ed.mesh, c.sel, 'edge');
      ed.mesh.touch();
      c.refreshEdit();
      c.changed();
    }, this.snap);
  }

  confirm(): void {
    if (this.phase === 'hover') {
      this.cancel();
      return;
    }
    this.applyCut(this.slide);
    this.dispose();
    this.ctl.endModal();
    this.ctl.changed();
  }

  cancel(): void {
    if (this.phase === 'slide') {
      // RMB during slide keeps the cut at the centre (Blender behaviour).
      this.applyCut(0);
      this.dispose();
      this.ctl.endModal();
      this.ctl.changed();
      return;
    }
    this.dispose();
    this.ctl.discardUndo(this.snap);
    this.ctl.endModal();
  }
}

// ── Knife (K) ─────────────────────────────────────────────────────────────

interface KnifePoint {
  kind: 'vert' | 'edge' | 'face';
  v?: number;
  a?: number;
  b?: number;
  t?: number;
  face: number;
  world: THREE.Vector3;
  sx: number;
  sy: number;
}

export class KnifeModal implements Modal {
  name = 'Knife';
  private obj: EditableObject;
  private points: KnifePoint[] = [];
  private cuts: KnifePoint[][] = [];
  private hover: KnifePoint | null = null;
  private cutThrough = false;
  private preview: THREE.LineSegments;
  private dots: THREE.Points;

  constructor(private ctl: ModelingController, private snap: WorldSnapshot) {
    this.obj = ctl.editObj!;
    const lm = new THREE.LineBasicMaterial({ color: 0x2af0ff, depthTest: false, transparent: true, toneMapped: false });
    this.preview = new THREE.LineSegments(new THREE.BufferGeometry(), lm);
    const pm = new THREE.PointsMaterial({ color: 0xffe14d, size: 9, sizeAttenuation: false, depthTest: false, toneMapped: false });
    this.dots = new THREE.Points(new THREE.BufferGeometry(), pm);
    for (const o of [this.preview, this.dots]) {
      o.userData.isHelper = true;
      o.raycast = () => {};
      o.frustumCulled = false;
      o.renderOrder = 30;
      ctl.sm.scene.add(o);
    }
    this.text();
  }

  private text(): void {
    this.ctl.setModalText(this.name, `Points: ${this.points.length}   Cut through(Z): ${this.cutThrough ? 'on' : 'off'}`);
    useModelingStore.setState({ hint: 'LMB add cut points · Ctrl snaps to edge midpoints · Z cut through · E end this cut and start another · Enter confirm · Esc/RMB cancel' });
  }

  private resolve(x: number, y: number, ctrl: boolean): KnifePoint | null {
    const ctx = this.ctl.pickCtx(this.obj)!;
    const hit = pickFace(ctx, x, y);
    if (!hit) return null;
    const m = this.obj.mesh;
    const S = projectAll(ctx);
    const loopV = m.faces[hit.face];
    let best: KnifePoint | null = null;
    let bd = 12;
    for (const v of loopV) {
      const d = Math.hypot(S[v].x - x, S[v].y - y);
      if (d < bd) {
        bd = d;
        best = { kind: 'vert', v, face: hit.face, world: toWorld(this.obj, m.co[v]), sx: S[v].x, sy: S[v].y };
      }
    }
    if (best) return best;
    bd = 10;
    for (let i = 0; i < loopV.length; i++) {
      const a = loopV[i];
      const b = loopV[(i + 1) % loopV.length];
      const A = S[a];
      const B = S[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const l2 = dx * dx + dy * dy || 1;
      let t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / l2));
      const d = Math.hypot(x - (A.x + dx * t), y - (A.y + dy * t));
      if (d < bd) {
        bd = d;
        // perspective-correct parameter via the mouse ray
        const wa = toWorld(this.obj, m.co[a]);
        const wb = toWorld(this.obj, m.co[b]);
        const dirAB = wb.clone().sub(wa);
        const len = dirAB.length() || 1;
        const tt = closestOnLine(rayAt(this.ctl, x, y).ray, wa, dirAB.clone().normalize());
        if (tt !== null) t = Math.max(0.001, Math.min(0.999, tt / len));
        if (ctrl) t = 0.5;
        const world = wa.clone().lerp(wb, t);
        const sp = projectWorld(this.ctl.sm.camera, ctx.width, ctx.height, world);
        best = { kind: 'edge', a, b, t, face: hit.face, world, sx: sp.x, sy: sp.y };
      }
    }
    if (best) return best;
    return { kind: 'face', face: hit.face, world: hit.point.clone(), sx: x, sy: y };
  }

  onMove(x: number, y: number, ev: PointerEvent): void {
    this.ctl.setMouse(x, y);
    this.hover = this.resolve(x, y, ev.ctrlKey);
    this.redraw();
  }

  onDown(x: number, y: number, ev: PointerEvent): void {
    const p = this.resolve(x, y, ev.ctrlKey);
    if (!p) return;
    this.points.push(p);
    this.redraw();
    this.text();
  }

  private redraw(): void {
    const pos: number[] = [];
    const dots: number[] = [];
    const all = [...this.cuts, this.points];
    for (const list of all) {
      for (let i = 0; i < list.length; i++) {
        dots.push(list[i].world.x, list[i].world.y, list[i].world.z);
        if (i > 0) {
          const a = list[i - 1].world;
          const b = list[i].world;
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    if (this.points.length && this.hover) {
      const a = this.points[this.points.length - 1].world;
      pos.push(a.x, a.y, a.z, this.hover.world.x, this.hover.world.y, this.hover.world.z);
    }
    if (this.hover) dots.push(this.hover.world.x, this.hover.world.y, this.hover.world.z);
    this.preview.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.dots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    this.preview.geometry.computeBoundingSphere();
    this.dots.geometry.computeBoundingSphere();
  }

  onKey(ev: KeyboardEvent): boolean {
    const k = ev.key.toLowerCase();
    if (k === 'z') {
      this.cutThrough = !this.cutThrough;
      this.text();
      return true;
    }
    if (k === 'e') {
      if (this.points.length > 1) this.cuts.push(this.points);
      this.points = [];
      this.redraw();
      return true;
    }
    return false;
  }

  private stepsFor(list: KnifePoint[]): loop.KnifeCut | null {
    if (list.length < 2) return null;
    const ctx = this.ctl.pickCtx(this.obj)!;
    const m = this.obj.mesh;
    const S = projectAll(ctx);
    const inv = new THREE.Matrix4().copy(this.obj.object.matrixWorld).invert();
    const toLocal = (w: THREE.Vector3): V3 => {
      const l = w.clone().applyMatrix4(inv);
      return [l.x, l.y, l.z];
    };
    const stepOf = (p: KnifePoint): loop.KnifeStep =>
      p.kind === 'vert' ? { kind: 'vert', v: p.v! } : p.kind === 'edge' ? { kind: 'edge', a: p.a!, b: p.b!, t: p.t!, pos: toLocal(p.world) } : { kind: 'face', face: p.face, pos: toLocal(p.world) };
    const facesOf = (s: loop.KnifeStep): number[] => (s.kind === 'vert' ? m.vertFaces()[s.v] : s.kind === 'edge' ? m.edgeFaces(ek(s.a, s.b)) : [s.face]);
    const steps: loop.KnifeStep[] = [];
    const via: number[] = [];
    const em = m.edgeMap();
    for (let i = 0; i < list.length; i++) {
      const s0 = stepOf(list[i]);
      steps.push(s0);
      if (i === list.length - 1) break;
      const p0 = list[i];
      const p1 = list[i + 1];
      const s1 = stepOf(p1);
      // Crossings of the screen segment with mesh edges.
      const A: [number, number] = [p0.sx, p0.sy];
      const B: [number, number] = [p1.sx, p1.sy];
      const skipEdges = new Set<number>();
      const own = (s: loop.KnifeStep) => {
        if (s.kind === 'vert') for (const k of m.vertEdges()[s.v]) skipEdges.add(k);
        else if (s.kind === 'edge') skipEdges.add(ek(s.a, s.b));
      };
      own(s0);
      own(s1);
      const cross: { t: number; key: number; te: number; world: THREE.Vector3 }[] = [];
      for (const e of em.values()) {
        if (skipEdges.has(e.key)) continue;
        const Sa = S[e.a];
        const Sb = S[e.b];
        if (!Sa.ok || !Sb.ok) continue;
        const hit = segIntersect(A, B, [Sa.x, Sa.y], [Sb.x, Sb.y]);
        if (!hit || hit.t < 1e-3 || hit.t > 1 - 1e-3 || hit.u < 1e-3 || hit.u > 1 - 1e-3) continue;
        const wa = toWorld(this.obj, m.co[e.a]);
        const wb = toWorld(this.obj, m.co[e.b]);
        const len = wa.distanceTo(wb) || 1;
        const sx = A[0] + (B[0] - A[0]) * hit.t;
        const sy = A[1] + (B[1] - A[1]) * hit.t;
        const tt = closestOnLine(rayAt(this.ctl, sx, sy).ray, wa, wb.clone().sub(wa).normalize());
        const te = tt === null ? hit.u : Math.max(0.001, Math.min(0.999, tt / len));
        const world = wa.clone().lerp(wb, te);
        if (!this.cutThrough && !isVisible(ctx, world)) continue;
        cross.push({ t: hit.t, key: e.key, te, world });
      }
      cross.sort((x, y) => x.t - y.t);
      let prev = s0;
      for (const c of cross) {
        const info = em.get(c.key)!;
        const st: loop.KnifeStep = { kind: 'edge', a: info.a, b: info.b, t: c.te, pos: toLocal(c.world) };
        via.push(this.commonFace(prev, st, facesOf, m, S, ctx));
        steps.push(st);
        prev = st;
      }
      via.push(this.commonFace(prev, s1, facesOf, m, S, ctx));
    }
    return { steps, via };
  }

  private commonFace(a: loop.KnifeStep, b: loop.KnifeStep, facesOf: (s: loop.KnifeStep) => number[], m: EditMesh, S: ReturnType<typeof projectAll>, ctx: PickCtx): number {
    const fa = new Set(facesOf(a));
    const common = facesOf(b).filter((f) => fa.has(f));
    if (common.length <= 1) return common[0] ?? facesOf(b)[0] ?? 0;
    // Choose the face containing the midpoint between both points on screen.
    const pos = (s: loop.KnifeStep): [number, number] => {
      if (s.kind === 'vert') return [S[s.v].x, S[s.v].y];
      const A = m.co[s.kind === 'edge' ? s.a : 0];
      void A;
      const w = s.kind === 'edge' ? toWorld(this.obj, s.pos) : toWorld(this.obj, s.pos);
      const sp = projectWorld(ctx.camera, ctx.width, ctx.height, w);
      return [sp.x, sp.y];
    };
    const pa = pos(a);
    const pb = pos(b);
    const mid: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    for (const f of common) {
      const poly: [number, number][] = m.faces[f].map((v) => [S[v].x, S[v].y]);
      if (pointInPolygon(mid[0], mid[1], poly)) {
        if (this.cutThrough || isVisibleFace(ctx, m, f, this.obj, mid, this.ctl)) return f;
      }
    }
    return common[0];
  }

  private dispose(): void {
    for (const o of [this.preview, this.dots]) {
      this.ctl.sm.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }

  confirm(): void {
    const lists = [...this.cuts];
    if (this.points.length > 1) lists.push(this.points);
    let did = false;
    const e = this.obj;
    const collected: number[] = [];
    for (const list of lists) {
      const cut = this.stepsFor(list);
      if (!cut) continue;
      const r = loop.applyKnife(e.mesh, cut);
      if (r.ok) did = true;
      collected.push(...r.verts);
    }
    this.dispose();
    if (did) {
      e.mesh.touch();
      const orphan = e.mesh.orphanVerts();
      const remap = orphan.size ? e.mesh.removeVerts(orphan) : null;
      const c = this.ctl;
      c.sel.clear();
      for (const v of collected) {
        const nv = remap ? remap[v] : v;
        if (nv >= 0 && nv < e.mesh.co.length) c.sel.v.add(nv);
      }
      flushSelection(e.mesh, c.sel, 'vert');
      c.setSelectMode('vert');
      c.refreshEdit();
      c.changed();
    } else {
      this.ctl.discardUndo(this.snap);
      this.ctl.toast('Knife: nothing was cut');
    }
    this.ctl.endModal();
  }

  cancel(): void {
    this.dispose();
    this.ctl.discardUndo(this.snap);
    this.ctl.endModal();
  }
}

function isVisibleFace(ctx: PickCtx, _m: EditMesh, face: number, obj: EditableObject, at: [number, number], ctl: ModelingController): boolean {
  const hit = pickFace(ctx, at[0], at[1]);
  void obj;
  void ctl;
  return !!hit && hit.face === face;
}

// ── Box / Circle / Lasso select ───────────────────────────────────────────

function applyRegion(ctl: ModelingController, inside: (sx: number, sy: number) => boolean, mode: 'set' | 'add' | 'sub', crossing: (a: [number, number], b: [number, number]) => boolean = () => false): void {
  const e = ctl.editObj;
  const ctx = ctl.pickCtx();
  if (!e || !ctx) return;
  const m = e.mesh;
  const S = projectAll(ctx);
  const s = ctl.sel;
  if (mode === 'set') s.clear();
  const w = new THREE.Vector3();
  const vis = (v: number) => isVisible(ctx, toWorld(e, m.co[v], w));
  const sm = ctl.selectMode;
  const insideV = new Map<number, boolean>();
  const isIn = (v: number) => {
    let r = insideV.get(v);
    if (r === undefined) {
      r = S[v].ok && !m.hidden.has(v) && inside(S[v].x, S[v].y) && vis(v);
      insideV.set(v, r);
    }
    return r;
  };
  const target = sm === 'vert' ? s.v : sm === 'edge' ? s.e : s.f;
  const put = (id: number) => (mode === 'sub' ? target.delete(id) : target.add(id));
  if (sm === 'vert') {
    for (let i = 0; i < m.co.length; i++) if (isIn(i)) put(i);
  } else if (sm === 'edge') {
    let any = false;
    for (const ed of m.edgeMap().values()) {
      if (isIn(ed.a) && isIn(ed.b)) {
        put(ed.key);
        any = true;
      }
    }
    if (!any) {
      for (const ed of m.edgeMap().values()) {
        if (!S[ed.a].ok || !S[ed.b].ok) continue;
        if (crossing([S[ed.a].x, S[ed.a].y], [S[ed.b].x, S[ed.b].y])) {
          const mid = v3.lerp(m.co[ed.a], m.co[ed.b], 0.5);
          if (isVisible(ctx, toWorld(e, mid, w))) put(ed.key);
        }
      }
    }
  } else {
    for (let fi = 0; fi < m.faces.length; fi++) {
      if (m.faces[fi].some((v) => m.hidden.has(v))) continue;
      const c = m.faceCenter(fi);
      const sp = projectWorld(ctx.camera, ctx.width, ctx.height, toWorld(e, c, w));
      if (sp.ok && inside(sp.x, sp.y) && isVisible(ctx, toWorld(e, c, w))) put(fi);
    }
  }
  flushSelection(m, s, sm);
  s.active = null;
  ctl.refreshEdit();
}

function segIntersectsRect(a: [number, number], b: [number, number], r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const edges: [[number, number], [number, number]][] = [
    [[r.x0, r.y0], [r.x1, r.y0]],
    [[r.x1, r.y0], [r.x1, r.y1]],
    [[r.x1, r.y1], [r.x0, r.y1]],
    [[r.x0, r.y1], [r.x0, r.y0]],
  ];
  const inside = (p: [number, number]) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
  if (inside(a) || inside(b)) return true;
  return edges.some(([c, d]) => segIntersect(a, b, c, d) !== null);
}

class OverlayDiv {
  el: HTMLDivElement;
  constructor(private ctl: ModelingController, css: string) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;pointer-events:none;z-index:40;' + css;
    (ctl.dom.parentElement ?? document.body).appendChild(this.el);
  }
  place(x0: number, y0: number, w: number, h: number): void {
    const cr = this.ctl.dom.getBoundingClientRect();
    const pr = (this.ctl.dom.parentElement ?? document.body).getBoundingClientRect();
    this.el.style.left = cr.left - pr.left + x0 + 'px';
    this.el.style.top = cr.top - pr.top + y0 + 'px';
    this.el.style.width = w + 'px';
    this.el.style.height = h + 'px';
  }
  remove(): void {
    this.el.remove();
  }
}

export class BoxSelectModal implements Modal {
  name = 'Box Select';
  private div: OverlayDiv;
  private x0: number;
  private y0: number;
  private x1: number;
  private y1: number;
  private mode: 'set' | 'add' | 'sub';

  constructor(private ctl: ModelingController, x: number, y: number, shift: boolean) {
    this.x0 = this.x1 = x;
    this.y0 = this.y1 = y;
    this.mode = shift ? 'add' : 'set';
    this.div = new OverlayDiv(ctl, 'border:1px dashed #fff;background:rgba(255,255,255,0.06);');
    this.draw();
    useModelingStore.setState({ hint: 'Drag to box select · Shift extends · Ctrl subtracts · Esc/RMB cancel' });
  }
  private draw(): void {
    this.div.place(Math.min(this.x0, this.x1), Math.min(this.y0, this.y1), Math.abs(this.x1 - this.x0), Math.abs(this.y1 - this.y0));
  }
  onMove(x: number, y: number, ev: PointerEvent): void {
    this.x1 = x;
    this.y1 = y;
    if (ev.ctrlKey) this.mode = 'sub';
    this.draw();
  }
  onUp(x: number, y: number): void {
    this.x1 = x;
    this.y1 = y;
    this.confirm();
  }
  onDown(): void {}
  onKey(): boolean {
    return false;
  }
  confirm(): void {
    const r = { x0: Math.min(this.x0, this.x1), y0: Math.min(this.y0, this.y1), x1: Math.max(this.x0, this.x1), y1: Math.max(this.y0, this.y1) };
    this.div.remove();
    if (r.x1 - r.x0 > 2 || r.y1 - r.y0 > 2) {
      this.ctl.pushUndo('Box Select');
      applyRegion(this.ctl, (sx, sy) => sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1, this.mode, (a, b) => segIntersectsRect(a, b, r));
    }
    this.ctl.endModal();
  }
  cancel(): void {
    this.div.remove();
    this.ctl.endModal();
  }
}

export class CircleSelectModal implements Modal {
  name = 'Circle Select';
  private div: OverlayDiv;
  private radius = 40;
  private x: number;
  private y: number;
  private sub = false;
  private painted = false;

  constructor(private ctl: ModelingController, x: number, y: number, shift: boolean) {
    void shift;
    this.x = x;
    this.y = y;
    this.div = new OverlayDiv(ctl, 'border:1px solid #fff;border-radius:50%;background:rgba(255,255,255,0.08);');
    this.draw();
    this.paint(false);
    useModelingStore.setState({ hint: 'Drag to paint selection · wheel = brush size · Ctrl/MMB deselects · release to finish' });
  }
  private draw(): void {
    this.div.place(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
  }
  private paint(sub: boolean): void {
    if (!this.painted) {
      this.ctl.pushUndo('Circle Select');
      this.painted = true;
    }
    const { x, y, radius } = this;
    applyRegion(this.ctl, (sx, sy) => Math.hypot(sx - x, sy - y) <= radius, sub ? 'sub' : 'add', () => false);
  }
  onMove(x: number, y: number, ev: PointerEvent): void {
    this.x = x;
    this.y = y;
    this.sub = ev.ctrlKey || (ev.buttons & 4) !== 0;
    this.draw();
    this.paint(this.sub);
  }
  onUp(): void {
    this.confirm();
  }
  onDown(): void {}
  onKey(): boolean {
    return false;
  }
  onWheel(ev: WheelEvent): boolean {
    this.radius = Math.max(8, Math.min(300, this.radius * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    this.draw();
    return true;
  }
  confirm(): void {
    this.div.remove();
    this.ctl.endModal();
  }
  cancel(): void {
    this.confirm();
  }
}

export class LassoModal implements Modal {
  name = 'Lasso Select';
  private poly: [number, number][] = [];
  private canvas: HTMLCanvasElement;
  private mode: 'set' | 'add' | 'sub';

  constructor(private ctl: ModelingController, x: number, y: number, shift: boolean) {
    this.mode = shift ? 'add' : 'set';
    this.poly.push([x, y]);
    this.canvas = document.createElement('canvas');
    const r = ctl.dom.getBoundingClientRect();
    const pr = (ctl.dom.parentElement ?? document.body).getBoundingClientRect();
    this.canvas.width = r.width;
    this.canvas.height = r.height;
    this.canvas.style.cssText = `position:absolute;pointer-events:none;z-index:40;left:${r.left - pr.left}px;top:${r.top - pr.top}px;`;
    (ctl.dom.parentElement ?? document.body).appendChild(this.canvas);
    useModelingStore.setState({ hint: 'Drag a free-form loop to select · Shift extends · Ctrl subtracts' });
  }
  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.strokeStyle = '#fff';
    g.setLineDash([5, 4]);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    this.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.stroke();
  }
  onMove(x: number, y: number, ev: PointerEvent): void {
    this.poly.push([x, y]);
    if (ev.ctrlKey) this.mode = 'sub';
    this.draw();
  }
  onUp(): void {
    this.confirm();
  }
  onDown(): void {}
  onKey(): boolean {
    return false;
  }
  confirm(): void {
    this.canvas.remove();
    if (this.poly.length > 3) {
      this.ctl.pushUndo('Lasso Select');
      const poly = this.poly;
      applyRegion(this.ctl, (sx, sy) => pointInPolygon(sx, sy, poly), this.mode);
    }
    this.ctl.endModal();
  }
  cancel(): void {
    this.canvas.remove();
    this.ctl.endModal();
  }
}

// ── Poly Build ────────────────────────────────────────────────────────────

export class PolyBuildModal implements Modal {
  name = 'Poly Build';
  private obj: EditableObject;
  private dragVert = -1;
  private moved = false;
  private downPos = { x: 0, y: 0 };

  constructor(private ctl: ModelingController, private snap: WorldSnapshot) {
    this.obj = ctl.editObj!;
    ctl.setModalText(this.name, 'Click empty space: new vertex · click a boundary edge: extend a triangle · drag a vertex: move · Shift+click: delete');
  }

  private planePoint(x: number, y: number, through: THREE.Vector3): V3 {
    const ray = rayAt(this.ctl, x, y);
    const n = this.ctl.sm.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, through);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, p)) p.copy(through);
    const l = this.obj.object.worldToLocal(p);
    return [l.x, l.y, l.z];
  }

  onDown(x: number, y: number, ev: PointerEvent): void {
    const ctx = this.ctl.pickCtx(this.obj)!;
    const m = this.obj.mesh;
    const s = this.ctl.sel;
    this.downPos = { x, y };
    const S = projectAll(ctx);
    const v = pickVertex(ctx, x, y, 14, S);
    if (ev.shiftKey) {
      // delete what is under the cursor
      if (v >= 0) {
        s.clear();
        s.v.add(v);
        deleteSelection(m, s, 'verts');
        this.finishClick();
        return;
      }
      const ed = pickEdge(ctx, x, y, 12, S);
      if (ed) {
        s.clear();
        s.e.add(ed.key);
        deleteSelection(m, s, 'edges');
        this.finishClick();
        return;
      }
      this.finishClick();
      return;
    }
    if (v >= 0) {
      this.dragVert = v;
      s.clear();
      s.v.add(v);
      s.active = { type: 'vert', id: v };
      this.ctl.setSelectMode('vert');
      flushSelection(m, s, 'vert');
      this.ctl.refreshEdit();
      return;
    }
    const ed = pickEdge(ctx, x, y, 12, S);
    if (ed) {
      const info = m.edgeMap().get(ed.key)!;
      const mid = toWorld(this.obj, v3.lerp(m.co[info.a], m.co[info.b], 0.5));
      const p = this.planePoint(x, y, mid);
      const nv = m.addVert(p);
      let a = info.a;
      let b = info.b;
      if (info.faces.length) {
        const f = m.faces[info.faces[0]];
        const ia = f.indexOf(a);
        if (f[(ia + 1) % f.length] === b) [a, b] = [b, a];
      }
      m.addFace([a, b, nv]);
      s.clear();
      s.v.add(nv);
      s.active = { type: 'vert', id: nv };
      m.touch();
      this.ctl.setSelectMode('vert');
      flushSelection(m, s, 'vert');
      this.dragVert = nv;
      this.ctl.refreshEdit();
      this.ctl.changed();
      return;
    }
    // Empty space: new vertex, connected to the active vertex if there is one.
    const act = s.active?.type === 'vert' ? s.active.id : -1;
    const through = act >= 0 ? toWorld(this.obj, m.co[act]) : this.ctl.cursor.clone();
    const p = this.planePoint(x, y, through);
    const nv = m.addVert(p);
    if (act >= 0) m.addLoose(act, nv);
    s.clear();
    s.v.add(nv);
    s.active = { type: 'vert', id: nv };
    m.touch();
    this.ctl.setSelectMode('vert');
    flushSelection(m, s, 'vert');
    this.dragVert = nv;
    this.ctl.refreshEdit();
    this.ctl.changed();
  }

  private finishClick(): void {
    const m = this.obj.mesh;
    m.touch();
    this.ctl.sel.clear();
    this.ctl.refreshEdit();
    this.ctl.changed();
    this.ctl.endModal();
  }

  onMove(x: number, y: number): void {
    if (this.dragVert < 0) return;
    if (Math.hypot(x - this.downPos.x, y - this.downPos.y) > 3) this.moved = true;
    if (!this.moved) return;
    const m = this.obj.mesh;
    const through = toWorld(this.obj, m.co[this.dragVert]);
    m.co[this.dragVert] = this.planePoint(x, y, through);
    m.touch();
    this.ctl.refreshEdit();
    this.ctl.changed();
  }

  onUp(): void {
    // Closing a triangle when the new vertex was dropped on another one is left to Merge (M).
    this.ctl.endModal();
    this.ctl.refreshEdit();
    this.ctl.changed();
  }

  onKey(): boolean {
    return false;
  }
  confirm(): void {
    this.ctl.endModal();
  }
  cancel(): void {
    this.ctl.discardUndo(this.snap);
    this.ctl.endModal();
  }
}

// ── Edge / Vertex slide ───────────────────────────────────────────────────

export class SlideModal implements Modal {
  name: string;
  valid = false;
  private obj: EditableObject;
  private base: EditMesh;
  private items: { v: number; a: V3 | null; b: V3 | null; orig: V3; dirA: [number, number]; dirB: [number, number] }[] = [];
  private factor = 0;
  private startMouse: { x: number; y: number } | null = null;
  private avgLen = 100;

  constructor(private ctl: ModelingController, private snap: WorldSnapshot, private kind: 'edge' | 'vertex') {
    this.name = kind === 'edge' ? 'Edge Slide' : 'Vertex Slide';
    this.obj = ctl.editObj!;
    this.base = this.obj.mesh.clone();
    this.build();
    this.text();
  }

  private build(): void {
    const m = this.obj.mesh;
    const s = this.ctl.sel;
    const ctx = this.ctl.pickCtx(this.obj)!;
    const S = projectAll(ctx);
    const ve = m.vertEdges();
    const em = m.edgeMap();
    const verts = this.kind === 'vertex' ? Array.from(s.v).slice(0, 1) : Array.from(new Set(Array.from(s.e).flatMap((k) => [ekLo(k), ekHi(k)])));
    if (!verts.length || (this.kind === 'vertex' && s.v.size !== 1)) return;
    let lenSum = 0;
    for (const v of verts) {
      const rails: number[] = [];
      if (this.kind === 'vertex') {
        for (const k of ve[v]) rails.push(ekLo(k) === v ? ekHi(k) : ekLo(k));
      } else {
        for (const k of ve[v]) {
          if (s.e.has(k)) continue;
          const info = em.get(k)!;
          // A rail is a non-selected edge sharing a face with a selected edge at this vertex.
          const shares = info.faces.some((f) => ve[v].some((sk) => s.e.has(sk) && em.get(sk)!.faces.includes(f)));
          if (shares) rails.push(ekLo(k) === v ? ekHi(k) : ekLo(k));
        }
      }
      if (!rails.length) continue;
      const dirs = rails.map((o) => [S[o].x - S[v].x, S[o].y - S[v].y] as [number, number]);
      let iA = 0;
      let iB = -1;
      if (this.kind === 'edge' && rails.length > 1) {
        // opposite rail = the one pointing most against rail A on screen
        let worst = Infinity;
        for (let i = 1; i < rails.length; i++) {
          const d = (dirs[0][0] * dirs[i][0] + dirs[0][1] * dirs[i][1]) / ((Math.hypot(...dirs[0]) || 1) * (Math.hypot(...dirs[i]) || 1));
          if (d < worst) {
            worst = d;
            iB = i;
          }
        }
      }
      this.items.push({
        v,
        a: m.co[rails[iA]],
        b: iB >= 0 ? m.co[rails[iB]] : null,
        orig: v3.copy(m.co[v]),
        dirA: dirs[iA],
        dirB: iB >= 0 ? dirs[iB] : [0, 0],
      });
      lenSum += Math.hypot(...dirs[iA]);
    }
    this.avgLen = Math.max(20, lenSum / Math.max(1, this.items.length));
    this.valid = this.items.length > 0;
  }

  private text(): void {
    this.ctl.setModalText(this.name, `Factor: ${this.factor.toFixed(3)}`);
    useModelingStore.setState({ hint: 'Move the mouse along the slide direction · LMB/Enter confirm · RMB/Esc cancel' });
  }

  onMove(x: number, y: number): void {
    if (!this.startMouse) this.startMouse = { x, y };
    // Project the mouse delta onto the first rail direction.
    const it = this.items[0];
    const dl = Math.hypot(it.dirA[0], it.dirA[1]) || 1;
    const dx = x - this.startMouse.x;
    const dy = y - this.startMouse.y;
    let f = ((dx * it.dirA[0] + dy * it.dirA[1]) / dl) / this.avgLen;
    f = Math.max(this.kind === 'edge' ? -1 : 0, Math.min(1, f));
    this.factor = f;
    const m = this.obj.mesh;
    for (const i of this.items) {
      const target = f >= 0 ? i.a : i.b;
      if (!target) continue;
      m.co[i.v] = v3.lerp(i.orig, target, Math.abs(f));
    }
    m.touch();
    this.ctl.refreshEdit();
    this.ctl.changed();
    this.text();
  }

  onKey(): boolean {
    return false;
  }
  confirm(): void {
    this.ctl.endModal();
    this.ctl.changed();
  }
  cancel(): void {
    restoreMesh(this.obj.mesh, this.base);
    this.ctl.discardUndo(this.snap);
    this.ctl.endModal();
    this.ctl.changed();
  }
}
