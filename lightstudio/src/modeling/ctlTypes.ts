import type * as THREE from 'three';

/** A modal operator: takes over pointer + keyboard until confirmed or cancelled. */
export interface Modal {
  name: string;
  /** pointer position relative to the viewport (px) */
  onMove(x: number, y: number, ev: PointerEvent): void;
  onDown?(x: number, y: number, ev: PointerEvent): void;
  onUp?(x: number, y: number, ev: PointerEvent): void;
  /** Return true if the key was consumed. */
  onKey(ev: KeyboardEvent): boolean;
  onWheel?(ev: WheelEvent): boolean;
  /** Left click / Enter */
  confirm(): void;
  /** Right click / Escape */
  cancel(): void;
}

export type FalloffFn = (t: number) => number;

export function falloffWeight(kind: string, d: number, radius: number, rnd = 1): number {
  if (radius <= 0) return 0;
  const t = Math.max(0, Math.min(1, 1 - d / radius));
  if (t <= 0) return 0;
  switch (kind) {
    case 'smooth':
      return t * t * (3 - 2 * t);
    case 'sphere':
      return Math.sqrt(Math.max(0, 2 * t - t * t));
    case 'root':
      return Math.sqrt(t);
    case 'inverse':
      return 2 * t - t * t;
    case 'sharp':
      return t * t;
    case 'linear':
      return t;
    case 'constant':
      return 1;
    case 'random':
      return t * rnd;
    default:
      return t;
  }
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WorldSnapshotObject {
  id: string;
  name: string;
  mesh: import('./EditMesh').EditMesh;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
  material: import('./EditableObject').EditableObjectJSON['material'];
  visible: boolean;
}

export interface WorldSnapshot {
  label: string;
  time: number;
  objects: WorldSnapshotObject[];
  activeId: string | null;
  selectedIds: string[];
  mode: 'object' | 'edit';
  selectMode: import('./EditMesh').SelectMode;
  sel: import('./EditMesh').Selection;
}

export type Vec3 = THREE.Vector3;
