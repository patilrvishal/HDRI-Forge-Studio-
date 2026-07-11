import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSceneHierarchyStore, HierarchyFilterType } from '../../store/sceneHierarchyStore';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import { useUIStore } from '../../store/uiStore';

/* ═══════════════════════════════════════════════════════════════════
   Types & Interfaces
   ═══════════════════════════════════════════════════════════════════ */

interface SceneHierarchyProps {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}

interface HierarchyNode {
  name: string;
  type: 'group' | 'mesh' | 'light' | 'camera' | 'helper' | 'other';
  object: THREE.Object3D;
  children: HierarchyNode[];
  isCollection?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  objectId: string;
  showSubmenu: boolean;
}

interface DragState {
  dragUuid: string;
  dragName: string;
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function getNodeType(obj: THREE.Object3D): HierarchyNode['type'] {
  if (obj.userData.isLightHelper || obj.userData.isProxy || obj.userData.isGrid) return 'helper';
  if (obj instanceof THREE.Light) return 'light';
  if (obj instanceof THREE.Camera) return 'camera';
  if (obj instanceof THREE.Mesh) return 'mesh';
  if (obj instanceof THREE.Group && obj.children.length > 0) return 'group';
  return 'other';
}

function isCollection(obj: THREE.Object3D): boolean {
  return obj instanceof THREE.Group &&
    !obj.userData.isGrid &&
    !obj.userData.isProxy &&
    obj.userData._isCollection === true;
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
    isCollection: isCollection(obj),
  };
}

function hasDescendantMatch(node: HierarchyNode, query: string): boolean {
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  return node.children.some((c) => hasDescendantMatch(c, q));
}

function findObjectByUuid(scene: THREE.Scene, uuid: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  scene.traverse((child) => {
    if (child.uuid === uuid) result = child;
  });
  return result;
}

function getAllDescendantIds(obj: THREE.Object3D): string[] {
  const ids: string[] = [obj.uuid];
  obj.traverse((child) => {
    if (child.uuid !== obj.uuid) ids.push(child.uuid);
  });
  return ids;
}

function getAllCollections(scene: THREE.Scene): THREE.Group[] {
  const groups: THREE.Group[] = [];
  scene.traverse((child) => {
    if (isCollection(child)) groups.push(child as THREE.Group);
  });
  return groups;
}

function countCollections(scene: THREE.Scene): number {
  let count = 0;
  for (const child of scene.children) {
    if (isCollection(child)) count++;
  }
  scene.traverse((child) => {
    if (child !== scene && isCollection(child)) count++;
  });
  return count;
}

/** Check if targetId is a descendant of parentId (or the same object) */
function isDescendantOf(parentObj: THREE.Object3D, checkObj: THREE.Object3D): boolean {
  if (parentObj.uuid === checkObj.uuid) return true;
  let found = false;
  parentObj.traverse((child) => {
    if (child.uuid === checkObj.uuid) found = true;
  });
  return found;
}

/* ═══════════════════════════════════════════════════════════════════
   Type colors & SVG icons (Blender-style small icons)
   ═══════════════════════════════════════════════════════════════════ */

const TYPE_COLORS: Record<string, string> = {
  group: '#7dd3fc',
  mesh: '#a78bfa',
  light: '#f0a868',
  camera: '#94a3b8',
  helper: '#475569',
  other: '#475569',
  collection: '#fbbf24',
};

const TypeIcon: React.FC<{ type: string; isCollection?: boolean; size?: number }> = ({ type, isCollection: isColl, size = 13 }) => {
  const c = isColl ? TYPE_COLORS.collection : (TYPE_COLORS[type] || '#475569');
  if (isColl) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
        <path d="M2 4h4l1.5-2h5L14 4h2v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      </svg>
    );
  }
  switch (type) {
    case 'mesh':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <path d="M8 1.5L14.5 5v6L8 14.5 1.5 11V5z" stroke="currentColor" strokeWidth="1.1" />
          <path d="M1.5 5L8 8l6.5-3M8 8v6.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        </svg>
      );
    case 'light':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.1" />
          <line x1="8" y1="2" x2="8" y2="3.5" stroke="currentColor" strokeWidth="1" />
          <line x1="8" y1="12.5" x2="8" y2="14" stroke="currentColor" strokeWidth="1" />
          <line x1="2" y1="8" x2="3.5" y2="8" stroke="currentColor" strokeWidth="1" />
          <line x1="12.5" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1" />
          <line x1="3.8" y1="3.8" x2="4.9" y2="4.9" stroke="currentColor" strokeWidth="0.8" />
          <line x1="11.1" y1="11.1" x2="12.2" y2="12.2" stroke="currentColor" strokeWidth="0.8" />
          <line x1="3.8" y1="12.2" x2="4.9" y2="11.1" stroke="currentColor" strokeWidth="0.8" />
          <line x1="11.1" y1="4.9" x2="12.2" y2="3.8" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      );
    case 'camera':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <path d="M2 5h3l1-1.5h4l1 1.5h3a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'group':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
          <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      );
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Context Menu
   ═══════════════════════════════════════════════════════════════════ */

interface CtxItem {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  divider?: false;
  action?: () => void;
  submenu?: React.ReactNode;
  disabled?: boolean;
}

interface CtxDivider {
  divider: true;
}

const CtxDivider = () => (
  <div style={{ height: 1, background: 'var(--border-light)', margin: '3px 6px' }} />
);

const ContextMenu: React.FC<{
  state: ContextMenuState;
  onClose: () => void;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  refresh: () => void;
}> = ({ state, onClose, sceneRef, refresh }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoverSubmenu, setHoverSubmenu] = useState(false);

  const scene = sceneRef.current;
  const obj = scene ? findObjectByUuid(scene, state.objectId) : null;

  const store = useSceneHierarchyStore.getState();
  const isHidden = obj ? store.hiddenIds.includes(obj.uuid) : false;
  const isIsolated = obj ? store.isolatedId === obj.uuid : false;

  const collections = useMemo(() => {
    if (!scene) return [];
    return getAllCollections(scene).filter((g) => g.uuid !== state.objectId);
  }, [scene, state.objectId]);

  const handleSelectHierarchy = useCallback(() => {
    if (!obj) return;
    store.select(obj.uuid);
    refresh();
    onClose();
  }, [obj, store, refresh, onClose]);

  const handleDeselect = useCallback(() => {
    store.select(null);
    onClose();
  }, [store, onClose]);

  const handleDuplicate = useCallback(() => {
    if (!obj) return;
    const clone = obj.clone();
    clone.name = obj.name + '_copy';
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone();
        if (child.geometry) child.geometry = child.geometry.clone();
      }
    });
    if (obj.parent) obj.parent.add(clone);
    refresh();
    onClose();
  }, [obj, refresh, onClose]);

  const handleDelete = useCallback(() => {
    if (!obj) return;
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m.dispose());
      }
    });
    obj.parent?.remove(obj);
    const s = useSceneHierarchyStore.getState();
    const newHidden = s.hiddenIds.filter((id) => id !== obj.uuid);
    useSceneHierarchyStore.setState({ hiddenIds: newHidden, selectedId: null, isolatedId: null });
    refresh();
    onClose();
  }, [obj, refresh, onClose]);

  const handleHide = useCallback(() => {
    if (!obj) return;
    useSceneHierarchyStore.getState().toggleVisibility(obj.uuid);
    obj.visible = false;
    obj.traverse((c) => { c.visible = false; });
    refresh();
    onClose();
  }, [obj, refresh, onClose]);

  const handleShow = useCallback(() => {
    if (!obj) return;
    const s = useSceneHierarchyStore.getState();
    const newHidden = s.hiddenIds.filter((id) => id !== obj.uuid);
    useSceneHierarchyStore.setState({ hiddenIds: newHidden });
    obj.visible = true;
    obj.traverse((c) => { c.visible = true; });
    refresh();
    onClose();
  }, [obj, refresh, onClose]);

  const handleIsolate = useCallback(() => {
    if (!obj || !scene) return;
    const s = useSceneHierarchyStore.getState();
    if (s.isolatedId === obj.uuid) {
      s.showAll();
      scene.traverse((child) => {
        if (child.userData.isGrid || child.userData.isProxy) return;
        child.visible = true;
      });
    } else {
      s.isolate(obj.uuid);
      scene.traverse((child) => {
        if (child.userData.isGrid || child.userData.isProxy) return;
        if (child.uuid === obj.uuid) {
          child.visible = true;
        } else {
          let isDesc = false;
          obj.traverse((d) => { if (d.uuid === child.uuid) isDesc = true; });
          child.visible = isDesc;
        }
      });
    }
    refresh();
    onClose();
  }, [obj, scene, refresh, onClose]);

  const handleMoveToCollection = useCallback(
    (group: THREE.Group) => {
      if (!obj || !scene) return;
      // Prevent moving a parent into its own descendant
      if (isDescendantOf(obj, group)) return;
      obj.parent?.remove(obj);
      group.add(obj);
      refresh();
      onClose();
    },
    [obj, scene, refresh, onClose],
  );

  const handleNewCollection = useCallback(() => {
    if (!scene) return;
    const n = countCollections(scene) + 1;
    const g = new THREE.Group();
    g.name = `Collection ${n}`;
    g.userData._isCollection = true;
    scene.add(g);
    refresh();
    onClose();
  }, [scene, refresh, onClose]);

  const handleNewCollectionHere = useCallback(() => {
    if (!obj || !scene) return;
    const n = countCollections(scene) + 1;
    const g = new THREE.Group();
    g.name = `Collection ${n}`;
    g.userData._isCollection = true;
    obj.add(g);
    refresh();
    onClose();
  }, [obj, scene, refresh, onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!obj) return null;

  const menuItems: (CtxItem | CtxDivider)[] = [
    {
      label: 'Select Hierarchy',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2z" />
        </svg>
      ),
      action: handleSelectHierarchy,
    },
    { label: 'Deselect', icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
      </svg>
    ), action: handleDeselect },
    { divider: true },
    {
      label: 'Duplicate',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="5" y="5" width="9" height="9" rx="1" />
          <rect x="1" y="1" width="9" height="9" rx="1" opacity="0.5" />
        </svg>
      ),
      shortcut: 'Shift+D',
      action: handleDuplicate,
    },
    {
      label: 'Delete',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--danger)" strokeWidth="1.3">
          <path d="M3 4h10M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M8 7v5M10 7v5M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4" />
        </svg>
      ),
      shortcut: 'Del',
      action: handleDelete,
    },
    { divider: true },
    {
      label: 'Move to Collection',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M3 2h3l1-1h4l1 1h2a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
          <path d="M6 10h6M9 7v6" />
        </svg>
      ),
      submenu:
        collections.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              background: 'var(--bg-deep)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 0',
              minWidth: 140,
              maxHeight: 200,
              overflowY: 'auto',
              zIndex: 1000,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            {collections.map((g) => (
              <div
                key={g.uuid}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMoveToCollection(g);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  fontSize: 10,
                  color: 'var(--text-sec)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--accent-bg)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-sec)';
                }}
              >
                <TypeIcon type="group" isCollection />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              </div>
            ))}
          </div>
        ) : undefined,
    },
    { divider: true },
    {
      label: isHidden ? 'Show' : 'Hide',
      icon: isHidden ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
          <line x1="2" y1="2" x2="14" y2="14" />
        </svg>
      ),
      shortcut: 'H',
      action: isHidden ? handleShow : handleHide,
    },
    {
      label: isIsolated ? 'Disable Isolate' : 'Isolate',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      ),
      action: handleIsolate,
    },
    { divider: true },
    {
      label: 'New Collection',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 4h4l1.5-2h5L14 4h2a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" />
          <path d="M8 7v5M5.5 9.5h5" />
        </svg>
      ),
      action: handleNewCollection,
    },
    {
      label: 'New Collection Here',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 4h4l1.5-2h5L14 4h2a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" />
          <path d="M8 7v5M5.5 9.5h5" />
        </svg>
      ),
      action: handleNewCollectionHere,
    },
  ];

  const menuWidth = 200;
  const menuHeight = menuItems.length * 26 + 10;
  const adjustedX = state.x + menuWidth > window.innerWidth ? state.x - menuWidth : state.x;
  const adjustedY = state.y + menuHeight > window.innerHeight ? Math.max(0, state.y - menuHeight) : state.y;

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-sm)',
        padding: '3px 0',
        minWidth: 180,
        zIndex: 999,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}
    >
      {menuItems.map((item, i) => {
        if ('divider' in item && item.divider) {
          return <CtxDivider key={`div-${i}`} />;
        }
        const mi = item as CtxItem;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px',
              height: 26,
              fontSize: 10,
              color: mi.disabled ? 'var(--text-dim)' : 'var(--text-sec)',
              cursor: mi.disabled ? 'default' : 'pointer',
              position: 'relative',
              opacity: mi.disabled ? 0.4 : 1,
              userSelect: 'none',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (!mi.disabled && mi.action) mi.action();
            }}
            onMouseEnter={(e) => {
              if (mi.disabled) return;
              (e.currentTarget as HTMLElement).style.background = 'var(--accent-bg)';
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              if (mi.submenu) setHoverSubmenu(true);
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = mi.disabled ? 'var(--text-dim)' : 'var(--text-sec)';
              if (mi.submenu) setHoverSubmenu(false);
            }}
          >
            <span style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {mi.icon}
            </span>
            <span style={{ flex: 1 }}>{mi.label}</span>
            {mi.submenu && (
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M6 4l4 4-4 4" />
              </svg>
            )}
            {mi.shortcut && (
              <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 12, fontFamily: 'var(--font-mono)' }}>
                {mi.shortcut}
              </span>
            )}
            {mi.submenu && (state.showSubmenu || hoverSubmenu) && mi.submenu}
          </div>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Blender-style Row Icons (Eye, Camera, Select Arrow)
   ═══════════════════════════════════════════════════════════════════ */

/** Small inline icon button for the tree row */
const RowIconButton: React.FC<{
  active?: boolean;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}> = ({ active, title, onClick, children }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: 16,
      height: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: active ? 'var(--text-sec)' : 'var(--text-dim)',
      opacity: active ? 1 : 0.35,
      flexShrink: 0,
      padding: 0,
      borderRadius: 2,
      transition: 'opacity 0.1s',
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLElement).style.opacity = '1';
      (e.currentTarget as HTMLElement).style.background = 'var(--accent-bg)';
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.opacity = active ? '1' : '0.35';
      (e.currentTarget as HTMLElement).style.background = 'none';
    }}
  >
    {children}
  </button>
);

/* ═══════════════════════════════════════════════════════════════════
   Tree Node (Blender-style with drag-and-drop support)
   ═══════════════════════════════════════════════════════════════════ */

const TreeNode: React.FC<{
  node: HierarchyNode;
  depth: number;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  refresh: () => void;
  onContextMenu: (e: React.MouseEvent, uuid: string) => void;
  onDragStart: (uuid: string, name: string) => void;
  onDragEnd: () => void;
  onDropOnCollection: (collectionUuid: string) => void;
  dropTargetId: string | null;
}> = ({ node, depth, sceneRef, refresh, onContextMenu, onDragStart, onDragEnd, onDropOnCollection, dropTargetId }) => {
  const selectedId = useSceneHierarchyStore((s) => s.selectedId);
  const expandedIds = useSceneHierarchyStore((s) => s.expandedIds);
  const hiddenIds = useSceneHierarchyStore((s) => s.hiddenIds);
  const filterType = useSceneHierarchyStore((s) => s.filterType);
  const searchQuery = useSceneHierarchyStore((s) => s.searchQuery);
  const select = useSceneHierarchyStore((s) => s.select);
  const toggleExpanded = useSceneHierarchyStore((s) => s.toggleExpanded);
  const toggleVisibility = useSceneHierarchyStore((s) => s.toggleVisibility);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.object.name);
  const renameRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // ── ALL hooks must be called before any conditional return (React Rules of Hooks) ──

  const handleSelect = useCallback(() => {
    select(node.object.uuid);
    useUIStore.getState().setRightPanelTab('properties');
    useUIStore.getState().showPanel('rightPanel');
    if (node.type === 'mesh' && node.object instanceof THREE.Mesh) {
      const matStore = useMaterialEditorStore.getState();
      const mat = node.object.material;
      if (mat) {
        const matName = Array.isArray(mat) ? mat[0]?.name : (mat as THREE.Material).name;
        if (matName) {
          const match = matStore.materials.find((m) => m.name === matName);
          if (match) {
            matStore.selectMaterial(match.id);
          }
        }
      }
    }
  }, [node, select]);

  const handleToggleVisibility = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleVisibility(node.object.uuid);
      const newHidden = useSceneHierarchyStore.getState().hiddenIds.includes(node.object.uuid);
      node.object.visible = !newHidden;
      node.object.traverse((c) => { c.visible = !newHidden; });
      refresh();
    },
    [node, toggleVisibility, refresh],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, node.object.uuid);
    },
    [node.object.uuid, onContextMenu],
  );

  const handleDoubleClickName = useCallback(() => {
    setRenaming(true);
    setRenameValue(node.object.name);
    setTimeout(() => renameRef.current?.select(), 0);
  }, [node.object.name]);

  const handleRenameCommit = useCallback(() => {
    setRenaming(false);
    if (renameValue.trim()) {
      node.object.name = renameValue.trim();
      refresh();
    }
  }, [renameValue, node.object, refresh]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleRenameCommit();
      if (e.key === 'Escape') {
        setRenaming(false);
        setRenameValue(node.object.name);
      }
    },
    [handleRenameCommit, node.object.name],
  );

  const handleNodeDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.object.uuid);
    onDragStart(node.object.uuid, node.name);
    if (rowRef.current) rowRef.current.style.opacity = '0.4';
  }, [node.object.uuid, node.name, onDragStart]);

  const handleNodeDragEnd = useCallback(() => {
    onDragEnd();
    if (rowRef.current) rowRef.current.style.opacity = '1';
  }, [onDragEnd]);

  const handleNodeDragOver = useCallback((e: React.DragEvent) => {
    if (!node.isCollection) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, [node.isCollection]);

  const handleNodeDragEnter = useCallback((e: React.DragEvent) => {
    if (!node.isCollection) return;
    e.preventDefault();
    onDropOnCollection(node.object.uuid);
  }, [node.isCollection, node.object.uuid, onDropOnCollection]);

  const handleNodeDragLeave = useCallback((e: React.DragEvent) => {
    if (!node.isCollection) return;
    onDropOnCollection('');
  }, [node.isCollection, onDropOnCollection]);

  const handleNodeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!node.isCollection || !sceneRef.current) return;
    const dragUuid = e.dataTransfer.getData('text/plain');
    if (!dragUuid || dragUuid === node.object.uuid) { onDropOnCollection(''); return; }
    const scene = sceneRef.current;
    const dragObj = findObjectByUuid(scene, dragUuid);
    if (!dragObj) { onDropOnCollection(''); return; }
    if (isDescendantOf(dragObj, node.object)) { onDropOnCollection(''); return; }
    dragObj.parent?.remove(dragObj);
    node.object.add(dragObj);
    onDropOnCollection('');
    refresh();
  }, [node.isCollection, node.object, sceneRef, onDropOnCollection, refresh]);

  const filteredChildren = useMemo(() => {
    return node.children.filter((child) => {
      if (filterType !== 'all') {
        const typeMap: Record<string, string[]> = {
          mesh: ['mesh'],
          light: ['light'],
          camera: ['camera'],
          group: ['group'],
        };
        const allowed = typeMap[filterType] || [];
        if (allowed.length > 0) {
          const isChildGroupMatch = child.isCollection && filterType === 'group';
          if (allowed.includes(child.type) || isChildGroupMatch) return true;
          let hasMatch = false;
          const check = (n: HierarchyNode) => {
            if (allowed.includes(n.type) || (n.isCollection && filterType === 'group')) hasMatch = true;
            n.children.forEach(check);
          };
          check(child);
          return hasMatch;
        }
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return child.name.toLowerCase().includes(q) || hasDescendantMatch(child, searchQuery);
      }
      return true;
    });
  }, [node.children, filterType, searchQuery]);

  // ── Computed values (after all hooks) ──

  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.object.uuid;
  const isHidden = hiddenIds.includes(node.object.uuid);
  const isExpanded = expandedIds.includes(node.object.uuid);
  const isColl = node.isCollection;
  const isDropTarget = dropTargetId === node.object.uuid;

  // Filter by type (early return — no hooks below this point)
  if (filterType !== 'all') {
    const typeMap: Record<string, string[]> = {
      mesh: ['mesh'],
      light: ['light'],
      camera: ['camera'],
      group: ['group'],
    };
    const allowed = typeMap[filterType] || [];
    if (allowed.length > 0 && !allowed.includes(node.type)) {
      const isGroupMatch = isColl && filterType === 'group';
      if (!isGroupMatch) {
        let hasMatch = false;
        const checkDescendants = (n: HierarchyNode) => {
          if (allowed.includes(n.type) || (n.isCollection && filterType === 'group')) hasMatch = true;
          n.children.forEach(checkDescendants);
        };
        checkDescendants(node);
        if (!hasMatch) return null;
      }
    }
  }

  // Filter by search (early return — no hooks below this point)
  const matchesSearch = !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase());
  const childMatchesSearch = searchQuery ? hasDescendantMatch(node, searchQuery) : false;
  if (searchQuery && !matchesSearch && !childMatchesSearch) return null;

  return (
    <div>
      <div
        ref={rowRef}
        draggable={!renaming}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          paddingLeft: 2 + depth * 16,
          paddingRight: 2,
          height: 24,
          cursor: 'pointer',
          background: isDropTarget
            ? 'rgba(251, 191, 36, 0.15)'
            : isSelected
              ? 'rgba(167, 139, 250, 0.15)'
              : 'transparent',
          borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
          borderBottom: isDropTarget ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid transparent',
          borderTop: isDropTarget ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid transparent',
          transition: 'background 0.1s',
          userSelect: 'none',
        }}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        onDragStart={handleNodeDragStart}
        onDragEnd={handleNodeDragEnd}
        onDragOver={handleNodeDragOver}
        onDragEnter={handleNodeDragEnter}
        onDragLeave={handleNodeDragLeave}
        onDrop={handleNodeDrop}
        onMouseEnter={(e) => {
          if (!isSelected && !isDropTarget) {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          } else if (!isDropTarget) {
            (e.currentTarget as HTMLElement).style.background = 'rgba(167, 139, 250, 0.15)';
          }
        }}
      >
        {/* Chevron */}
        <span
          style={{
            width: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 6,
            color: 'var(--text-dim)',
            visibility: hasChildren ? 'visible' : 'hidden',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(node.object.uuid);
          }}
        >
          {'\u25B6'}
        </span>

        {/* Type icon */}
        <TypeIcon type={node.type} isCollection={isColl} />

        {/* Name / Rename input */}
        {renaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              fontSize: 10,
              background: 'var(--bg-input)',
              border: '1px solid var(--accent)',
              borderRadius: 2,
              color: 'var(--text)',
              padding: '0 3px',
              outline: 'none',
              minWidth: 0,
              fontFamily: 'var(--font-ui)',
              height: 16,
            }}
            autoFocus
          />
        ) : (
          <span
            style={{
              flex: 1,
              fontSize: 10,
              color: isHidden ? 'var(--text-dim)' : (isColl ? '#fbbf24' : 'var(--text-sec)'),
              opacity: isHidden ? 0.5 : 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontStyle: isHidden ? 'italic' : 'normal',
              minWidth: 0,
              fontWeight: isColl ? 500 : 400,
              lineHeight: '24px',
            }}
            title={node.name}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleDoubleClickName();
            }}
          >
            {node.name}
          </span>
        )}

        {/* ── Blender-style row action icons ── */}

        {/* Eye (viewport visibility) */}
        <RowIconButton
          active={!isHidden}
          title={isHidden ? 'Show in Viewport' : 'Hide in Viewport'}
          onClick={handleToggleVisibility}
        >
          {!isHidden ? (
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
        </RowIconButton>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {filteredChildren.map((child) => (
            <TreeNode
              key={child.object.uuid}
              node={child}
              depth={depth + 1}
              sceneRef={sceneRef}
              refresh={refresh}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOnCollection={onDropOnCollection}
              dropTargetId={dropTargetId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Vec3 Input
   ═══════════════════════════════════════════════════════════════════ */

const AXIS_COLORS = ['#f87171', '#4ade80', '#60a5fa'];
const AXIS_LABELS = ['X', 'Y', 'Z'];

const Vec3Input: React.FC<{
  label: string;
  values: [number, number, number];
  onChange: (idx: number, value: number) => void;
  decimals?: number;
}> = ({ label, values, onChange, decimals = 3 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
    <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 40, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
      {label}
    </span>
    {[0, 1, 2].map((idx) => (
      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <span style={{ fontSize: 8, color: AXIS_COLORS[idx], width: 8, textAlign: 'center', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {AXIS_LABELS[idx]}
        </span>
        <input
          type="number"
          step="any"
          value={parseFloat(values[idx].toFixed(decimals))}
          onChange={(e) => onChange(idx, parseFloat(e.target.value) || 0)}
          style={{
            width: 48,
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            color: 'var(--text-sec)',
            padding: '2px 3px',
            outline: 'none',
            flexShrink: 0,
          }}
        />
      </div>
    ))}
  </div>
);

/* ═══════════════════════════════════════════════════════════════════
   Collapsible Section
   ═══════════════════════════════════════════════════════════════════ */

const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = true, icon, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(255,255,255,0.02)',
        }}
        onClick={() => setOpen(!open)}
      >
        <span
          style={{
            fontSize: 7,
            color: 'var(--text-dim)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            display: 'inline-block',
            width: 10,
            textAlign: 'center',
          }}
        >
          {'\u25B6'}
        </span>
        {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
        <span style={{ fontSize: 9, color: 'var(--text-sec)', fontWeight: 500, letterSpacing: '0.02em' }}>{title}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 6px 6px 18px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {children}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Info Row helper
   ═══════════════════════════════════════════════════════════════════ */

const InfoRow: React.FC<{
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  title?: string;
}> = ({ label, value, valueColor, title }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
    <span style={{ color: 'var(--text-dim)' }}>{label}</span>
    <span
      style={{ color: valueColor || 'var(--text-sec)', fontFamily: 'var(--font-mono)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={title}
    >
      {value}
    </span>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════
   Object Properties Panel (Enhanced — bottom panel with tick refresh)
   ═══════════════════════════════════════════════════════════════════ */

const ObjectPropertiesPanel: React.FC<{
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  refresh: () => void;
  tick: number;
}> = ({ sceneRef, refresh, tick }) => {
  const selectedId = useSceneHierarchyStore((s) => s.selectedId);
  const hiddenIds = useSceneHierarchyStore((s) => s.hiddenIds);

  // Use useState + tick to force re-renders when external changes happen
  const [localTick, setLocalTick] = useState(0);

  // Re-read object from scene on each tick (not from stale ref)
  const selectedObj = useMemo(() => {
    if (!selectedId || !sceneRef.current) return null;
    return findObjectByUuid(sceneRef.current, selectedId);
    // tick + localTick ensure we re-evaluate even if selectedId didn't change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tick, localTick]);

  // Periodic refresh to pick up external changes (gizmo transforms, etc.)
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => {
      setLocalTick((n) => n + 1);
    }, 250);
    return () => clearInterval(interval);
  }, [selectedId]);

  // Force re-render on selection change
  useEffect(() => {
    setLocalTick((n) => n + 1);
  }, [selectedId]);

  // ALL hooks must be called BEFORE any early return (React Rules of Hooks)
  const isIsolated = useSceneHierarchyStore((s) => s.isolatedId === (selectedId ?? ''));

  if (!selectedObj) {
    return (
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 48,
          background: 'var(--bg-card)',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          No Selection
        </span>
      </div>
    );
  }

  const nodeType = getNodeType(selectedObj);
  const isHidden = hiddenIds.includes(selectedObj.uuid);
  const isColl = isCollection(selectedObj);

  const toDeg = THREE.MathUtils.radToDeg;
  const toRad = THREE.MathUtils.degToRad;

  // Snapshot current values for display
  const pos: [number, number, number] = [selectedObj.position.x, selectedObj.position.y, selectedObj.position.z];
  const rot: [number, number, number] = [toDeg(selectedObj.rotation.x), toDeg(selectedObj.rotation.y), toDeg(selectedObj.rotation.z)];
  const scl: [number, number, number] = [selectedObj.scale.x, selectedObj.scale.y, selectedObj.scale.z];

  const worldPos = new THREE.Vector3();
  selectedObj.getWorldPosition(worldPos);

  const handlePositionChange = (idx: number, value: number) => {
    if (idx === 0) selectedObj.position.x = value;
    if (idx === 1) selectedObj.position.y = value;
    if (idx === 2) selectedObj.position.z = value;
    refresh();
  };

  const handleRotationChange = (idx: number, value: number) => {
    const rad = toRad(value);
    if (idx === 0) selectedObj.rotation.x = rad;
    if (idx === 1) selectedObj.rotation.y = rad;
    if (idx === 2) selectedObj.rotation.z = rad;
    refresh();
  };

  const handleScaleChange = (idx: number, value: number) => {
    if (idx === 0) selectedObj.scale.x = value;
    if (idx === 1) selectedObj.scale.y = value;
    if (idx === 2) selectedObj.scale.z = value;
    refresh();
  };

  const handleVisibleToggle = () => {
    useSceneHierarchyStore.getState().toggleVisibility(selectedObj.uuid);
    const newHidden = useSceneHierarchyStore.getState().hiddenIds.includes(selectedObj.uuid);
    selectedObj.visible = !newHidden;
    selectedObj.traverse((c) => { c.visible = !newHidden; });
    refresh();
  };

  const handleIsolate = () => {
    const s = useSceneHierarchyStore.getState();
    const scene = sceneRef.current;
    if (!scene) return;
    if (s.isolatedId === selectedObj.uuid) {
      s.showAll();
      scene.traverse((child) => {
        if (child.userData.isGrid || child.userData.isProxy) return;
        child.visible = true;
      });
    } else {
      s.isolate(selectedObj.uuid);
      scene.traverse((child) => {
        if (child.userData.isGrid || child.userData.isProxy) return;
        if (child.uuid === selectedObj.uuid) {
          child.visible = true;
        } else {
          let isDesc = false;
          selectedObj.traverse((d) => { if (d.uuid === child.uuid) isDesc = true; });
          child.visible = isDesc;
        }
      });
    }
    refresh();
  };

  const handleDeselect = () => {
    useSceneHierarchyStore.getState().select(null);
  };

  // ── Mesh info ──
  let meshInfo: React.ReactNode = null;
  if (selectedObj instanceof THREE.Mesh) {
    try {
    const geo = selectedObj.geometry;
    const verts = geo && geo.attributes && geo.attributes.position ? geo.attributes.position.count : 0;
    const tris = geo && geo.index ? geo.index.count / 3 : verts / 3;
    const mat = selectedObj.material;
    const matArr = mat ? (Array.isArray(mat) ? mat.filter(Boolean) : [mat]) : [];
    const matNames = matArr.length > 0 ? matArr.map((m) => m.name || 'unnamed').join(', ') : 'unnamed';
    const matType = matArr.length > 0 ? (matArr[0])?.type || '\u2014' : '\u2014';
    const hasVertexColors = geo && geo.attributes ? !!geo.attributes.color : false;
    const hasUVs = geo && geo.attributes ? !!geo.attributes.uv : false;
    const hasNormals = geo && geo.attributes ? !!geo.attributes.normal : false;

    // Get bounding box
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const size = new THREE.Vector3();
    if (bb) bb.getSize(size);

    meshInfo = (
      <CollapsibleSection title="Mesh Info" defaultOpen={false} icon={
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
          <path d="M8 1.5L14.5 5v6L8 14.5 1.5 11V5z" />
        </svg>
      }>
        <InfoRow label="Vertices" value={verts.toLocaleString()} />
        <InfoRow label="Triangles" value={Math.floor(tris).toLocaleString()} />
        <InfoRow
          label="Size"
          value={`${size.x.toFixed(2)} \u00d7 ${size.y.toFixed(2)} \u00d7 ${size.z.toFixed(2)}`}
        />
        <InfoRow
          label="Material"
          value={matNames}
          valueColor="var(--accent-bright)"
          title={matNames}
        />
        <InfoRow label="Mat. Type" value={matType.replace('Material', '')} />
        <InfoRow
          label="UVs"
          value={hasUVs ? 'Yes' : 'No'}
          valueColor={hasUVs ? 'var(--success)' : 'var(--text-dim)'}
        />
        <InfoRow
          label="Normals"
          value={hasNormals ? 'Yes' : 'No'}
          valueColor={hasNormals ? 'var(--success)' : 'var(--text-dim)'}
        />
        <InfoRow
          label="Vertex Colors"
          value={hasVertexColors ? 'Yes' : 'No'}
          valueColor={hasVertexColors ? 'var(--success)' : 'var(--text-dim)'}
        />
      </CollapsibleSection>
    );
    } catch (_) { meshInfo = null; }
  }

  // ── Light info ──
  let lightInfo: React.ReactNode = null;
  if (selectedObj instanceof THREE.Light) {
    const lightColor = '#' + selectedObj.color.getHexString();
    const intensity = selectedObj.intensity;
    const lightType = selectedObj.type.replace('Light', '');

    let extraInfo: React.ReactNode = null;

    if (selectedObj instanceof THREE.PointLight) {
      const dist = selectedObj.distance;
      extraInfo = (
        <>
          <InfoRow
            label="Distance"
            value={dist === 0 ? 'Infinite' : dist.toFixed(2)}
          />
          <InfoRow label="Decay" value={String(selectedObj.decay)} />
        </>
      );
    } else if (selectedObj instanceof THREE.SpotLight) {
      extraInfo = (
        <>
          <InfoRow
            label="Distance"
            value={selectedObj.distance === 0 ? 'Infinite' : selectedObj.distance.toFixed(2)}
          />
          <InfoRow label="Decay" value={String(selectedObj.decay)} />
          <InfoRow label="Angle" value={`${toDeg(selectedObj.angle).toFixed(1)}\u00b0`} />
          <InfoRow label="Penumbra" value={selectedObj.penumbra.toFixed(2)} />
        </>
      );
    } else if (selectedObj instanceof THREE.DirectionalLight) {
      extraInfo = (
        <InfoRow label="Intensity" value={intensity.toFixed(3)} />
      );
    } else if (selectedObj instanceof THREE.HemisphereLight) {
      const skyColor = '#' + selectedObj.color.getHexString();
      const groundColor = '#' + selectedObj.groundColor.getHexString();
      extraInfo = (
        <>
          <InfoRow label="Sky Color" value={skyColor} />
          <InfoRow label="Ground Color" value={groundColor} />
          <InfoRow label="Intensity" value={intensity.toFixed(3)} />
        </>
      );
    }

    lightInfo = (
      <CollapsibleSection title="Light Info" defaultOpen={false} icon={
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
          <circle cx="8" cy="8" r="3.5" />
          <line x1="8" y1="2" x2="8" y2="3.5" />
          <line x1="8" y1="12.5" x2="8" y2="14" />
        </svg>
      }>
        <InfoRow label="Type" value={lightType} valueColor="#f0a868" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Color</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: lightColor,
                border: '1px solid var(--border)',
                display: 'inline-block',
                boxShadow: `0 0 4px ${lightColor}40`,
              }}
            />
            <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{lightColor}</span>
          </span>
        </div>
        {extraInfo}
      </CollapsibleSection>
    );
  }

  const childCount = selectedObj.children.filter(
    (c) => !c.userData.isGrid && !c.userData.isProxy,
  ).length;

  const typeBadge = isColl ? 'Collection' : nodeType;
  const typeBadgeColor = TYPE_COLORS[isColl ? 'collection' : nodeType] || 'var(--text-dim)';

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
        flexShrink: 0,
      }}
    >
      {/* ── Header: type icon + name + type badge + close button ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 6px',
        borderBottom: '1px solid var(--border-light)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <TypeIcon type={nodeType} isCollection={isColl} size={12} />
        <span
          style={{
            fontSize: 10,
            color: 'var(--text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 500,
          }}
          title={selectedObj.name || selectedObj.type}
        >
          {selectedObj.name || selectedObj.type}
        </span>
        <span
          style={{
            fontSize: 7,
            color: typeBadgeColor,
            background: 'var(--bg-input)',
            border: `1px solid ${typeBadgeColor}30`,
            borderRadius: 3,
            padding: '0 5px',
            lineHeight: '15px',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
            fontWeight: 600,
            letterSpacing: '0.03em',
          }}
        >
          {typeBadge}
        </span>
        {/* Close / Deselect button */}
        <button
          onClick={handleDeselect}
          title="Deselect (close properties)"
          style={{
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            borderRadius: 2,
            padding: 0,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--text)';
            (e.currentTarget as HTMLElement).style.background = 'var(--accent-bg)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)';
            (e.currentTarget as HTMLElement).style.background = 'none';
          }}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* ── Scrollable properties content ── */}
      <div style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        {/* Quick Actions Row */}
        <div style={{ display: 'flex', gap: 4, padding: '4px 6px', borderBottom: '1px solid var(--border-light)' }}>
          <button
            onClick={handleVisibleToggle}
            style={{
              flex: 1,
              fontSize: 8,
              padding: '3px 0',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${isHidden ? 'var(--border)' : 'rgba(74, 222, 128, 0.3)'}`,
              background: isHidden ? 'var(--bg-input)' : 'rgba(74, 222, 128, 0.1)',
              color: isHidden ? 'var(--text-dim)' : 'var(--success)',
              transition: 'all 0.1s',
            }}
          >
            {isHidden ? 'Hidden' : 'Visible'}
          </button>
          <button
            onClick={handleIsolate}
            style={{
              flex: 1,
              fontSize: 8,
              padding: '3px 0',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${isIsolated ? 'rgba(167, 139, 250, 0.3)' : 'var(--border)'}`,
              background: isIsolated ? 'rgba(167, 139, 250, 0.1)' : 'var(--bg-input)',
              color: isIsolated ? 'var(--accent-bright)' : 'var(--text-dim)',
              transition: 'all 0.1s',
            }}
          >
            {isIsolated ? 'Isolated' : 'Isolate'}
          </button>
        </div>

        {/* Transform Section */}
        <CollapsibleSection title="Transform" defaultOpen={true} icon={
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
            <path d="M8 1v14M1 8h14M4 4l8 8M12 4l-8 8" />
          </svg>
        }>
          <Vec3Input label="Location" values={pos} onChange={handlePositionChange} />
          <Vec3Input label="Rotation" values={rot} onChange={handleRotationChange} />
          <Vec3Input label="Scale" values={scl} onChange={handleScaleChange} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 1 }}>
            <span style={{ color: 'var(--text-dim)' }}>World Pos</span>
            <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 8 }}>
              {worldPos.x.toFixed(2)}, {worldPos.y.toFixed(2)}, {worldPos.z.toFixed(2)}
            </span>
          </div>
        </CollapsibleSection>

        {/* Object Info Section */}
        <CollapsibleSection title="Object Info" defaultOpen={true} icon={
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3.5M8 10.5v.5" />
          </svg>
        }>
          <InfoRow
            label="Type"
            value={isColl ? 'Collection' : nodeType}
          />
          <InfoRow label="Children" value={String(childCount)} />
          <InfoRow
            label="UUID"
            value={`${selectedObj.uuid.slice(0, 13)}\u2026`}
            valueColor="var(--text-dim)"
            title={selectedObj.uuid}
          />
        </CollapsibleSection>

        {/* Mesh Info Section (conditional) */}
        {meshInfo}

        {/* Light Info Section (conditional) */}
        {lightInfo}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Resizable Split Handle
   ═══════════════════════════════════════════════════════════════════ */

const SplitHandle: React.FC<{
  onDrag: (ratio: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ onDrag, containerRef }) => {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startY = e.clientY;
    const startRatio = (e.clientY - rect.top) / rect.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + delta / rect.height));
      onDrag(newRatio);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [containerRef, onDrag]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        height: 4,
        flexShrink: 0,
        cursor: 'ns-resize',
        background: 'var(--border-light)',
        position: 'relative',
        zIndex: 2,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--border-light)';
      }}
    >
      {/* Center grip dots */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        gap: 2,
        pointerEvents: 'none',
      }}>
        <span style={{ width: 3, height: 1, background: 'var(--text-dim)', opacity: 0.5, borderRadius: 0.5 }} />
        <span style={{ width: 3, height: 1, background: 'var(--text-dim)', opacity: 0.5, borderRadius: 0.5 }} />
        <span style={{ width: 3, height: 1, background: 'var(--text-dim)', opacity: 0.5, borderRadius: 0.5 }} />
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Main SceneHierarchy Component (Blender-style with resizable split)
   ═══════════════════════════════════════════════════════════════════ */

export const SceneHierarchy: React.FC<SceneHierarchyProps> = ({ sceneRef }) => {
  const [tick, setTick] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.6);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const filterType = useSceneHierarchyStore((s) => s.filterType);
  const searchQuery = useSceneHierarchyStore((s) => s.searchQuery);
  const setFilterType = useSceneHierarchyStore((s) => s.setFilterType);
  const setSearchQuery = useSceneHierarchyStore((s) => s.setSearchQuery);
  const isolatedId = useSceneHierarchyStore((s) => s.isolatedId);
  const selectedId = useSceneHierarchyStore((s) => s.selectedId);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const tree = useMemo(() => {
    const scene = sceneRef.current;
    if (!scene) return [];
    return buildTree(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef.current, tick]);

  // Count total objects
  const objectCount = useMemo(() => {
    let count = 0;
    const countNodes = (nodes: HierarchyNode[]) => {
      for (const n of nodes) {
        count++;
        countNodes(n.children);
      }
    };
    countNodes(tree);
    return count;
  }, [tree]);

  // Expand all
  const handleExpandAll = useCallback(() => {
    const ids: string[] = [];
    const scene = sceneRef.current;
    if (scene) {
      scene.traverse((child) => {
        if (!child.userData.isGrid && !child.userData.isProxy && child.children.length > 0) {
          ids.push(child.uuid);
        }
      });
    }
    useSceneHierarchyStore.getState().expandAll(ids);
  }, [sceneRef]);

  // Collapse all
  const handleCollapseAll = useCallback(() => {
    useSceneHierarchyStore.getState().collapseAll();
  }, []);

  // New Collection
  const handleNewCollection = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const n = countCollections(scene) + 1;
    const g = new THREE.Group();
    g.name = `Collection ${n}`;
    g.userData._isCollection = true;
    scene.add(g);
    refresh();
  }, [sceneRef, refresh]);

  // Show All
  const handleShowAll = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    useSceneHierarchyStore.getState().showAll();
    scene.traverse((child) => {
      child.visible = true;
    });
    refresh();
  }, [sceneRef, refresh]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, uuid: string) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, objectId: uuid, showSubmenu: false });
  }, []);

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // Close context menu on scroll
  useEffect(() => {
    if (ctxMenu) {
      const handler = () => closeContextMenu();
      window.addEventListener('scroll', handler, true);
      window.addEventListener('resize', handler);
      return () => {
        window.removeEventListener('scroll', handler, true);
        window.removeEventListener('resize', handler);
      };
    }
  }, [ctxMenu, closeContextMenu]);

  // Drag-and-drop handlers (lifted to parent for cross-tree-node drops)
  const handleDragStart = useCallback((_uuid: string, _name: string) => {
    // We don't need to do much here; the UUID is in dataTransfer
  }, []);

  const handleDragEnd = useCallback(() => {
    setDropTargetId(null);
  }, []);

  const handleDropOnCollection = useCallback((collectionUuid: string) => {
    setDropTargetId(collectionUuid || null);
  }, []);

  const handleSplitDrag = useCallback((ratio: number) => {
    setSplitRatio(ratio);
  }, []);

  const filterButtons: { label: string; value: HierarchyFilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Mesh', value: 'mesh' },
    { label: 'Light', value: 'light' },
    { label: 'Camera', value: 'camera' },
    { label: 'Group', value: 'group' },
  ];

  // Calculate tree vs properties split
  const showProperties = selectedId !== null;

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* ── Clean Toolbar ── */}
      <div style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
        {/* Search bar — Blender-style at top */}
        <div style={{ position: 'relative' }}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="1.5"
            style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5L15 15" />
          </svg>
          <input
            type="text"
            placeholder="Filter objects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '3px 6px 3px 22px',
              fontSize: 10,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter buttons + action icons row */}
        <div style={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {filterButtons.map((fb) => (
            <button
              key={fb.value}
              onClick={() => setFilterType(fb.value)}
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                background: filterType === fb.value ? 'var(--accent-bg)' : 'transparent',
                color: filterType === fb.value ? 'var(--accent)' : 'var(--text-dim)',
                fontWeight: filterType === fb.value ? 600 : 400,
                fontFamily: 'var(--font-ui)',
                transition: 'all 0.1s',
                outline: 'none',
              }}
              title={`Filter: ${fb.label}${fb.value === 'group' ? ' (includes Collections)' : ''}`}
            >
              {fb.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Object count badge */}
          <span style={{ fontSize: 8, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginRight: 2 }}>
            {objectCount}
          </span>

          {/* Expand/Collapse All */}
          <button
            onClick={handleExpandAll}
            title="Expand All"
            style={{
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
              padding: 0, borderRadius: 2,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 2l8 6-8 6z" />
            </svg>
          </button>
          <button
            onClick={handleCollapseAll}
            title="Collapse All"
            style={{
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
              padding: 0, borderRadius: 2,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 6l12-4v12L2 10z" />
            </svg>
          </button>

          {/* New Collection */}
          <button
            onClick={handleNewCollection}
            title="New Collection"
            style={{
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
              padding: 0, borderRadius: 2,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 4h4l1.5-2h5L14 4h2a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" />
              <path d="M8 7v4M6 9h4" />
            </svg>
          </button>

          {/* Show All (visible when isolated) */}
          {isolatedId && (
            <button
              onClick={handleShowAll}
              title="Show All (exit isolation)"
              style={{
                width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)',
                cursor: 'pointer', color: 'var(--accent-bright)',
                padding: 0, borderRadius: 2,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
                <circle cx="8" cy="8" r="2" />
              </svg>
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={refresh}
            title="Refresh"
            style={{
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
              padding: 0, borderRadius: 2,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M13.5 8A5.5 5.5 0 113 5.5" />
              <path d="M13.5 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Resizable Split: Tree (top) + Properties (bottom) ── */}
      {showProperties ? (
        <>
          {/* Tree view area */}
          <div style={{ flex: splitRatio, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, paddingTop: 1 }}>
            {tree.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>
                No objects in scene
              </div>
            ) : (
              tree.map((node) => (
                <TreeNode
                  key={node.object.uuid}
                  node={node}
                  depth={0}
                  sceneRef={sceneRef}
                  refresh={refresh}
                  onContextMenu={handleContextMenu}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDropOnCollection={handleDropOnCollection}
                  dropTargetId={dropTargetId}
                />
              ))
            )}
          </div>

          {/* Resizable split handle */}
          <SplitHandle onDrag={handleSplitDrag} containerRef={containerRef} />

          {/* Properties panel area */}
          <div style={{ flex: 1 - splitRatio, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ObjectPropertiesPanel sceneRef={sceneRef} refresh={refresh} tick={tick} />
          </div>
        </>
      ) : (
        /* No selection — tree takes full remaining space */
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 1 }}>
          {tree.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>
              No objects in scene
            </div>
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.object.uuid}
                node={node}
                depth={0}
                sceneRef={sceneRef}
                refresh={refresh}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDropOnCollection={handleDropOnCollection}
                dropTargetId={dropTargetId}
              />
            ))
          )}
          {/* No Selection placeholder at bottom */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 48,
              background: 'var(--bg-card)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              No Selection
            </span>
          </div>
        </div>
      )}

      {/* ── Context Menu ── */}
      {ctxMenu && (
        <ContextMenu
          state={ctxMenu}
          onClose={closeContextMenu}
          sceneRef={sceneRef}
          refresh={refresh}
        />
      )}
    </div>
  );
};