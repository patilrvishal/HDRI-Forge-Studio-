import * as THREE from 'three';
import type { SceneManager } from '../three/engine';
import { useModelingStore, type LastOp, type ModelSelectMode, type OpField, type MenuKind } from '../store/modelingStore';
import { useSceneHierarchyStore } from '../store/sceneHierarchyStore';
import { useLightsStore } from '../store/lightsStore';
import {
  EditMesh,
  Selection,
  convertSelectMode,
  ek,
  ekLo,
  ekHi,
  flushSelection,
  selectAll,
  selectionBoundsCenter,
  selectionMedian,
  selectionNormal,
  v3,
  type SelectMode,
  type V3,
} from './EditMesh';
import { EditableObject, uniqueName, type EditableObjectJSON } from './EditableObject';
import { EditOverlay } from './EditOverlay';
import { makePrimitive, PRIMITIVE_LABELS, type PrimitiveKind, type PrimitiveParams } from './primitives';
import * as core from './opsCore';
import * as shape from './opsShape';
import * as loop from './opsLoop';
import * as selOps from './opsSelect';
import { pickCtxFor, pickEdge, pickFace, pickVertex, projectAll, toWorld, type PickCtx } from './Picking';
import type { Modal, WorldSnapshot, WorldSnapshotObject } from './ctlTypes';
import {
  BevelModal,
  BoxSelectModal,
  CircleSelectModal,
  InsetModal,
  KnifeModal,
  LassoModal,
  LoopCutModal,
  PolyBuildModal,
  SlideModal,
  TransformModal,
  type TransformKind,
} from './ctlModals';

const CLICK_SLOP = 5;

export interface ModelingHooks {
  /** Called after any geometry / transform change so the path tracer etc. can refresh. */
  onChanged?: () => void;
}

export class ModelingController {
  readonly sm: SceneManager;
  readonly dom: HTMLCanvasElement;
  readonly objects = new Map<string, EditableObject>();
  activeId: string | null = null;
  selectedIds = new Set<string>();
  mode: 'object' | 'edit' = 'object';
  selectMode: SelectMode = 'vert';
  sel = new Selection();
  overlay: EditOverlay | null = null;
  modal: Modal | null = null;
  cursor = new THREE.Vector3(0, 0, 0);
  private cursorObj: THREE.Group;
  private hooks: ModelingHooks;
  private undoStack: WorldSnapshot[] = [];
  private redoStack: WorldSnapshot[] = [];
  private pointerInside = false;
  private down: { x: number; y: number; button: number; shift: boolean; alt: boolean; ctrl: boolean; time: number } | null = null;
  private lastAPress = 0;
  private shiftSpaceAt = 0;
  private disposed = false;
  private unsubStore: (() => void) | null = null;
  private unsubLights: (() => void) | null = null;
  private lastOpRun: { snapshot: WorldSnapshot; run: (v: Record<string, number | boolean | string>) => void; fields: OpField[]; name: string } | null = null;

  constructor(sm: SceneManager, hooks: ModelingHooks = {}) {
    this.sm = sm;
    this.dom = sm.renderer.domElement;
    this.hooks = hooks;
    this.cursorObj = this.makeCursor();
    sm.scene.add(this.cursorObj);
    this.attach();
    this.unsubStore = useSceneHierarchyStore.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId && s.selectedId) {
        const mine = Array.from(this.objects.values()).find((o) => o.object.uuid === s.selectedId);
        if (mine && this.activeId !== mine.id && this.mode === 'object') this.selectObject(mine.id, false, true);
        // Something else (a light, the loaded model) took the selection: release ours so G/R/S go to it.
        else if (!mine && this.selectedIds.size && this.mode === 'object') this.selectObject(null, false, true);
      }
    });
    this.unsubLights = useLightsStore.subscribe((s, prev) => {
      if (s.selectedLightId !== prev.selectedLightId && s.selectedLightId && this.selectedIds.size && this.mode === 'object') {
        this.selectObject(null, false, true);
      }
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  private attach(): void {
    const d = this.dom;
    d.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    d.addEventListener('contextmenu', this.onContext, true);
    d.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    d.addEventListener('pointerenter', this.onEnter);
    d.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  dispose(): void {
    this.disposed = true;
    const d = this.dom;
    d.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    d.removeEventListener('contextmenu', this.onContext, true);
    d.removeEventListener('wheel', this.onWheel, true);
    d.removeEventListener('pointerenter', this.onEnter);
    d.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.unsubStore?.();
    this.unsubLights?.();
    this.exitEdit(false);
    for (const o of this.objects.values()) {
      this.sm.scene.remove(o.object);
      o.dispose();
    }
    this.objects.clear();
    this.sm.scene.remove(this.cursorObj);
    useModelingStore.setState({ mode: 'object', objects: [], activeId: null, selectedIds: [], item: null, modal: null, menu: null, lastOp: null });
  }

  private makeCursor(): THREE.Group {
    const g = new THREE.Group();
    g.userData.isHelper = true;
    const mat = (c: number) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, toneMapped: false });
    const ring = (r: number, c: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) pts.push(new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2) * r, 0, Math.sin((i / 48) * Math.PI * 2) * r));
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat(c));
    };
    const cross = (c: number) => {
      const s = 0.22;
      const pts = [new THREE.Vector3(-s, 0, 0), new THREE.Vector3(-0.08, 0, 0), new THREE.Vector3(0.08, 0, 0), new THREE.Vector3(s, 0, 0), new THREE.Vector3(0, 0, -s), new THREE.Vector3(0, 0, -0.08), new THREE.Vector3(0, 0, 0.08), new THREE.Vector3(0, 0, s)];
      return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat(c));
    };
    const r1 = ring(0.1, 0xff2020);
    const r2 = ring(0.1, 0xffffff);
    (r2.material as THREE.LineBasicMaterial).opacity = 0.5;
    g.add(r1, cross(0xff2020), cross(0xffffff));
    g.add(r2);
    g.traverse((o) => {
      o.userData.isHelper = true;
      o.raycast = () => {};
      o.renderOrder = 999;
      o.frustumCulled = false;
    });
    return g;
  }

  // ── Store sync ───────────────────────────────────────────────────────────
  private store = () => useModelingStore.getState();
  private set = (p: Partial<ReturnType<typeof useModelingStore.getState>>) => useModelingStore.setState(p);

  toast(text: string): void {
    this.store().showToast(text);
  }

  get editObj(): EditableObject | null {
    return this.mode === 'edit' && this.activeId ? this.objects.get(this.activeId) ?? null : null;
  }
  get active(): EditableObject | null {
    return this.activeId ? this.objects.get(this.activeId) ?? null : null;
  }

  syncStore(): void {
    const objs = Array.from(this.objects.values()).map((o) => ({ id: o.id, name: o.name, visible: o.object.visible }));
    const e = this.editObj;
    let stats = { vertsSel: 0, vertsTotal: 0, edgesSel: 0, edgesTotal: 0, facesSel: 0, facesTotal: 0, tris: 0 };
    if (e) {
      stats = {
        vertsSel: this.sel.v.size,
        vertsTotal: e.mesh.co.length,
        edgesSel: this.sel.e.size,
        edgesTotal: e.mesh.edgeMap().size,
        facesSel: this.sel.f.size,
        facesTotal: e.mesh.faces.length,
        tris: e.triToFace.length,
      };
    } else if (this.activeId) {
      const a = this.active;
      if (a) stats = { ...stats, vertsTotal: a.mesh.co.length, edgesTotal: a.mesh.edgeMap().size, facesTotal: a.mesh.faces.length, tris: a.triToFace.length };
    }
    const a = this.active;
    let item = null as ReturnType<typeof useModelingStore.getState>['item'];
    if (a) {
      const mat = a.material;
      item = {
        label: a.name,
        loc: a.object.position.toArray() as [number, number, number],
        rot: [a.object.rotation.x, a.object.rotation.y, a.object.rotation.z],
        scale: a.object.scale.toArray() as [number, number, number],
        median: e && this.sel.v.size ? (selectionMedian(e.mesh, this.sel) as [number, number, number]) : null,
        material: { color: '#' + mat.color.getHexString(), roughness: mat.roughness, metalness: mat.metalness, clearcoat: mat.clearcoat, emissive: '#' + mat.emissive.getHexString(), emissiveIntensity: mat.emissiveIntensity },
        smooth: a.mesh.smooth,
      };
    }
    this.set({
      mode: this.mode,
      selectMode: this.selectMode as ModelSelectMode,
      objects: objs,
      activeId: this.activeId,
      selectedIds: Array.from(this.selectedIds),
      stats,
      item,
    });
  }

  changed(): void {
    this.hooks.onChanged?.();
  }

  private pruneDetached(): void {
    for (const [id, o] of Array.from(this.objects)) {
      if (!o.object.parent) {
        if (this.editObj === o) this.exitEdit(false);
        o.dispose();
        this.objects.delete(id);
        this.selectedIds.delete(id);
        if (this.activeId === id) this.activeId = null;
      }
    }
  }

  // ── Undo ─────────────────────────────────────────────────────────────────
  private takeSnapshot(label: string): WorldSnapshot {
    const objects: WorldSnapshotObject[] = Array.from(this.objects.values()).map((o) => {
      const j = o.toJSON();
      return {
        id: o.id,
        name: o.name,
        mesh: o.mesh.clone(),
        position: o.object.position.toArray() as [number, number, number],
        quaternion: o.object.quaternion.toArray() as [number, number, number, number],
        scale: o.object.scale.toArray() as [number, number, number],
        material: j.material,
        visible: o.object.visible,
      };
    });
    return { label, time: Date.now(), objects, activeId: this.activeId, selectedIds: Array.from(this.selectedIds), mode: this.mode, selectMode: this.selectMode, sel: this.sel.clone() };
  }

  /** Drop the undo entry for an operation that was cancelled. */
  discardUndo(snap: WorldSnapshot): void {
    const i = this.undoStack.lastIndexOf(snap);
    if (i >= 0) this.undoStack.splice(i, 1);
  }

  pushUndo(label: string): WorldSnapshot {
    const snap = this.takeSnapshot(label);
    this.undoStack.push(snap);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    return snap;
  }

  private restoreSnapshot(s: WorldSnapshot): void {
    if (this.editObj) this.exitEdit(false);
    const keep = new Set(s.objects.map((o) => o.id));
    for (const [id, o] of Array.from(this.objects)) {
      if (!keep.has(id)) {
        this.sm.scene.remove(o.object);
        o.dispose();
        this.objects.delete(id);
      }
    }
    for (const so of s.objects) {
      let o = this.objects.get(so.id);
      if (!o) {
        o = new EditableObject(so.name, so.mesh.clone(), so.id);
        this.objects.set(so.id, o);
        this.sm.scene.add(o.object);
      } else {
        o.mesh = so.mesh.clone();
        o.mesh.touch();
      }
      o.setName(so.name);
      o.object.position.fromArray(so.position);
      o.object.quaternion.fromArray(so.quaternion);
      o.object.scale.fromArray(so.scale);
      o.object.visible = so.visible;
      const mat = o.material;
      mat.color.set(so.material.color);
      mat.roughness = so.material.roughness;
      mat.metalness = so.material.metalness;
      mat.clearcoat = so.material.clearcoat;
      mat.emissive.set(so.material.emissive);
      mat.emissiveIntensity = so.material.emissiveIntensity;
      o.rebuild(true);
    }
    this.activeId = s.activeId && this.objects.has(s.activeId) ? s.activeId : null;
    this.selectedIds = new Set(s.selectedIds.filter((id) => this.objects.has(id)));
    this.selectMode = s.selectMode;
    this.sel = s.sel.clone();
    if (s.mode === 'edit' && this.activeId) this.enterEdit(false);
    this.refreshEdit();
    this.changed();
  }

  undo(): boolean {
    if (this.modal) return true;
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.takeSnapshot('redo'));
    this.restoreSnapshot(prev);
    this.toast('Undo: ' + prev.label);
    return true;
  }
  redo(): boolean {
    if (this.modal) return true;
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.takeSnapshot('undo'));
    this.restoreSnapshot(next);
    this.toast('Redo');
    return true;
  }
  /** Time of the newest undo entry (used to interleave with the app's own undo stack). */
  newestUndoTime(): number {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].time : 0;
  }

  // ── Objects ──────────────────────────────────────────────────────────────
  addPrimitive(kind: PrimitiveKind, params: PrimitiveParams = {}, undo = true): EditableObject | null {
    if (undo) this.pushUndo('Add ' + PRIMITIVE_LABELS[kind]);
    const e = this.editObj;
    if (e) {
      // Blender: adding in Edit Mode merges the primitive into the edited mesh at the 3D cursor.
      const prim = makePrimitive(kind, params);
      const local = e.object.worldToLocal(this.cursor.clone());
      const base = e.mesh.co.length;
      for (const p of prim.co) e.mesh.addVert([p[0] + local.x, p[1] + local.y, p[2] + local.z]);
      for (const f of prim.faces) e.mesh.addFace(f.map((v) => v + base));
      for (const k of prim.loose) e.mesh.addLoose(ekLo(k) + base, ekHi(k) + base);
      this.sel.clear();
      for (let i = 0; i < prim.co.length; i++) this.sel.v.add(base + i);
      flushSelection(e.mesh, this.sel, 'vert');
      convertSelectMode(e.mesh, this.sel, 'vert', this.selectMode);
      e.mesh.touch();
      this.refreshEdit();
      this.changed();
      return e;
    }
    const mesh = makePrimitive(kind, params);
    const name = uniqueName(PRIMITIVE_LABELS[kind], Array.from(this.objects.values()).map((o) => o.name));
    const obj = new EditableObject(name, mesh);
    obj.object.position.copy(this.cursor);
    this.sm.scene.add(obj.object);
    this.objects.set(obj.id, obj);
    this.selectObject(obj.id, false, false);
    this.changed();
    this.setLastOp(
      'Add ' + PRIMITIVE_LABELS[kind],
      primitiveFields(kind, params),
      (vals) => {
        const cur = this.objects.get(obj.id);
        if (!cur) return;
        cur.mesh = makePrimitive(kind, { ...params, ...(vals as PrimitiveParams) });
        cur.mesh.touch();
        cur.rebuild(true);
        this.syncStore();
        this.changed();
      },
    );
    return obj;
  }

  selectObject(id: string | null, extend: boolean, fromHierarchy = false): void {
    if (this.mode === 'edit' && id !== this.activeId) this.exitEdit(true);
    if (!extend) this.selectedIds.clear();
    if (id) {
      if (extend && this.selectedIds.has(id) && this.activeId === id) this.selectedIds.delete(id);
      else this.selectedIds.add(id);
      this.activeId = this.selectedIds.has(id) ? id : this.selectedIds.values().next().value ?? null;
    } else this.activeId = null;
    this.updateSelectionOutline();
    this.syncStore();
    const a = this.active;
    if (a && useLightsStore.getState().selectedLightId) useLightsStore.getState().selectLight(null);
    if (a && !fromHierarchy) useSceneHierarchyStore.getState().select(a.object.uuid);
    if (!a && !fromHierarchy) {
      const cur = useSceneHierarchyStore.getState().selectedId;
      if (cur && Array.from(this.objects.values()).some((o) => o.object.uuid === cur)) useSceneHierarchyStore.getState().select(null);
    }
  }

  private outlines = new Map<string, THREE.LineSegments>();
  private updateSelectionOutline(): void {
    for (const [id, l] of Array.from(this.outlines)) {
      const o = this.objects.get(id);
      if (!o || !this.selectedIds.has(id) || this.mode === 'edit') {
        l.parent?.remove(l);
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
        this.outlines.delete(id);
      }
    }
    if (this.mode === 'edit') return;
    for (const id of this.selectedIds) {
      const o = this.objects.get(id);
      if (!o || this.outlines.has(id)) continue;
      const g = new THREE.EdgesGeometry(o.object.geometry, 30);
      const m = new THREE.LineBasicMaterial({ color: id === this.activeId ? 0xffa030 : 0xc0602a, toneMapped: false, depthWrite: false });
      const l = new THREE.LineSegments(g, m);
      l.userData.isHelper = true;
      l.raycast = () => {};
      l.renderOrder = 5;
      o.object.add(l);
      this.outlines.set(id, l);
    }
    // active vs selected colour
    for (const [id, l] of this.outlines) (l.material as THREE.LineBasicMaterial).color.set(id === this.activeId ? 0xffa030 : 0xc0602a);
  }
  /** Rebuild selection outlines after geometry changes. */
  private refreshOutlines(): void {
    for (const [id, l] of Array.from(this.outlines)) {
      l.parent?.remove(l);
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
      this.outlines.delete(id);
    }
    this.updateSelectionOutline();
  }

  deleteObjects(ids = Array.from(this.selectedIds)): void {
    if (!ids.length) return;
    this.pushUndo('Delete');
    if (this.mode === 'edit') this.exitEdit(false);
    for (const id of ids) {
      const o = this.objects.get(id);
      if (!o) continue;
      this.sm.scene.remove(o.object);
      o.dispose();
      this.objects.delete(id);
      this.selectedIds.delete(id);
    }
    if (this.activeId && !this.objects.has(this.activeId)) this.activeId = this.selectedIds.values().next().value ?? null;
    this.updateSelectionOutline();
    this.syncStore();
    this.changed();
  }

  duplicateObjects(): void {
    const ids = Array.from(this.selectedIds);
    if (!ids.length) return;
    this.pushUndo('Duplicate');
    const created: string[] = [];
    for (const id of ids) {
      const o = this.objects.get(id);
      if (!o) continue;
      const name = uniqueName(o.name.replace(/\.\d+$/, ''), Array.from(this.objects.values()).map((x) => x.name));
      const c = new EditableObject(name, o.mesh.clone());
      c.object.position.copy(o.object.position);
      c.object.quaternion.copy(o.object.quaternion);
      c.object.scale.copy(o.object.scale);
      const m = o.material;
      c.material.color.copy(m.color);
      c.material.roughness = m.roughness;
      c.material.metalness = m.metalness;
      c.material.clearcoat = m.clearcoat;
      c.material.emissive.copy(m.emissive);
      c.material.emissiveIntensity = m.emissiveIntensity;
      this.sm.scene.add(c.object);
      this.objects.set(c.id, c);
      created.push(c.id);
    }
    this.selectedIds = new Set(created);
    this.activeId = created[0] ?? null;
    this.updateSelectionOutline();
    this.syncStore();
    this.changed();
    this.startTransform('translate');
  }

  joinObjects(): void {
    const ids = Array.from(this.selectedIds).filter((id) => id !== this.activeId);
    const target = this.active;
    if (!target || !ids.length) return;
    this.pushUndo('Join');
    const inv = new THREE.Matrix4().copy(target.object.matrixWorld).invert();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (!o) continue;
      o.object.updateMatrixWorld(true);
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.object.matrixWorld);
      const base = target.mesh.co.length;
      const tmp = new THREE.Vector3();
      for (const p of o.mesh.co) {
        tmp.set(p[0], p[1], p[2]).applyMatrix4(m);
        target.mesh.addVert([tmp.x, tmp.y, tmp.z]);
      }
      for (const f of o.mesh.faces) target.mesh.addFace(f.map((v) => v + base));
      for (const k of o.mesh.loose) target.mesh.addLoose(ekLo(k) + base, ekHi(k) + base);
      this.sm.scene.remove(o.object);
      o.dispose();
      this.objects.delete(id);
      this.selectedIds.delete(id);
    }
    target.mesh.touch();
    target.rebuild();
    this.refreshOutlines();
    this.syncStore();
    this.changed();
  }

  // ── Mode switching ───────────────────────────────────────────────────────
  toggleMode(): void {
    if (this.mode === 'edit') this.exitEdit(true);
    else this.enterEdit(true);
  }

  enterEdit(undo = true): void {
    const o = this.active;
    if (!o) {
      this.toast('Select a mesh to edit (click it, or add one with Shift+A)');
      return;
    }
    if (undo) this.pushUndo('Enter Edit Mode');
    this.mode = 'edit';
    this.selectedIds = new Set([o.id]);
    this.updateSelectionOutline();
    this.overlay?.dispose();
    this.overlay = new EditOverlay(o);
    this.overlay.setXray(this.store().xray);
    if (this.sel.count === 0 || this.sel.v.size > o.mesh.co.length) this.sel.clear();
    flushSelection(o.mesh, this.sel, this.selectMode);
    this.refreshEdit();
    this.syncStore();
  }

  exitEdit(record: boolean): void {
    if (this.modal) this.modal.cancel();
    if (this.mode !== 'edit') return;
    void record;
    this.overlay?.dispose();
    this.overlay = null;
    this.mode = 'object';
    const o = this.active;
    if (o) {
      o.mesh.pruneLoose();
      o.rebuild(true);
    }
    this.refreshOutlines();
    this.syncStore();
    this.changed();
  }

  setSelectMode(mode: SelectMode): void {
    const e = this.editObj;
    if (!e || mode === this.selectMode) {
      this.selectMode = mode;
      this.syncStore();
      return;
    }
    convertSelectMode(e.mesh, this.sel, this.selectMode, mode);
    this.selectMode = mode;
    this.refreshEdit();
  }

  setXray(on: boolean): void {
    this.set({ xray: on });
    this.overlay?.setXray(on);
  }

  /** Re-read the mesh: rebuild geometry, overlay and stats. */
  refreshEdit(): void {
    const e = this.editObj;
    if (e) {
      e.rebuild();
      this.overlay?.update(this.sel, this.selectMode, { showNormals: this.store().showNormals });
    }
    this.syncStore();
  }

  pickCtx(obj?: EditableObject): PickCtx | null {
    const o = obj ?? this.editObj;
    if (!o) return null;
    const r = this.dom.getBoundingClientRect();
    return pickCtxFor(this.sm.camera, r.width, r.height, o, this.store().xray);
  }

  pointer(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.dom.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  // ── Modal management ─────────────────────────────────────────────────────
  startModal(m: Modal): void {
    if (this.modal) this.modal.cancel();
    this.modal = m;
    this.sm.controls.enabled = false;
    this.set({ menu: null });
  }
  endModal(): void {
    const wasBox = this.modal instanceof BoxSelectModal;
    this.modal = null;
    if (wasBox && this.oneShotBox) {
      this.oneShotBox = false;
      this.set({ tool: 'select' });
    }
    this.sm.controls.enabled = true;
    this.set({ modal: null, hint: '' });
    this.refreshEdit();
    this.syncStore();
  }
  setModalText(title: string, text: string): void {
    this.set({ modal: { title, text } });
  }

  startTransform(kind: TransformKind, opts: { axis?: 'x' | 'y' | 'z'; normal?: V3 | null; label?: string; onCancelUndo?: WorldSnapshot } = {}): void {
    if (this.mode === 'edit' && this.sel.v.size === 0) {
      this.toast('Nothing selected');
      return;
    }
    if (this.mode === 'object' && this.selectedIds.size === 0) return;
    const snap = opts.onCancelUndo ?? this.pushUndo(kindLabel(kind));
    this.startModal(new TransformModal(this, kind, snap, opts));
  }

  // ── Pointer / wheel / context ────────────────────────────────────────────
  private onEnter = () => (this.pointerInside = true);
  private onLeave = () => (this.pointerInside = false);

  private onPointerDown = (e: PointerEvent) => {
    if (this.disposed) return;
    this.pruneDetached();
    const p = this.pointer(e);
    if (this.modal) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.button === 2) this.modal.cancel();
      else if (this.modal.onDown) this.modal.onDown(p.x, p.y, e);
      else if (e.button === 0) this.modal.confirm();
      return;
    }
    if (e.button === 2 && e.shiftKey) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this.placeCursor(p.x, p.y);
      return;
    }
    if (e.button === 2 && e.ctrlKey && this.mode === 'edit') {
      e.stopImmediatePropagation();
      e.preventDefault();
      this.extrudeToCursor(p.x, p.y);
      return;
    }
    const tool = this.store().tool;
    if (e.button === 0 && this.mode === 'edit' && tool !== 'select') {
      e.stopImmediatePropagation();
      e.preventDefault();
      this.startTool(tool, p.x, p.y, e);
      return;
    }
    if (e.button === 0 && this.mode === 'edit' && tool === 'select' && e.altKey === false && this.pendingBox) {
      // handled by tool activation elsewhere
    }
    this.down = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, time: performance.now() };
    if (e.altKey && e.button === 0) {
      // Alt+click is a loop select, never an orbit.
      e.stopImmediatePropagation();
    }
    this.set({ menu: null });
  };
  private pendingBox = false;
  /** B key selects with a one-shot box; the toolbar button keeps the tool active. */
  private oneShotBox = false;

  persistTool(id: 'select' | 'box' | 'circle' | 'lasso' | 'knife' | 'loopcut' | 'polybuild' | 'cursor'): void {
    this.oneShotBox = false;
    this.set({ tool: id });
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.disposed) return;
    const p = this.pointer(e);
    this.lastMouse = p;
    if (this.modal) {
      this.modal.onMove(p.x, p.y, e);
      e.stopImmediatePropagation();
      return;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.disposed) return;
    const p = this.pointer(e);
    if (this.modal) {
      if (this.modal.onUp) this.modal.onUp(p.x, p.y, e);
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d || d.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
    if (e.target !== this.dom) return;
    this.handleClick(p.x, p.y, d);
  };

  private onContext = (e: MouseEvent) => {
    if (this.disposed) return;
    if (this.modal) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.shiftKey || e.ctrlKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (this.mode === 'edit') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const r = this.dom.getBoundingClientRect();
      this.set({ menu: { kind: 'context', x: e.clientX - r.left, y: e.clientY - r.top } });
    } else if (this.selectedIds.size > 0 && this.hitObject(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const r = this.dom.getBoundingClientRect();
      this.set({ menu: { kind: 'object', x: e.clientX - r.left, y: e.clientY - r.top } });
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.disposed) return;
    if (this.modal?.onWheel && this.modal.onWheel(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  private hitObject(cx: number, cy: number): EditableObject | null {
    const r = this.dom.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.sm.camera);
    const meshes = Array.from(this.objects.values()).filter((o) => o.object.visible).map((o) => o.object);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    return Array.from(this.objects.values()).find((o) => o.object === hit.object) ?? null;
  }

  private placeCursor(x: number, y: number): void {
    const r = this.dom.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), this.sm.camera);
    const meshes: THREE.Object3D[] = [];
    this.sm.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.isHelper && !o.userData.isProxy && o.name !== '__floor__' && o.visible) meshes.push(o);
    });
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) this.cursor.copy(hit.point);
    else {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const pt = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, pt)) this.cursor.copy(pt);
    }
    this.cursorObj.position.copy(this.cursor);
  }

  private handleClick(x: number, y: number, d: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    if (this.mode === 'edit') {
      this.editClick(x, y, d);
      return;
    }
    // Object mode: pick an editable object under the cursor.
    const r = this.dom.getBoundingClientRect();
    const hit = this.hitObject(x + r.left, y + r.top);
    if (hit) this.selectObject(hit.id, d.shift);
    else if (this.selectedIds.size && !d.shift) this.selectObject(null, false);
  }

  private editClick(x: number, y: number, d: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    const e = this.editObj;
    const ctx = this.pickCtx();
    if (!e || !ctx) return;
    const mesh = e.mesh;
    const S = projectAll(ctx);
    const mode = this.selectMode;
    const s = this.sel;
    if (d.alt) {
      const edge = pickEdge(ctx, x, y, 18, S);
      if (edge) {
        if (d.ctrl) selOps.selectRingAt(mesh, s, mode, edge.key, d.shift);
        else selOps.selectLoopAt(mesh, s, mode, edge.key, d.shift);
        s.active = null;
      } else if (!d.shift) s.clear();
      this.refreshEdit();
      return;
    }
    if (d.ctrl && !d.shift) {
      // Shortest path from the active/last vertex to the clicked one.
      const target = pickVertex(ctx, x, y, 22, S);
      const from = s.active?.type === 'vert' ? s.active.id : Array.from(s.v).pop();
      if (target >= 0 && from !== undefined) {
        this.pushUndo('Select Shortest Path');
        selOps.selectPath(mesh, s, mode, from, target);
        s.active = { type: 'vert', id: target };
        this.refreshEdit();
      }
      return;
    }
    let hit = false;
    if (mode === 'vert') {
      const v = pickVertex(ctx, x, y, 16, S);
      if (v >= 0) {
        hit = true;
        this.toggleSel(s.v, v, d.shift, { type: 'vert', id: v });
      }
    } else if (mode === 'edge') {
      const ed = pickEdge(ctx, x, y, 14, S);
      if (ed) {
        hit = true;
        this.toggleSel(s.e, ed.key, d.shift, { type: 'edge', id: ed.key });
      }
    } else {
      const f = pickFace(ctx, x, y, S);
      if (f) {
        hit = true;
        this.toggleSel(s.f, f.face, d.shift, { type: 'face', id: f.face });
      }
    }
    if (!hit && !d.shift) s.clear();
    flushSelection(mesh, s, mode);
    this.refreshEdit();
  }

  private toggleSel(set: Set<number>, id: number, extend: boolean, active: { type: SelectMode; id: number }): void {
    if (!extend) {
      this.sel.clear();
      set.add(id);
      this.sel.active = active;
      return;
    }
    if (set.has(id)) {
      if (this.sel.active && this.sel.active.type === active.type && this.sel.active.id === id) {
        set.delete(id);
        this.sel.active = null;
      } else this.sel.active = active;
    } else {
      set.add(id);
      this.sel.active = active;
    }
  }

  private startTool(tool: string, x: number, y: number, ev: PointerEvent): void {
    switch (tool) {
      case 'box':
        this.startModal(new BoxSelectModal(this, x, y, ev.shiftKey));
        break;
      case 'circle':
        this.startModal(new CircleSelectModal(this, x, y, ev.shiftKey));
        break;
      case 'lasso':
        this.startModal(new LassoModal(this, x, y, ev.shiftKey));
        break;
      case 'knife':
        this.startKnife();
        (this.modal as KnifeModal | null)?.onDown?.(x, y, ev);
        break;
      case 'loopcut':
        this.startLoopCut();
        (this.modal as LoopCutModal | null)?.onDown?.(x, y, ev);
        break;
      case 'polybuild':
        this.startPolyBuild();
        (this.modal as PolyBuildModal | null)?.onDown?.(x, y, ev);
        break;
      case 'cursor':
        this.placeCursor(x, y);
        break;
    }
  }

  // ── Edit commands ────────────────────────────────────────────────────────
  startKnife(): void {
    if (!this.editObj) return;
    this.startModal(new KnifeModal(this, this.pushUndo('Knife')));
  }
  startLoopCut(): void {
    if (!this.editObj) return;
    this.startModal(new LoopCutModal(this, this.pushUndo('Loop Cut')));
  }
  startPolyBuild(): void {
    if (!this.editObj) return;
    this.startModal(new PolyBuildModal(this, this.pushUndo('Poly Build')));
  }
  startBox(): void {
    this.oneShotBox = true;
    this.set({ tool: 'box' });
    this.toast('Box Select: drag a rectangle (Esc to return to Select)');
  }

  setLastOp(name: string, fields: OpField[], run: (v: Record<string, number | boolean | string>) => void, snapshot?: WorldSnapshot): void {
    const snap = snapshot ?? this.takeSnapshot(name);
    this.lastOpRun = { snapshot: snap, run, fields, name };
    const op: LastOp = { name, fields };
    this.set({ lastOp: op });
  }

  /** Called by the Last Operation panel. */
  editLastOp(values: Record<string, number | boolean | string>): void {
    const l = this.lastOpRun;
    if (!l) return;
    const isAdd = l.name.startsWith('Add ');
    if (!isAdd) {
      this.restoreSnapshot(l.snapshot);
    }
    l.run(values);
    l.fields = l.fields.map((f) => ({ ...f, value: values[f.key] ?? f.value }));
    this.set({ lastOp: { name: l.name, fields: l.fields } });
  }
  clearLastOp(): void {
    this.lastOpRun = null;
    this.set({ lastOp: null });
  }

  /** Run a mesh operator with undo, refresh and Last-Operation support. */
  private editOp(label: string, fn: (m: EditMesh, s: Selection) => boolean | void, msgFail?: string): boolean {
    const e = this.editObj;
    if (!e) return false;
    const snap = this.pushUndo(label);
    const ok = fn(e.mesh, this.sel);
    if (ok === false) {
      this.undoStack.pop();
      if (msgFail) this.toast(msgFail);
      return false;
    }
    e.mesh.touch();
    flushSelection(e.mesh, this.sel, this.selectMode);
    this.refreshEdit();
    this.changed();
    void snap;
    return true;
  }

  private withParams(label: string, fields: OpField[], run: (m: EditMesh, s: Selection, v: Record<string, number | boolean | string>) => boolean | void): void {
    const e = this.editObj;
    if (!e) return;
    const snap = this.pushUndo(label);
    const defaults: Record<string, number | boolean | string> = {};
    for (const f of fields) defaults[f.key] = f.value;
    const exec = (vals: Record<string, number | boolean | string>) => {
      const ed = this.editObj;
      if (!ed) return;
      const ok = run(ed.mesh, this.sel, vals);
      if (ok === false) this.toast(label + ': nothing to do');
      ed.mesh.touch();
      flushSelection(ed.mesh, this.sel, this.selectMode);
      this.refreshEdit();
      this.changed();
    };
    exec(defaults);
    this.setLastOp(label, fields, exec, snap);
  }

  extrude(): void {
    const e = this.editObj;
    if (!e || !this.sel.v.size) return this.toast('Nothing selected');
    const snap = this.pushUndo('Extrude');
    const r = shape.extrudeRegion(e.mesh, this.sel, this.selectMode);
    if (!r.ok) {
      this.undoStack.pop();
      return;
    }
    e.mesh.touch();
    this.refreshEdit();
    this.changed();
    const world = r.normal ? new THREE.Vector3(...r.normal).transformDirection(e.object.matrixWorld) : null;
    this.startTransform('translate', { axis: undefined, normal: world ? ([world.x, world.y, world.z] as V3) : null, label: 'Extrude', onCancelUndo: snap });
  }

  extrudeIndividual(): void {
    const e = this.editObj;
    if (!e || !this.sel.f.size) return this.toast('Select faces');
    const snap = this.pushUndo('Extrude Individual Faces');
    const r = shape.extrudeIndividualFaces(e.mesh, this.sel);
    e.mesh.touch();
    this.refreshEdit();
    this.changed();
    const world = r.normal ? new THREE.Vector3(...r.normal).transformDirection(e.object.matrixWorld) : null;
    this.startTransform('translate', { normal: world ? ([world.x, world.y, world.z] as V3) : null, label: 'Extrude Individual', onCancelUndo: snap });
  }

  extrudeToCursor(x: number, y: number): void {
    const e = this.editObj;
    const ctx = this.pickCtx();
    if (!e || !ctx) return;
    const r = this.dom.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), this.sm.camera);
    let target: THREE.Vector3 | null = null;
    const hit = ray.intersectObject(e.object, false)[0];
    if (hit && this.sel.v.size === 0) target = hit.point.clone();
    if (!target) {
      const pivot = this.sel.v.size ? toWorld(e, selectionMedian(e.mesh, this.sel)) : this.cursor.clone();
      const n = this.sm.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, pivot);
      target = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, target)) return;
    }
    this.pushUndo('Extrude to Cursor');
    const local = e.object.worldToLocal(target.clone());
    if (this.sel.v.size === 0) {
      const v = e.mesh.addVert([local.x, local.y, local.z]);
      this.sel.clear();
      this.sel.v.add(v);
      this.sel.active = { type: 'vert', id: v };
    } else {
      const from = selectionMedian(e.mesh, this.sel);
      const res = shape.extrudeRegion(e.mesh, this.sel, this.selectMode);
      if (!res.ok) return;
      const dv: V3 = [local.x - from[0], local.y - from[1], local.z - from[2]];
      for (const v of this.sel.v) e.mesh.co[v] = v3.add(e.mesh.co[v], dv);
    }
    e.mesh.touch();
    flushSelection(e.mesh, this.sel, this.selectMode);
    this.refreshEdit();
    this.changed();
  }

  inset(): void {
    const e = this.editObj;
    if (!e || !this.sel.f.size) return this.toast('Select faces to inset');
    this.startModal(new InsetModal(this, this.pushUndo('Inset Faces')));
  }

  bevel(vertexOnly = false): void {
    const e = this.editObj;
    if (!e) return;
    if (!this.sel.e.size && !this.sel.v.size) return this.toast('Select edges or vertices to bevel');
    this.startModal(new BevelModal(this, this.pushUndo('Bevel'), vertexOnly));
  }

  slide(kind: 'edge' | 'vertex'): void {
    const e = this.editObj;
    if (!e) return;
    const m = new SlideModal(this, this.pushUndo(kind === 'edge' ? 'Edge Slide' : 'Vertex Slide'), kind);
    if (!m.valid) {
      this.undoStack.pop();
      this.toast(kind === 'edge' ? 'Select connected edges to slide' : 'Select a single vertex to slide');
      return;
    }
    this.startModal(m);
  }

  deleteMenu(type: core.DeleteType): void {
    this.editOp('Delete', (m, s) => core.deleteSelection(m, s, type));
  }

  dissolve(kind: 'verts' | 'edges' | 'faces' | 'limited'): void {
    if (kind === 'limited') {
      this.withParams('Limited Dissolve', [{ key: 'angle', label: 'Max Angle', type: 'number', value: 5, min: 0, max: 180, step: 1 }], (m, s, v) => {
        if (!s.f.size && !s.e.size && !s.v.size) selectAll(m, s);
        const before = { ...s };
        void before;
        return core.limitedDissolve(m, s, (Number(v.angle) * Math.PI) / 180);
      });
      return;
    }
    this.editOp('Dissolve', (m, s) => {
      if (kind === 'verts') return core.dissolveVerts(m, s, this.selectMode);
      if (kind === 'edges') return core.dissolveEdges(m, s, true);
      return core.dissolveFaces(m, s, false);
    }, 'Nothing to dissolve');
  }

  merge(type: core.MergeType | 'distance'): void {
    if (type === 'distance') {
      this.withParams('Merge by Distance', [{ key: 'threshold', label: 'Merge Distance', type: 'number', value: 0.0001, min: 0, max: 10, step: 0.0001 }], (m, s, v) => {
        const n = core.mergeByDistance(m, s.v.size ? s : null, Number(v.threshold));
        this.toast(n ? `Removed ${n} vertices` : 'No vertices to merge');
        return n > 0;
      });
      return;
    }
    const e = this.editObj;
    this.editOp('Merge', (m, s) => core.mergeVerts(m, s, type, e ? e.object.worldToLocal(this.cursor.clone()).toArray() as V3 : [0, 0, 0], s.active?.type === 'vert' ? s.active.id : undefined), 'Select at least 2 vertices (or edges to collapse)');
  }

  fill(kind: 'face' | 'holes' | 'grid' = 'face'): void {
    if (kind === 'holes') this.editOp('Fill', (m, s) => core.fillHoles(m, s), 'Select a closed boundary loop');
    else if (kind === 'grid') {
      this.withParams('Grid Fill', [
        { key: 'span', label: 'Span', type: 'number', value: 0, min: 0, max: 100, step: 1 },
        { key: 'offset', label: 'Offset', type: 'number', value: 0, min: -100, max: 100, step: 1 },
      ], (m, s, v) => core.gridFill(m, s, Number(v.span) || undefined, Number(v.offset)));
    } else this.editOp('Make Edge/Face', (m, s) => core.makeEdgeFace(m, s), 'Select 2+ vertices or a closed edge loop');
  }

  subdivide(): void {
    this.withParams('Subdivide', [
      { key: 'cuts', label: 'Number of Cuts', type: 'number', value: 1, min: 1, max: 10, step: 1 },
      { key: 'smooth', label: 'Smoothness', type: 'number', value: 0, min: 0, max: 1, step: 0.05 },
    ], (m, s, v) => {
      if (!s.e.size) return false;
      return core.subdivide(m, s, this.selectMode, Math.round(Number(v.cuts)), Number(v.smooth));
    });
  }

  poke(): void {
    this.withParams('Poke Faces', [
      { key: 'offset', label: 'Poke Offset', type: 'number', value: 0, min: -10, max: 10, step: 0.05 },
      { key: 'relative', label: 'Offset Relative', type: 'bool', value: false },
    ], (m, s, v) => core.pokeFaces(m, s, Number(v.offset), Boolean(v.relative)));
  }

  solidify(): void {
    this.withParams('Solidify', [{ key: 'thickness', label: 'Thickness', type: 'number', value: 0.1, min: -10, max: 10, step: 0.01 }], (m, s, v) => core.solidify(m, s, Number(v.thickness)));
  }

  smoothVerts(): void {
    this.withParams('Smooth Vertices', [
      { key: 'factor', label: 'Smoothing', type: 'number', value: 0.5, min: -10, max: 10, step: 0.05 },
      { key: 'repeat', label: 'Repeat', type: 'number', value: 1, min: 1, max: 100, step: 1 },
    ], (m, s, v) => core.smoothVertices(m, s, Number(v.factor), Math.round(Number(v.repeat))));
  }

  spin(): void {
    const e = this.editObj;
    if (!e || !this.sel.v.size) return this.toast('Nothing selected');
    const dir = this.sm.camera.getWorldDirection(new THREE.Vector3());
    const local = dir.clone().transformDirection(new THREE.Matrix4().copy(e.object.matrixWorld).invert());
    this.withParams('Spin', [
      { key: 'angle', label: 'Angle', type: 'number', value: 360, min: -3600, max: 3600, step: 15 },
      { key: 'steps', label: 'Steps', type: 'number', value: 12, min: 1, max: 256, step: 1 },
      { key: 'axis', label: 'Axis', type: 'enum', value: 'view', options: [{ value: 'view', label: 'View' }, { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ], (m, s, v) => {
      const axis: V3 = v.axis === 'x' ? [1, 0, 0] : v.axis === 'y' ? [0, 1, 0] : v.axis === 'z' ? [0, 0, 1] : [local.x, local.y, local.z];
      const c = e.object.worldToLocal(this.cursor.clone());
      return core.spinSelection(m, s, [c.x, c.y, c.z], axis, (Number(v.angle) * Math.PI) / 180, Math.round(Number(v.steps)));
    });
  }

  bridge(): void {
    this.withParams('Bridge Edge Loops', [{ key: 'twist', label: 'Twist', type: 'number', value: 0, min: -100, max: 100, step: 1 }], (m, s, v) => {
      const r = loop.bridgeEdgeLoops(m, s, Math.round(Number(v.twist)));
      if (!r.ok && r.message) this.toast(r.message);
      return r.ok;
    });
  }

  rip(fill = false): void {
    const e = this.editObj;
    const ctx = this.pickCtx();
    if (!e || !ctx) return;
    if (!this.sel.v.size) return this.toast('Select vertices to rip');
    const snap = this.pushUndo('Rip');
    const S = projectAll(ctx);
    const mouse = this.lastMouse;
    const ok = loop.ripVertices(e.mesh, this.sel, (v, keys) => {
      let best = keys[0];
      let bs = -Infinity;
      const sv = S[v];
      const md = [mouse.x - sv.x, mouse.y - sv.y];
      const ml = Math.hypot(md[0], md[1]) || 1;
      for (const k of keys) {
        const o = ekLo(k) === v ? ekHi(k) : ekLo(k);
        const so = S[o];
        const ed = [so.x - sv.x, so.y - sv.y];
        const el = Math.hypot(ed[0], ed[1]) || 1;
        const sc = (md[0] * ed[0] + md[1] * ed[1]) / (ml * el);
        if (sc > bs) {
          bs = sc;
          best = k;
        }
      }
      return best;
    });
    void fill;
    if (!ok) {
      this.undoStack.pop();
      this.toast('Nothing to rip here');
      return;
    }
    e.mesh.touch();
    this.refreshEdit();
    this.changed();
    this.startTransform('translate', { label: 'Rip', onCancelUndo: snap });
  }

  private lastMouse = { x: 0, y: 0 };

  split(): void {
    this.editOp('Split', (m, s) => core.splitSelection(m, s, this.selectMode), 'Select faces to split');
  }

  separate(): void {
    const e = this.editObj;
    if (!e || !this.sel.v.size) return this.toast('Nothing selected');
    this.pushUndo('Separate');
    const part = core.separateSelection(e.mesh, this.sel);
    if (!part) return;
    const name = uniqueName(e.name.replace(/\.\d+$/, ''), Array.from(this.objects.values()).map((o) => o.name));
    const obj = new EditableObject(name, part);
    obj.object.position.copy(e.object.position);
    obj.object.quaternion.copy(e.object.quaternion);
    obj.object.scale.copy(e.object.scale);
    obj.material.color.copy(e.material.color);
    obj.material.roughness = e.material.roughness;
    obj.material.metalness = e.material.metalness;
    this.sm.scene.add(obj.object);
    this.objects.set(obj.id, obj);
    e.mesh.touch();
    this.sel.clear();
    this.refreshEdit();
    this.changed();
    this.toast('Separated to ' + name);
  }

  connect(): void {
    this.editOp('Connect Vertex Path', (m, s) => core.connectVerts(m, s), 'Select 2+ vertices on the same face');
  }

  duplicateEdit(): void {
    const e = this.editObj;
    if (!e || !this.sel.v.size) return this.toast('Nothing selected');
    const snap = this.pushUndo('Duplicate');
    core.duplicateSelection(e.mesh, this.sel, this.selectMode);
    e.mesh.touch();
    this.refreshEdit();
    this.changed();
    this.startTransform('translate', { label: 'Duplicate', onCancelUndo: snap });
  }

  triangulate(): void {
    this.editOp('Triangulate Faces', (m, s) => core.triangulateFaces(m, s), 'Select faces');
  }
  trisToQuads(): void {
    this.editOp('Tris to Quads', (m, s) => core.trisToQuads(m, s), 'No triangle pairs to join');
  }
  flipNormals(): void {
    this.editOp('Flip Normals', (m, s) => core.flipNormals(m, s));
  }
  rotateEdge(cw: boolean): void {
    this.editOp('Rotate Edge', (m, s) => core.rotateEdge(m, s, cw), 'Select an edge between two faces');
  }
  markEdges(kind: 'seam' | 'sharp', on: boolean): void {
    this.editOp(on ? 'Mark ' + kind : 'Clear ' + kind, (m, s) => {
      const set = kind === 'seam' ? m.seam : m.sharp;
      for (const k of s.e) {
        if (on) set.add(k);
        else set.delete(k);
      }
    });
  }
  hide(unselected = false): void {
    this.editOp('Hide', (m, s) => selOps.hideSelected(m, s, unselected));
  }
  reveal(): void {
    this.editOp('Reveal', (m, s) => selOps.revealHidden(m, s, this.selectMode));
  }
  toggleSmooth(smooth?: boolean): void {
    const a = this.active;
    if (!a) return;
    this.pushUndo(smooth === false ? 'Shade Flat' : 'Shade Smooth');
    a.mesh.smooth = smooth ?? !a.mesh.smooth;
    a.mesh.touch();
    a.rebuild();
    this.refreshEdit();
    this.changed();
  }

  // Selection commands
  selectAllToggle(): void {
    const e = this.editObj;
    if (!e) return;
    selectAll(e.mesh, this.sel);
    this.refreshEdit();
  }
  deselectAll(): void {
    this.sel.clear();
    this.refreshEdit();
  }
  invert(): void {
    const e = this.editObj;
    if (!e) return;
    selOps.invertSelection(e.mesh, this.sel, this.selectMode);
    this.refreshEdit();
  }
  grow(): void {
    const e = this.editObj;
    if (!e) return;
    selOps.growSelection(e.mesh, this.sel, this.selectMode);
    this.refreshEdit();
  }
  shrink(): void {
    const e = this.editObj;
    if (!e) return;
    selOps.shrinkSelection(e.mesh, this.sel, this.selectMode);
    this.refreshEdit();
  }
  linkedUnderCursor(): void {
    const e = this.editObj;
    const ctx = this.pickCtx();
    if (!e || !ctx) return;
    const p = this.lastMouse;
    let seed = -1;
    if (this.selectMode === 'face') {
      const f = pickFace(ctx, p.x, p.y);
      if (f) seed = e.mesh.faces[f.face][0];
    } else {
      seed = pickVertex(ctx, p.x, p.y, 40);
      if (seed < 0) {
        const ed = pickEdge(ctx, p.x, p.y, 30);
        if (ed) seed = ekLo(ed.key);
      }
    }
    if (seed < 0) return;
    selOps.selectLinked(e.mesh, this.sel, this.selectMode, [seed]);
    this.refreshEdit();
  }
  linkedFromSelection(): void {
    const e = this.editObj;
    if (!e || !this.sel.v.size) return;
    selOps.selectLinked(e.mesh, this.sel, this.selectMode, Array.from(this.sel.v));
    this.refreshEdit();
  }
  selectRandom(): void {
    const e = this.editObj;
    if (!e) return;
    selOps.selectRandom(e.mesh, this.sel, this.selectMode, 0.5, Math.floor(Math.random() * 1000));
    this.refreshEdit();
  }
  selectCheckerDeselect(): void {
    const e = this.editObj;
    if (!e) return;
    selOps.selectNth(e.mesh, this.sel, this.selectMode);
    this.refreshEdit();
  }

  frameSelection(): void {
    const e = this.editObj ?? this.active;
    if (!e) return;
    let c: THREE.Vector3;
    let radius = 1;
    if (this.editObj && this.sel.v.size) {
      c = toWorld(e, selectionBoundsCenter(e.mesh, this.sel));
      radius = 0.5;
      for (const v of this.sel.v) radius = Math.max(radius, toWorld(e, e.mesh.co[v]).distanceTo(c));
    } else {
      const box = new THREE.Box3().setFromObject(e.object);
      c = box.getCenter(new THREE.Vector3());
      radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    }
    const cam = this.sm.camera;
    const dir = cam.position.clone().sub(this.sm.controls.target).normalize();
    this.sm.controls.target.copy(c);
    cam.position.copy(c.clone().add(dir.multiplyScalar(radius * 3.2)));
    this.sm.controls.update();
  }

  resetCursor(): void {
    this.cursor.set(0, 0, 0);
    this.cursorObj.position.copy(this.cursor);
  }

  cursorToSelection(): void {
    const e = this.editObj;
    if (e && this.sel.v.size) this.cursor.copy(toWorld(e, selectionMedian(e.mesh, this.sel)));
    else if (this.active) this.cursor.copy(this.active.object.position);
    this.cursorObj.position.copy(this.cursor);
  }

  // Object-mode transform helpers
  applyTransform(): void {
    for (const id of this.selectedIds) {
      const o = this.objects.get(id);
      if (!o) continue;
      this.pushUndo('Apply Transform');
      o.object.updateMatrixWorld(true);
      const m = o.object.matrix.clone();
      const t = new THREE.Vector3();
      for (const p of o.mesh.co) {
        t.set(p[0], p[1], p[2]).applyMatrix4(m);
        p[0] = t.x;
        p[1] = t.y;
        p[2] = t.z;
      }
      o.object.position.set(0, 0, 0);
      o.object.quaternion.identity();
      o.object.scale.set(1, 1, 1);
      o.mesh.touch();
      o.rebuild();
    }
    this.refreshOutlines();
    this.syncStore();
    this.changed();
  }

  originToGeometry(): void {
    const o = this.active;
    if (!o) return;
    this.pushUndo('Origin to Geometry');
    const box = new THREE.Box3();
    for (const p of o.mesh.co) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
    const c = box.getCenter(new THREE.Vector3());
    for (const p of o.mesh.co) {
      p[0] -= c.x;
      p[1] -= c.y;
      p[2] -= c.z;
    }
    const shift = c.clone().multiply(o.object.scale).applyQuaternion(o.object.quaternion);
    o.object.position.add(shift);
    o.mesh.touch();
    o.rebuild();
    this.syncStore();
    this.changed();
  }

  // N-panel edits
  setObjectTransform(field: 'loc' | 'rot' | 'scale', axis: 0 | 1 | 2, value: number): void {
    const o = this.active;
    if (!o || !Number.isFinite(value)) return;
    this.pushUndo('Set Transform');
    if (field === 'loc') o.object.position.setComponent(axis, value);
    else if (field === 'scale') o.object.scale.setComponent(axis, value === 0 ? 1e-4 : value);
    else {
      const r = o.object.rotation;
      const a = [r.x, r.y, r.z];
      a[axis] = (value * Math.PI) / 180;
      o.object.rotation.set(a[0], a[1], a[2]);
    }
    o.object.updateMatrixWorld(true);
    this.refreshOutlines();
    this.syncStore();
    this.changed();
  }
  setMedian(axis: 0 | 1 | 2, value: number): void {
    const e = this.editObj;
    if (!e || !this.sel.v.size || !Number.isFinite(value)) return;
    this.pushUndo('Set Median');
    const cur = selectionMedian(e.mesh, this.sel);
    const d = value - cur[axis];
    for (const v of this.sel.v) e.mesh.co[v][axis] += d;
    e.mesh.touch();
    this.refreshEdit();
    this.changed();
  }
  setMaterial(patch: Partial<EditableObjectJSON['material']>): void {
    const o = this.active;
    if (!o) return;
    const m = o.material;
    if (patch.color !== undefined) m.color.set(patch.color);
    if (patch.roughness !== undefined) m.roughness = patch.roughness;
    if (patch.metalness !== undefined) m.metalness = patch.metalness;
    if (patch.clearcoat !== undefined) m.clearcoat = patch.clearcoat;
    if (patch.emissive !== undefined) m.emissive.set(patch.emissive);
    if (patch.emissiveIntensity !== undefined) m.emissiveIntensity = patch.emissiveIntensity;
    m.needsUpdate = true;
    this.syncStore();
    this.changed();
  }
  renameActive(name: string): void {
    const o = this.active;
    if (!o || !name.trim()) return;
    this.pushUndo('Rename');
    o.setName(uniqueName(name.trim(), Array.from(this.objects.values()).filter((x) => x !== o).map((x) => x.name)));
    this.syncStore();
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  private onKeyDown = (ev: KeyboardEvent) => {
    if (this.disposed) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.modal) {
      if (this.modal.onKey(ev)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      } else if (ev.key === 'Escape') {
        this.modal.cancel();
        ev.stopImmediatePropagation();
      } else if (ev.key === 'Enter') {
        this.modal.confirm();
        ev.stopImmediatePropagation();
      }
      return;
    }
    const undoKey = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z';
    if (undoKey) {
      const newest = this.newestUndoTime();
      const historyNewest = readHistoryNewest();
      if (this.mode === 'edit' || newest > historyNewest) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.shiftKey) this.redo();
        else this.undo();
      }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y' && this.mode === 'edit') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.redo();
      return;
    }
    if (!this.pointerInside) return;
    const consumed = this.mode === 'edit' ? this.editKey(ev) : this.objectKey(ev);
    if (consumed) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  };

  setMouse(x: number, y: number): void {
    this.lastMouse = { x, y };
  }

  private openMenu(kind: MenuKind): void {
    this.set({ menu: { kind, x: this.lastMouse.x, y: this.lastMouse.y } });
  }

  private objectKey(ev: KeyboardEvent): boolean {
    const k = ev.key.toLowerCase();
    const has = this.selectedIds.size > 0;
    if (ev.shiftKey && k === 'a' && !ev.ctrlKey) {
      this.openMenu('add');
      return true;
    }
    if (k === 'tab' && !ev.ctrlKey) {
      if (has || this.active) {
        this.toggleMode();
        return true;
      }
      return false;
    }
    if (ev.ctrlKey && k === 'j') {
      this.joinObjects();
      return true;
    }
    if (ev.ctrlKey && k === 'a' && has) {
      this.applyTransform();
      return true;
    }
    if (!has) return false;
    if (ev.ctrlKey || ev.metaKey) return false;
    if (ev.altKey) {
      if (k === 'a') {
        this.selectObject(null, false);
        return true;
      }
      if (k === 'g' || k === 'r' || k === 's') {
        this.pushUndo('Clear Transform');
        for (const id of this.selectedIds) {
          const o = this.objects.get(id);
          if (!o) continue;
          if (k === 'g') o.object.position.set(0, 0, 0);
          if (k === 'r') o.object.quaternion.identity();
          if (k === 's') o.object.scale.set(1, 1, 1);
        }
        this.refreshOutlines();
        this.syncStore();
        this.changed();
        return true;
      }
      return false;
    }
    switch (k) {
      case 'g':
        this.startTransform('translate');
        return true;
      case 'r':
        this.startTransform('rotate');
        return true;
      case 's':
        this.startTransform('scale');
        return true;
      case 'x':
      case 'delete':
        this.deleteObjects();
        return true;
      case 'd':
        if (ev.shiftKey) {
          this.duplicateObjects();
          return true;
        }
        return false;
      case 'a':
        this.pushUndo('Select All');
        this.selectedIds = new Set(this.objects.keys());
        this.activeId = this.activeId ?? this.objects.keys().next().value ?? null;
        this.updateSelectionOutline();
        this.syncStore();
        return true;
      case 'h':
        for (const id of this.selectedIds) {
          const o = this.objects.get(id);
          if (o) o.object.visible = ev.shiftKey ? o.object.visible : false;
        }
        this.syncStore();
        this.changed();
        return true;
      case 'n':
        this.set({ npanel: !this.store().npanel });
        return true;
      case 'f2': {
        const n = window.prompt('Rename object', this.active?.name ?? '');
        if (n) this.renameActive(n);
        return true;
      }
      case 'w':
      case 'e':
        return false;
      default:
        break;
    }
    if (ev.code === 'NumpadDecimal') {
      this.frameSelection();
      return true;
    }
    return false;
  }

  private editKey(ev: KeyboardEvent): boolean {
    const st = this.store();
    const k = ev.key.toLowerCase();
    const ctrl = ev.ctrlKey || ev.metaKey;
    const alt = ev.altKey;
    const shift = ev.shiftKey;
    const code = ev.code;

    if (k === 'escape') {
      if (st.menu) {
        this.set({ menu: null });
        return true;
      }
      if (st.tool !== 'select') {
        this.set({ tool: 'select' });
        return true;
      }
      return false;
    }
    if (k === 'tab' && !ctrl) {
      if (shift) {
        this.set({ snapping: { ...st.snapping, enabled: !st.snapping.enabled } });
        this.toast('Snapping ' + (!st.snapping.enabled ? 'On' : 'Off'));
      } else this.exitEdit(true);
      return true;
    }
    // Select mode: main-row digits only (numpad digits keep their view meaning)
    if (!ctrl && !alt && /^Digit[123]$/.test(code)) {
      this.setSelectMode(code === 'Digit1' ? 'vert' : code === 'Digit2' ? 'edge' : 'face');
      return true;
    }
    if (ctrl && (code === 'NumpadAdd' || code === 'NumpadSubtract')) {
      if (code === 'NumpadAdd') this.grow();
      else this.shrink();
      return true;
    }
    if (ctrl) {
      switch (k) {
        case 'i':
          this.invert();
          return true;
        case 'b':
          this.bevel(shift);
          return true;
        case 'r':
          this.startLoopCut();
          return true;
        case 'v':
          this.openMenu('vertex');
          return true;
        case 'e':
          this.openMenu('edge');
          return true;
        case 'f':
          this.openMenu('face');
          return true;
        case 'l':
          this.linkedFromSelection();
          return true;
        case 'a':
          return false;
        case 'm':
          return false;
        default:
          return false;
      }
    }
    if (shift && ctrl && alt && k === 's') {
      this.startTransform('shear');
      return true;
    }
    if (alt) {
      switch (k) {
        case 'a':
          this.deselectAll();
          return true;
        case 'z':
          this.setXray(!st.xray);
          return true;
        case 'r':
          this.spin();
          return true;
        case 'h':
          this.reveal();
          return true;
        case 'f':
          this.fill('holes');
          return true;
        case 'e':
          this.extrudeIndividual();
          return true;
        case 'm':
          this.openMenu('merge');
          return true;
        case 'x':
          return false;
        default:
          return false;
      }
    }
    if (shift) {
      switch (k) {
        case 'a':
          this.openMenu('add');
          return true;
        case 'd':
          this.duplicateEdit();
          return true;
        case 'h':
          this.hide(true);
          return true;
        case 'o': {
          const order = ['smooth', 'sphere', 'root', 'inverse', 'sharp', 'linear', 'constant', 'random'] as const;
          const next = order[(order.indexOf(st.proportional.falloff) + 1) % order.length];
          this.set({ proportional: { ...st.proportional, falloff: next } });
          this.toast('Proportional falloff: ' + next);
          return true;
        }
        case 'v':
          this.slide('vertex');
          return true;
        case ' ':
          this.shiftSpaceAt = performance.now();
          return true;
        case 'c':
          this.resetCursor();
          this.frameSelection();
          return true;
        case 's':
          this.cursorToSelection();
          return true;
        case 'z':
          return false;
        default:
          break;
      }
      if (k === 'p' && performance.now() - this.shiftSpaceAt < 1500) {
        this.set({ tool: 'polybuild' });
        this.toast('Poly Build: click empty space for a vertex, click an edge to extend a triangle');
        return true;
      }
    }
    switch (k) {
      case 'a': {
        const now = performance.now();
        if (now - this.lastAPress < 320) this.deselectAll();
        else this.selectAllToggle();
        this.lastAPress = now;
        return true;
      }
      case 'b':
        this.oneShotBox = true;
        this.set({ tool: 'box' });
        this.toast('Box Select: drag a rectangle (Shift adds, Ctrl removes)');
        return true;
      case 'c':
        this.set({ tool: 'circle' });
        this.toast('Circle Select: drag to paint, wheel changes size (Esc to finish)');
        return true;
      case 'g':
        this.startTransform('translate');
        return true;
      case 'r':
        this.startTransform('rotate');
        return true;
      case 's':
        this.startTransform('scale');
        return true;
      case 'e':
        this.extrude();
        return true;
      case 'i':
        this.inset();
        return true;
      case 'k':
        this.startKnife();
        return true;
      case 'x':
      case 'delete':
        this.openMenu('delete');
        return true;
      case 'm':
        this.openMenu('merge');
        return true;
      case 'f':
        this.fill('face');
        return true;
      case 'p':
        this.openMenu('separate');
        return true;
      case 'v':
        this.rip();
        return true;
      case 'y':
        this.split();
        return true;
      case 'j':
        this.connect();
        return true;
      case 'o':
        this.set({ proportional: { ...st.proportional, enabled: !st.proportional.enabled } });
        this.toast('Proportional Editing ' + (!st.proportional.enabled ? 'On' : 'Off'));
        return true;
      case 'l':
        this.linkedUnderCursor();
        return true;
      case 'h':
        this.hide(false);
        return true;
      case 'n':
        this.set({ npanel: !st.npanel });
        return true;
      case 'z':
        return false;
      default:
        break;
    }
    if (code === 'NumpadDecimal') {
      this.frameSelection();
      return true;
    }
    return false;
  }

  /** Dispatch for menu entries (kept string based so React menus stay dumb). */
  exec(cmd: string, arg?: string): void {
    this.set({ menu: null });
    const has = (c: string) => cmd === c;
    if (cmd.startsWith('add:')) {
      this.addPrimitive(cmd.slice(4) as PrimitiveKind);
      return;
    }
    if (has('mode:toggle')) return this.toggleMode();
    if (has('select:all')) return this.selectAllToggle();
    if (has('select:none')) return this.deselectAll();
    if (has('select:invert')) return this.invert();
    if (has('select:more')) return this.grow();
    if (has('select:less')) return this.shrink();
    if (has('select:linked')) return this.linkedFromSelection();
    if (has('select:random')) return this.selectRandom();
    if (has('select:checker')) return this.selectCheckerDeselect();
    if (has('select:box')) return this.startBox();
    if (has('select:circle')) return void this.set({ tool: 'circle' });
    if (has('select:lasso')) return void this.set({ tool: 'lasso' });
    switch (cmd) {
      case 'transform:grab':
        return this.startTransform('translate');
      case 'transform:rotate':
        return this.startTransform('rotate');
      case 'transform:scale':
        return this.startTransform('scale');
      case 'transform:shear':
        return this.startTransform('shear');
      case 'extrude':
        return this.extrude();
      case 'extrude:individual':
        return this.extrudeIndividual();
      case 'inset':
        return this.inset();
      case 'bevel':
        return this.bevel(false);
      case 'bevel:vertex':
        return this.bevel(true);
      case 'loopcut':
        return this.startLoopCut();
      case 'knife':
        return this.startKnife();
      case 'polybuild':
        return void this.set({ tool: 'polybuild' });
      case 'spin':
        return this.spin();
      case 'delete:verts':
        return this.deleteMenu('verts');
      case 'delete:edges':
        return this.deleteMenu('edges');
      case 'delete:faces':
        return this.deleteMenu('faces');
      case 'delete:onlyEdgesFaces':
        return this.deleteMenu('onlyEdgesFaces');
      case 'delete:onlyFaces':
        return this.deleteMenu('onlyFaces');
      case 'dissolve:verts':
        return this.dissolve('verts');
      case 'dissolve:edges':
        return this.dissolve('edges');
      case 'dissolve:faces':
        return this.dissolve('faces');
      case 'dissolve:limited':
        return this.dissolve('limited');
      case 'merge:center':
        return this.merge('center');
      case 'merge:cursor':
        return this.merge('cursor');
      case 'merge:first':
        return this.merge('first');
      case 'merge:last':
        return this.merge('last');
      case 'merge:collapse':
        return this.merge('collapse');
      case 'merge:distance':
        return this.merge('distance');
      case 'fill':
        return this.fill('face');
      case 'fill:holes':
        return this.fill('holes');
      case 'fill:grid':
        return this.fill('grid');
      case 'subdivide':
        return this.subdivide();
      case 'poke':
        return this.poke();
      case 'solidify':
        return this.solidify();
      case 'smooth':
        return this.smoothVerts();
      case 'bridge':
        return this.bridge();
      case 'rip':
        return this.rip();
      case 'split':
        return this.split();
      case 'connect':
        return this.connect();
      case 'duplicate':
        return this.mode === 'edit' ? this.duplicateEdit() : this.duplicateObjects();
      case 'separate:selection':
        return this.separate();
      case 'triangulate':
        return this.triangulate();
      case 'tris2quads':
        return this.trisToQuads();
      case 'flip':
        return this.flipNormals();
      case 'rotate:cw':
        return this.rotateEdge(true);
      case 'rotate:ccw':
        return this.rotateEdge(false);
      case 'slide:edge':
        return this.slide('edge');
      case 'slide:vertex':
        return this.slide('vertex');
      case 'seam:mark':
        return this.markEdges('seam', true);
      case 'seam:clear':
        return this.markEdges('seam', false);
      case 'sharp:mark':
        return this.markEdges('sharp', true);
      case 'sharp:clear':
        return this.markEdges('sharp', false);
      case 'hide':
        return this.hide(false);
      case 'hide:unselected':
        return this.hide(true);
      case 'reveal':
        return this.reveal();
      case 'shade:smooth':
        return this.toggleSmooth(true);
      case 'shade:flat':
        return this.toggleSmooth(false);
      case 'object:delete':
        return this.deleteObjects();
      case 'object:join':
        return this.joinObjects();
      case 'object:apply':
        return this.applyTransform();
      case 'object:origin':
        return this.originToGeometry();
      case 'cursor:origin':
        return this.resetCursor();
      case 'cursor:selection':
        return this.cursorToSelection();
      case 'view:frame':
        return this.frameSelection();
      case 'undo':
        return void this.undo();
      case 'redo':
        return void this.redo();
      case 'xray':
        return this.setXray(!this.store().xray);
      case 'npanel':
        return void this.set({ npanel: !this.store().npanel });
      default:
        void arg;
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  serialize(): EditableObjectJSON[] {
    return Array.from(this.objects.values()).map((o) => o.toJSON());
  }

  deserialize(list: EditableObjectJSON[]): void {
    if (this.mode === 'edit') this.exitEdit(false);
    for (const o of this.objects.values()) {
      this.sm.scene.remove(o.object);
      o.dispose();
    }
    this.objects.clear();
    this.selectedIds.clear();
    this.activeId = null;
    for (const j of list) {
      const o = EditableObject.fromJSON(j);
      this.objects.set(o.id, o);
      this.sm.scene.add(o.object);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.updateSelectionOutline();
    this.syncStore();
    this.changed();
  }
}

function kindLabel(k: TransformKind): string {
  return k === 'translate' ? 'Move' : k === 'rotate' ? 'Rotate' : k === 'scale' ? 'Resize' : 'Shear';
}

function readHistoryNewest(): number {
  try {
    const w = window as unknown as { __historyNewest?: () => number };
    return w.__historyNewest ? w.__historyNewest() : 0;
  } catch {
    return 0;
  }
}

function primitiveFields(kind: PrimitiveKind, p: PrimitiveParams): OpField[] {
  const num = (key: string, label: string, value: number, min: number, max: number, step: number): OpField => ({ key, label, type: 'number', value, min, max, step });
  switch (kind) {
    case 'cube':
    case 'plane':
      return [num('size', 'Size', p.size ?? 2, 0.01, 100, 0.1)];
    case 'grid':
      return [num('xSegments', 'X Subdivisions', p.xSegments ?? 10, 1, 200, 1), num('ySegments', 'Y Subdivisions', p.ySegments ?? 10, 1, 200, 1), num('size', 'Size', p.size ?? 2, 0.01, 100, 0.1)];
    case 'circle':
      return [num('segments', 'Vertices', p.segments ?? 32, 3, 256, 1), num('radius', 'Radius', p.radius ?? 1, 0.01, 100, 0.1)];
    case 'uvsphere':
      return [num('segments', 'Segments', p.segments ?? 32, 3, 256, 1), num('rings', 'Rings', p.rings ?? 16, 2, 256, 1), num('radius', 'Radius', p.radius ?? 1, 0.01, 100, 0.1)];
    case 'icosphere':
      return [num('subdivisions', 'Subdivisions', p.subdivisions ?? 2, 1, 6, 1), num('radius', 'Radius', p.radius ?? 1, 0.01, 100, 0.1)];
    case 'cylinder':
      return [num('segments', 'Vertices', p.segments ?? 32, 3, 256, 1), num('radius', 'Radius', p.radius ?? 1, 0.01, 100, 0.1), num('depth', 'Depth', p.depth ?? 2, 0.01, 100, 0.1)];
    case 'cone':
      return [num('segments', 'Vertices', p.segments ?? 32, 3, 256, 1), num('radius', 'Radius 1', p.radius ?? 1, 0.01, 100, 0.1), num('radius2', 'Radius 2', p.radius2 ?? 0, 0, 100, 0.1), num('depth', 'Depth', p.depth ?? 2, 0.01, 100, 0.1)];
    case 'torus':
      return [num('majorSegments', 'Major Segments', p.majorSegments ?? 48, 3, 256, 1), num('minorSegments', 'Minor Segments', p.minorSegments ?? 12, 3, 256, 1), num('majorRadius', 'Major Radius', p.majorRadius ?? 1, 0.01, 100, 0.1), num('minorRadius', 'Minor Radius', p.minorRadius ?? 0.25, 0.01, 100, 0.05)];
  }
}

export { selectionNormal, ek };
