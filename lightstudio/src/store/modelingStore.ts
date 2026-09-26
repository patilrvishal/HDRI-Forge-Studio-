import { create } from 'zustand';

export type ModelMode = 'object' | 'edit';
export type ModelSelectMode = 'vert' | 'edge' | 'face';
export type Falloff = 'smooth' | 'sphere' | 'root' | 'inverse' | 'sharp' | 'linear' | 'constant' | 'random';
export type PivotMode = 'median' | 'bounds' | 'cursor' | 'active';
export type Orientation = 'global' | 'local' | 'normal' | 'view';
export type SnapTarget = 'increment' | 'vertex' | 'edge' | 'face';
export type ModelTool = 'select' | 'box' | 'circle' | 'lasso' | 'knife' | 'loopcut' | 'polybuild' | 'cursor';

export type MenuKind =
  | 'add'
  | 'vertex'
  | 'edge'
  | 'face'
  | 'context'
  | 'delete'
  | 'merge'
  | 'select'
  | 'separate'
  | 'shading'
  | 'mesh'
  | 'object'
  | 'pivot'
  | 'snap'
  | 'proportional'
  | 'shear'
  | null;

export interface OpField {
  key: string;
  label: string;
  type: 'number' | 'bool' | 'enum';
  value: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export interface LastOp {
  name: string;
  fields: OpField[];
}

export interface ModelStats {
  vertsSel: number;
  vertsTotal: number;
  edgesSel: number;
  edgesTotal: number;
  facesSel: number;
  facesTotal: number;
  tris: number;
}

export interface ModelObjectInfo {
  id: string;
  name: string;
  visible: boolean;
}

interface ModelingState {
  mode: ModelMode;
  selectMode: ModelSelectMode;
  tool: ModelTool;
  xray: boolean;
  showStats: boolean;
  showNormals: boolean;
  proportional: { enabled: boolean; connected: boolean; falloff: Falloff; size: number };
  snapping: { enabled: boolean; target: SnapTarget };
  pivot: PivotMode;
  orientation: Orientation;
  objects: ModelObjectInfo[];
  activeId: string | null;
  selectedIds: string[];
  stats: ModelStats;
  /** Text shown in the status strip while a modal operator runs. */
  modal: { title: string; text: string } | null;
  hint: string;
  menu: { kind: MenuKind; x: number; y: number } | null;
  lastOp: LastOp | null;
  npanel: boolean;
  toast: { text: string; id: number } | null;
  /** Live values for the N panel (median of selection / object transform). */
  item: {
    label: string;
    loc: [number, number, number];
    rot: [number, number, number];
    scale: [number, number, number];
    median: [number, number, number] | null;
    material: { color: string; roughness: number; metalness: number; clearcoat: number; emissive: string; emissiveIntensity: number } | null;
    smooth: boolean;
  } | null;

  set: (patch: Partial<ModelingState>) => void;
  showToast: (text: string) => void;
}

const emptyStats: ModelStats = { vertsSel: 0, vertsTotal: 0, edgesSel: 0, edgesTotal: 0, facesSel: 0, facesTotal: 0, tris: 0 };

export const useModelingStore = create<ModelingState>((set) => ({
  mode: 'object',
  selectMode: 'vert',
  tool: 'select',
  xray: false,
  showStats: true,
  showNormals: false,
  proportional: { enabled: false, connected: false, falloff: 'smooth', size: 1 },
  snapping: { enabled: false, target: 'vertex' },
  pivot: 'median',
  orientation: 'global',
  objects: [],
  activeId: null,
  selectedIds: [],
  stats: emptyStats,
  modal: null,
  hint: '',
  menu: null,
  lastOp: null,
  npanel: false,
  toast: null,
  item: null,
  set: (patch) => set(patch),
  showToast: (text) => set({ toast: { text, id: Date.now() } }),
}));
