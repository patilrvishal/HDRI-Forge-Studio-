import type * as THREE from 'three';
import { useLightsStore } from '../store/lightsStore';
import { useObjectHdriStore } from '../store/objectHdriStore';
import { objectKey } from '../three/objectBinding';
import { getObjectLight } from '../three/objectLightApi';
import { OBJECT_MENU, type MenuItem } from './menus';

const sep: MenuItem = { sep: true };

/** Right-click menu for the selected light: only what a light has. */
export function lightMenu(): MenuItem[] {
  const st = useLightsStore.getState();
  const l = st.lights.find((x) => x.id === st.selectedLightId);
  if (!l) return [];
  const area = l.type === 'area' || l.type === 'overhead';
  return [
    { title: l.name },
    { label: 'Properties', cmd: 'light:properties' },
    sep,
    { label: 'Move', cmd: 'transform:grab', key: 'G' },
    { label: 'Rotate', cmd: 'transform:rotate', key: 'R' },
    { label: 'Scale', cmd: 'transform:scale', key: 'S' },
    { label: 'Aim at Centre', cmd: 'light:aim' },
    sep,
    { label: 'Brightness', sub: [
      { label: '+25%', cmd: 'light:bright:1.25' },
      { label: '-20%', cmd: 'light:bright:0.8' },
      { label: 'Double', cmd: 'light:bright:2' },
      { label: 'Half', cmd: 'light:bright:0.5' },
    ] },
    ...(area ? [
      { label: 'Size', sub: [
        { label: 'Bigger (x1.25)', cmd: 'light:size:1.25' },
        { label: 'Smaller (x0.8)', cmd: 'light:size:0.8' },
        { label: 'Double', cmd: 'light:size:2' },
        { label: 'Half', cmd: 'light:size:0.5' },
      ] },
      { label: l.areaTex?.enabled ? 'Textured Emitter: On (turn off)' : 'Textured Emitter: Off (turn on)', cmd: 'light:tex' },
    ] : []),
    sep,
    { label: l.visible ? 'Hide' : 'Show', cmd: 'light:visible' },
    { label: l.solo ? 'Un-isolate' : 'Isolate', cmd: 'light:solo' },
    { label: 'Duplicate', cmd: 'light:duplicate' },
    sep,
    { label: 'Delete', cmd: 'light:delete', key: 'X' },
  ];
}

const hdriLabel = (obj: THREE.Object3D) => (useObjectHdriStore.getState().settings[objectKey(obj)]?.include ? 'Exclude from HDRI' : 'Include in HDRI');
const lightLabel = (obj: THREE.Object3D) => (getObjectLight(objectKey(obj)) ? 'Stop Using as Light' : 'Use as Light');

/** Right-click menu for an editable mesh object: its mesh tools, subdivision, material and HDRI controls. */
export function objectMenu(obj: THREE.Object3D | null, name: string): MenuItem[] {
  const base = OBJECT_MENU.filter((m) => m.cmd !== 'object:delete');
  return [
    { title: name || 'Mesh' },
    ...base,
    sep,
    { label: 'Subdivision Surface', sub: [
      { label: 'Level 1', cmd: 'object:subsurf:1' },
      { label: 'Level 2', cmd: 'object:subsurf:2' },
      { label: 'Level 3', cmd: 'object:subsurf:3' },
    ] },
    sep,
    { label: 'Material', cmd: 'part:material' },
    ...(obj ? [{ label: hdriLabel(obj), cmd: 'part:hdri' }, { label: lightLabel(obj), cmd: 'part:light' }] : []),
    { label: 'Hide', cmd: 'part:hide' },
    { label: 'Frame in View', cmd: 'part:frame' },
    sep,
    { label: 'Delete', cmd: 'object:delete', key: 'X' },
  ];
}

/** Right-click menu for any other part of the scene (a loaded model's mesh, a piece of a rig's studio set). */
export function partMenu(obj: THREE.Object3D | null, name: string, isRig: boolean): MenuItem[] {
  return [
    { title: name || 'Object' },
    { label: isRig ? 'Rig Properties' : 'Properties', cmd: 'part:properties' },
    { label: 'Material', cmd: 'part:material' },
    sep,
    ...(obj ? [{ label: hdriLabel(obj), cmd: 'part:hdri' }, { label: lightLabel(obj), cmd: 'part:light' }] : []),
    sep,
    { label: 'Hide', cmd: 'part:hide' },
    { label: 'Isolate', cmd: 'part:isolate' },
    { label: 'Show All', cmd: 'part:showall' },
    { label: 'Frame in View', cmd: 'part:frame' },
  ];
}
