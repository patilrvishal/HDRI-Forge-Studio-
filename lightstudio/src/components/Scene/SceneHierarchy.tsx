import React, { useCallback, useMemo, useState } from 'react';
import * as THREE from 'three';

interface SceneHierarchyProps {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}

interface HierarchyNode {
  name: string;
  type: 'group' | 'mesh' | 'light' | 'camera' | 'helper' | 'other';
  object: THREE.Object3D;
  children: HierarchyNode[];
  visible: boolean;
}

function getNodeType(obj: THREE.Object3D): HierarchyNode['type'] {
  if (obj.userData.isLightHelper || obj.userData.isProxy || obj.userData.isGrid) return 'helper';
  if (obj instanceof THREE.Light) return 'light';
  if (obj instanceof THREE.Camera) return 'camera';
  if (obj instanceof THREE.Mesh) return 'mesh';
  if (obj instanceof THREE.Group && obj.children.length > 0) return 'group';
  return 'other';
}

function buildTree(scene: THREE.Scene): HierarchyNode[] {
  const nodes: HierarchyNode[] = [];
  for (const child of scene.children) {
    if (child.userData.isGrid || child.userData.isProxy) continue;
    nodes.push(buildNode(child));
  }
  return nodes;
}

function buildNode(obj: THREE.Object3D): HierarchyNode {
  const children: HierarchyNode[] = [];
  for (const child of obj.children) {
    if (child.userData.isGrid || child.userData.isProxy) continue;
    children.push(buildNode(child));
  }
  return {
    name: obj.name || `${obj.type}_${obj.id}`,
    type: getNodeType(obj),
    object: obj,
    children,
    visible: obj.visible,
  };
}

const TYPE_ICONS: Record<string, string> = {
  group: '\u25C6',
  mesh: '\u25C7',
  light: '\u2600',
  camera: '\u25CE',
  helper: '\u25CB',
  other: '\u25AA',
};

const TYPE_COLORS: Record<string, string> = {
  group: 'var(--text-dim)',
  mesh: 'var(--accent-bright)',
  light: '#f0a868',
  camera: 'var(--text-sec)',
  helper: 'var(--text-dim)',
  other: 'var(--text-dim)',
};

function hasDescendantMatch(node: HierarchyNode, query: string): boolean {
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  return node.children.some((c) => hasDescendantMatch(c, q));
}

const TreeNode: React.FC<{
  node: HierarchyNode;
  depth: number;
  selected: THREE.Object3D | null;
  onSelect: (obj: THREE.Object3D) => void;
  onToggleVisibility: (obj: THREE.Object3D) => void;
  searchQuery: string;
}> = ({ node, depth, selected, onSelect, onToggleVisibility, searchQuery }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === node.object;
  const matchesSearch = !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase());
  const childMatchesSearch = searchQuery && hasDescendantMatch(node, searchQuery);

  if (searchQuery && !matchesSearch && !childMatchesSearch) return null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 6,
          height: 24,
          cursor: 'pointer',
          background: isSelected ? 'rgba(167, 139, 250, 0.1)' : 'transparent',
          borderRight: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
          transition: 'background 0.1s',
        }}
        onClick={() => onSelect(node.object)}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = isSelected
            ? 'rgba(167, 139, 250, 0.15)'
            : 'var(--bg-card)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = isSelected
            ? 'rgba(167, 139, 250, 0.1)'
            : 'transparent';
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 7,
            color: 'var(--text-dim)',
            visibility: hasChildren ? 'visible' : 'hidden',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          \u25B6
        </span>

        <span style={{ fontSize: 10, color: TYPE_COLORS[node.type], flexShrink: 0, width: 14, textAlign: 'center' }}>
          {TYPE_ICONS[node.type]}
        </span>

        <span
          style={{
            flex: 1,
            fontSize: 10,
            color: node.visible ? 'var(--text-sec)' : 'var(--text-dim)',
            opacity: node.visible ? 1 : 0.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontStyle: !node.visible ? 'italic' : 'normal',
          }}
          title={node.name}
        >
          {node.name}
        </span>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleVisibility(node.object); }}
          style={{
            width: 18, height: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            color: node.visible ? 'var(--text-sec)' : 'var(--text-dim)',
            opacity: 0.6, flexShrink: 0, padding: 0,
          }}
          title={node.visible ? 'Hide' : 'Show'}
        >
          {node.visible ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
              <line x1="2" y1="2" x2="14" y2="14" />
            </svg>
          )}
        </button>
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.object.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onToggleVisibility={onToggleVisibility}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const SceneHierarchy: React.FC<SceneHierarchyProps> = ({ sceneRef }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedObj, setSelectedObj] = useState<THREE.Object3D | null>(null);
  const [, forceUpdate] = useState(0);

  const tree = useMemo(() => {
    const scene = sceneRef.current;
    if (!scene) return [];
    return buildTree(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef.current, forceUpdate]);

  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  const handleSelect = useCallback((obj: THREE.Object3D) => {
    setSelectedObj(obj);
  }, []);

  const handleToggleVisibility = useCallback((obj: THREE.Object3D) => {
    obj.visible = !obj.visible;
    obj.traverse((child) => { child.visible = obj.visible; });
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    let meshes = 0;
    let lights = 0;
    let total = 0;
    const scene = sceneRef.current;
    if (scene) {
      scene.traverse((child) => {
        total++;
        if (child instanceof THREE.Mesh) meshes++;
        if (child instanceof THREE.Light) lights++;
      });
    }
    return { meshes, lights, total: total - 1 };
  }, [tree]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ position: 'relative' }}>
          <svg
            width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"
            style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5L15 15" />
          </svg>
          <input
            type="text"
            placeholder="Search objects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '3px 6px 3px 22px', fontSize: 10, background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)',
              outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 9, color: 'var(--text-dim)' }}>
          <span>{stats.total} objects</span>
          <span>{stats.meshes} meshes</span>
          <span>{stats.lights} lights</span>
          <button
            onClick={refresh}
            style={{ marginLeft: 'auto', fontSize: 9, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0 }}
            title="Refresh hierarchy"
          >
            \u21BB
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 2 }}>
        {tree.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>
            No objects in scene
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.object.id}
              node={node}
              depth={0}
              selected={selectedObj}
              onSelect={handleSelect}
              onToggleVisibility={handleToggleVisibility}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>

      {selectedObj && (
        <div style={{
          borderTop: '1px solid var(--border)', padding: '4px 8px',
          fontSize: 9, color: 'var(--text-dim)', display: 'flex', gap: 8,
          background: 'var(--bg-card)', flexShrink: 0,
        }}>
          <span style={{ color: TYPE_COLORS[getNodeType(selectedObj)] }}>
            {TYPE_ICONS[getNodeType(selectedObj)]}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedObj.name}>
            {selectedObj.name || selectedObj.type}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            ({selectedObj.position.x.toFixed(1)}, {selectedObj.position.y.toFixed(1)}, {selectedObj.position.z.toFixed(1)})
          </span>
        </div>
      )}
    </div>
  );
};