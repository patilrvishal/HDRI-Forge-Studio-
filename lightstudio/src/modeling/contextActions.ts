import * as THREE from 'three';
import type { ModelingController } from './ModelingController';
import { useLightsStore } from '../store/lightsStore';
import { useUIStore } from '../store/uiStore';
import { useSceneHierarchyStore } from '../store/sceneHierarchyStore';
import { useMaterialEditorStore } from '../store/materialEditorStore';
import { disableObjectLight, enableObjectLight, getObjectLight, setIncludeInHdri } from '../three/objectLightApi';
import { useObjectHdriStore } from '../store/objectHdriStore';
import { objectKey } from '../three/objectBinding';
import { toggleAreaLight } from '../three/areaLightApi';

function showRightTab(tab: 'properties' | 'matEdit'): void {
  const ui = useUIStore.getState();
  if (!ui.rightPanelOpen) ui.showPanel('rightPanel');
  ui.setRightPanelTab(tab);
}

/** Commands from the light right-click menu (`light:*`). Returns true when handled. */
export function runLightCommand(cmd: string): boolean {
  if (!cmd.startsWith('light:')) return false;
  const st = useLightsStore.getState();
  const l = st.lights.find((x) => x.id === st.selectedLightId);
  if (!l) return true;
  const [, op, arg] = cmd.split(':');
  switch (op) {
    case 'properties': showRightTab('properties'); break;
    case 'aim': st.updateLightTransform(l.id, { rotation: { ...l.transform.rotation, enabled: false } }); break;
    case 'bright': st.updateLight(l.id, { brightness: Math.max(0, Math.round(l.brightness * Number(arg) * 100) / 100) }); break;
    case 'size':
      if (l.type === 'area' || l.type === 'overhead') {
        const k = Number(arg);
        st.updateLight(l.id, { areaWidth: Math.max(0.05, (l.areaWidth ?? 2) * k), areaHeight: Math.max(0.05, (l.areaHeight ?? 2) * k) });
      }
      break;
    case 'tex': toggleAreaLight(l.id); break;
    case 'visible': st.updateLight(l.id, { visible: !l.visible }); break;
    case 'solo': st.toggleLightSolo(l.id); break;
    case 'duplicate': st.duplicateLight(l.id); break;
    case 'delete': st.removeLight(l.id); break;
  }
  return true;
}

/** The studio-set group a piece belongs to (its properties live on the group), or null. */
export function rigGroupOf(obj: THREE.Object3D | null): THREE.Object3D | null {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o.userData?.isRigSet) return o;
  return null;
}

function openMaterialFor(obj: THREE.Object3D): void {
  let mesh: THREE.Mesh | null = (obj as THREE.Mesh).isMesh ? (obj as THREE.Mesh) : null;
  if (!mesh) obj.traverse((c) => { if (!mesh && (c as THREE.Mesh).isMesh) mesh = c as THREE.Mesh; });
  if (mesh) {
    const m = mesh as THREE.Mesh;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const matName = mat?.name || m.name;
    const match = useMaterialEditorStore.getState().materials.find((x) => x.name === matName || x.meshNames.includes(m.name));
    if (match) useMaterialEditorStore.getState().selectMaterial(match.id);
  }
  showRightTab('matEdit');
}

function frame(ctl: ModelingController, obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(0.2, box.getSize(new THREE.Vector3()).length() / 2);
  const cam = ctl.sm.camera as THREE.PerspectiveCamera;
  const dir = cam.position.clone().sub(ctl.sm.controls.target).normalize();
  const dist = (r / Math.sin((cam.fov * Math.PI) / 360)) * 1.15;
  ctl.sm.controls.target.copy(c);
  cam.position.copy(c).addScaledVector(dir, dist);
  ctl.sm.controls.update();
}

function isEditorDressing(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.userData?.isGrid || n.userData?.isProxy || n.userData?.isHelper) return true;
  }
  return false;
}

function setHidden(obj: THREE.Object3D, hidden: boolean): void {
  const h = useSceneHierarchyStore.getState();
  if (h.hiddenIds.includes(obj.uuid) !== hidden) h.toggleVisibility(obj.uuid);
  obj.visible = !hidden;
  obj.traverse((c) => { c.visible = !hidden; });
}

/** Commands from the object / part right-click menus (`part:*`). Returns true when handled. */
export function runPartCommand(ctl: ModelingController, cmd: string, obj: THREE.Object3D | null): boolean {
  if (!cmd.startsWith('part:')) return false;
  if (!obj) return true;
  switch (cmd.slice(5)) {
    case 'properties':
      useSceneHierarchyStore.getState().select((rigGroupOf(obj) ?? obj).uuid);
      showRightTab('properties');
      break;
    case 'material': openMaterialFor(obj); break;
    case 'hdri':
      setIncludeInHdri(obj, !useObjectHdriStore.getState().settings[objectKey(obj)]?.include);
      break;
    case 'light':
      if (getObjectLight(objectKey(obj))) disableObjectLight(objectKey(obj));
      else enableObjectLight(obj);
      break;
    case 'hide': setHidden(obj, true); break;
    case 'showall':
      useSceneHierarchyStore.getState().showAll();
      ctl.sm.scene.traverse((o) => { if (!isEditorDressing(o)) o.visible = true; });
      break;
    case 'isolate':
      useSceneHierarchyStore.getState().isolate(obj.uuid);
      ctl.sm.scene.traverse((o) => {
        if (isEditorDressing(o) || (o as THREE.Light).isLight) return;
        let inside = false;
        for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n === obj) inside = true;
        let holds = false;
        o.traverse((d) => { if (d === obj) holds = true; });
        o.visible = inside || holds;
      });
      break;
    case 'frame': frame(ctl, obj); break;
  }
  return true;
}
