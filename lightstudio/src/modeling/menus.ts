import type { MenuKind } from '../store/modelingStore';

export interface MenuItem {
  label?: string;
  cmd?: string;
  key?: string;
  sub?: MenuItem[];
  sep?: boolean;
  title?: string;
}

const sep: MenuItem = { sep: true };

export const ADD_MESH: MenuItem[] = [
  { label: 'Plane', cmd: 'add:plane' },
  { label: 'Cube', cmd: 'add:cube' },
  { label: 'Circle', cmd: 'add:circle' },
  { label: 'UV Sphere', cmd: 'add:uvsphere' },
  { label: 'Ico Sphere', cmd: 'add:icosphere' },
  { label: 'Cylinder', cmd: 'add:cylinder' },
  { label: 'Cone', cmd: 'add:cone' },
  { label: 'Torus', cmd: 'add:torus' },
  { label: 'Grid', cmd: 'add:grid' },
];

const MERGE: MenuItem[] = [
  { label: 'At Center', cmd: 'merge:center' },
  { label: 'At Cursor', cmd: 'merge:cursor' },
  { label: 'At First', cmd: 'merge:first' },
  { label: 'At Last', cmd: 'merge:last' },
  { label: 'Collapse', cmd: 'merge:collapse' },
  sep,
  { label: 'By Distance', cmd: 'merge:distance' },
];

const DELETE: MenuItem[] = [
  { label: 'Vertices', cmd: 'delete:verts' },
  { label: 'Edges', cmd: 'delete:edges' },
  { label: 'Faces', cmd: 'delete:faces' },
  sep,
  { label: 'Only Edges & Faces', cmd: 'delete:onlyEdgesFaces' },
  { label: 'Only Faces', cmd: 'delete:onlyFaces' },
  sep,
  { label: 'Dissolve Vertices', cmd: 'dissolve:verts' },
  { label: 'Dissolve Edges', cmd: 'dissolve:edges' },
  { label: 'Dissolve Faces', cmd: 'dissolve:faces' },
  { label: 'Limited Dissolve', cmd: 'dissolve:limited' },
];

const VERTEX: MenuItem[] = [
  { label: 'Extrude Vertices', cmd: 'extrude', key: 'E' },
  { label: 'Bevel Vertices', cmd: 'bevel:vertex', key: 'Ctrl Shift B' },
  { label: 'Merge Vertices', sub: MERGE, key: 'M' },
  { label: 'Connect Vertex Path', cmd: 'connect', key: 'J' },
  { label: 'Slide Vertex', cmd: 'slide:vertex', key: 'Shift V' },
  { label: 'Smooth Vertices', cmd: 'smooth' },
  sep,
  { label: 'Rip Vertices', cmd: 'rip', key: 'V' },
  { label: 'Split', cmd: 'split', key: 'Y' },
  { label: 'Separate', cmd: 'separate:selection', key: 'P' },
  sep,
  { label: 'Dissolve Vertices', cmd: 'dissolve:verts' },
  { label: 'Delete Vertices', cmd: 'delete:verts', key: 'X' },
];

const EDGE: MenuItem[] = [
  { label: 'Extrude Edges', cmd: 'extrude', key: 'E' },
  { label: 'Bevel Edges', cmd: 'bevel', key: 'Ctrl B' },
  { label: 'Loop Cut and Slide', cmd: 'loopcut', key: 'Ctrl R' },
  { label: 'Subdivide', cmd: 'subdivide' },
  { label: 'Bridge Edge Loops', cmd: 'bridge' },
  { label: 'Edge Slide', cmd: 'slide:edge', key: 'G G' },
  sep,
  { label: 'Rotate Edge CW', cmd: 'rotate:cw' },
  { label: 'Rotate Edge CCW', cmd: 'rotate:ccw' },
  { label: 'Collapse', cmd: 'merge:collapse' },
  sep,
  { label: 'Mark Seam', cmd: 'seam:mark' },
  { label: 'Clear Seam', cmd: 'seam:clear' },
  { label: 'Mark Sharp', cmd: 'sharp:mark' },
  { label: 'Clear Sharp', cmd: 'sharp:clear' },
  sep,
  { label: 'Dissolve Edges', cmd: 'dissolve:edges' },
  { label: 'Delete Edges', cmd: 'delete:edges', key: 'X' },
];

const FACE: MenuItem[] = [
  { label: 'Extrude Faces', cmd: 'extrude', key: 'E' },
  { label: 'Extrude Individual Faces', cmd: 'extrude:individual', key: 'Alt E' },
  { label: 'Inset Faces', cmd: 'inset', key: 'I' },
  { label: 'Poke Faces', cmd: 'poke' },
  { label: 'Solidify Faces', cmd: 'solidify' },
  sep,
  { label: 'Fill', cmd: 'fill:holes', key: 'Alt F' },
  { label: 'Grid Fill', cmd: 'fill:grid' },
  { label: 'Triangulate Faces', cmd: 'triangulate' },
  { label: 'Tris to Quads', cmd: 'tris2quads' },
  { label: 'Flip Normals', cmd: 'flip' },
  sep,
  { label: 'Shade Smooth', cmd: 'shade:smooth' },
  { label: 'Shade Flat', cmd: 'shade:flat' },
  sep,
  { label: 'Dissolve Faces', cmd: 'dissolve:faces' },
  { label: 'Delete Faces', cmd: 'delete:faces', key: 'X' },
];

export const SELECT_MENU: MenuItem[] = [
  { label: 'All', cmd: 'select:all', key: 'A' },
  { label: 'None', cmd: 'select:none', key: 'Alt A' },
  { label: 'Invert', cmd: 'select:invert', key: 'Ctrl I' },
  sep,
  { label: 'Box Select', cmd: 'select:box', key: 'B' },
  { label: 'Circle Select', cmd: 'select:circle', key: 'C' },
  { label: 'Lasso Select', cmd: 'select:lasso', key: 'Ctrl RMB' },
  sep,
  { label: 'Select More', cmd: 'select:more', key: 'Ctrl Num +' },
  { label: 'Select Less', cmd: 'select:less', key: 'Ctrl Num -' },
  { label: 'Select Linked', cmd: 'select:linked', key: 'Ctrl L' },
  { label: 'Select Random', cmd: 'select:random' },
  { label: 'Checker Deselect', cmd: 'select:checker' },
  sep,
  { label: 'Hide Selected', cmd: 'hide', key: 'H' },
  { label: 'Hide Unselected', cmd: 'hide:unselected', key: 'Shift H' },
  { label: 'Reveal Hidden', cmd: 'reveal', key: 'Alt H' },
];

export const MESH_MENU: MenuItem[] = [
  { label: 'Move', cmd: 'transform:grab', key: 'G' },
  { label: 'Rotate', cmd: 'transform:rotate', key: 'R' },
  { label: 'Scale', cmd: 'transform:scale', key: 'S' },
  { label: 'Shear', cmd: 'transform:shear', key: 'Shift Ctrl Alt S' },
  sep,
  { label: 'Duplicate', cmd: 'duplicate', key: 'Shift D' },
  { label: 'Extrude', cmd: 'extrude', key: 'E' },
  { label: 'Inset Faces', cmd: 'inset', key: 'I' },
  { label: 'Bevel', cmd: 'bevel', key: 'Ctrl B' },
  { label: 'Loop Cut and Slide', cmd: 'loopcut', key: 'Ctrl R' },
  { label: 'Knife', cmd: 'knife', key: 'K' },
  { label: 'Spin', cmd: 'spin', key: 'Alt R' },
  sep,
  { label: 'Merge', sub: MERGE, key: 'M' },
  { label: 'Split', cmd: 'split', key: 'Y' },
  { label: 'Separate', cmd: 'separate:selection', key: 'P' },
  { label: 'Rip', cmd: 'rip', key: 'V' },
  { label: 'Fill', cmd: 'fill', key: 'F' },
  sep,
  { label: 'Delete', sub: DELETE, key: 'X' },
  sep,
  { label: 'Shade Smooth', cmd: 'shade:smooth' },
  { label: 'Shade Flat', cmd: 'shade:flat' },
  { label: 'Flip Normals', cmd: 'flip' },
  sep,
  { label: 'Cursor to Selected', cmd: 'cursor:selection', key: 'Shift S' },
  { label: 'Cursor to World Origin', cmd: 'cursor:origin', key: 'Shift C' },
];

export const OBJECT_MENU: MenuItem[] = [
  { label: 'Edit Mode', cmd: 'mode:toggle', key: 'Tab' },
  sep,
  { label: 'Move', cmd: 'transform:grab', key: 'G' },
  { label: 'Rotate', cmd: 'transform:rotate', key: 'R' },
  { label: 'Scale', cmd: 'transform:scale', key: 'S' },
  sep,
  { label: 'Duplicate Objects', cmd: 'duplicate', key: 'Shift D' },
  { label: 'Join', cmd: 'object:join', key: 'Ctrl J' },
  { label: 'Apply All Transforms', cmd: 'object:apply', key: 'Ctrl A' },
  { label: 'Origin to Geometry', cmd: 'object:origin' },
  sep,
  { label: 'Shade Smooth', cmd: 'shade:smooth' },
  { label: 'Shade Flat', cmd: 'shade:flat' },
  sep,
  { label: 'Delete', cmd: 'object:delete', key: 'X' },
];

export const MENUS: Record<Exclude<MenuKind, null>, MenuItem[]> = {
  add: [{ title: 'Add', label: 'Mesh', sub: ADD_MESH }, ...ADD_MESH.map((x) => ({ ...x }))],
  vertex: VERTEX,
  edge: EDGE,
  face: FACE,
  context: [],
  delete: DELETE,
  merge: MERGE,
  select: SELECT_MENU,
  separate: [{ label: 'Selection', cmd: 'separate:selection' }],
  shading: [],
  mesh: MESH_MENU,
  object: OBJECT_MENU,
  pivot: [],
  snap: [],
  proportional: [],
  shear: [],
};

// The Add menu is a flat list of primitives (cleaner than a nested single entry).
MENUS.add = ADD_MESH;

export function contextMenuFor(selectMode: 'vert' | 'edge' | 'face'): MenuItem[] {
  const base = selectMode === 'vert' ? VERTEX : selectMode === 'edge' ? EDGE : FACE;
  return [
    { title: selectMode === 'vert' ? 'Vertex Context Menu' : selectMode === 'edge' ? 'Edge Context Menu' : 'Face Context Menu' },
    ...base,
    sep,
    { label: 'Subdivide', cmd: 'subdivide' },
    { label: 'Knife', cmd: 'knife', key: 'K' },
    { label: 'Loop Cut and Slide', cmd: 'loopcut', key: 'Ctrl R' },
  ];
}
