import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSceneHierarchyStore, HierarchyFilterType } from '../../store/sceneHierarchyStore';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import { useUIStore } from '../../store/uiStore';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface SceneHierarchyProps {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}

interface HierarchyNode {
  name: string;
  type: 'group' | 'mesh' | 'light' | 'camera' | 'helper' | 'other';
  object: THREE.Object3D;
  children: HierarchyNode[];
}

interface ContextMenuState {
  x: number;
  y: number;
  objectId: string;
  showSubmenu: boolean;
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

function getAllGroupsInScene(scene: THREE.Scene): THREE.Group[] {
  const groups: THREE.Group[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.Group && child.children.length > 0 && !child.userData.isGrid && !child.userData.isProxy) {
      groups.push(child);
    }
  });
  return groups;
}

function countCollections(scene: THREE.Scene): number {
  let count = 0;
  for (const child of scene.children) {
    if (child instanceof THREE.Group && !child.userData.isGrid && !child.userData.isProxy) {
      count++;
    }
  }
  return count;
}

/* ═══════════════════════════════════════════════════════════════════
   Type colors & SVG icons
   ═══════════════════════════════════════════════════════════════════ */

const TYPE_COLORS: Record<string, string> = {
  group: '#7dd3fc',
  mesh: 'var(--accent-bright)',
  light: '#f0a868',
  camera: 'var(--text-sec)',
  helper: 'var(--text-dim)',
  other: 'var(--text-dim)',
};

const TypeIcon: React.FC<{ type: string; color?: string }> = ({ type, color }) => {
  const c = color || TYPE_COLORS[type] || 'var(--text-dim)';
  const sz = 14;
  switch (type) {
    case 'mesh':
      return (
        <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'light':
      return (
        <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" strokeWidth="1.2" />
          <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.2" />
          <line x1="1" y1="8" x2="3" y2="8" stroke="currentColor" strokeWidth="1.2" />
          <line x1="13" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'camera':
      return (
        <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <path d="M2 5a1 1 0 011-1h3l1.5-2h1L11 4h2a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="8.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'group':
      return (
        <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <path d="M2 4h4l1.5-2h5L14 4h2a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    default:
      return (
        <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" style={{ color: c, flexShrink: 0 }}>
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
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

  const groups = useMemo(() => {
    if (!scene) return [];
    return getAllGroupsInScene(scene).filter((g) => g.uuid !== state.objectId);
  }, [scene, state.objectId]);

  const handleSelectHierarchy = useCallback(() => {
    if (!obj) return;
    const ids = getAllDescendantIds(obj);
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
    if (!obj) return;
    useSceneHierarchyStore.getState().isolate(obj.uuid);
    if (scene) {
      scene.traverse((child) => {
        if (child.userData.isGrid || child.userData.isProxy) return;
        if (child.uuid === obj.uuid) {
          child.visible = true;
        } else {
          let isDescendant = false;
          obj.traverse((d) => { if (d.uuid === child.uuid) isDescendant = true; });
          child.visible = isDescendant;
        }
      });
    }
    refresh();
    onClose();
  }, [obj, scene, refresh, onClose]);

  const handleMoveToCollection = useCallback(
    (group: THREE.Group) => {
      if (!obj || !scene) return;
      obj.parent?.remove(obj);
      group.add(obj);
      refresh();
      onClose();
    },
    [obj, scene, refresh, onClose],
  );

  const handleNewCollectionHere = useCallback(() => {
    if (!obj) return;
    const parent = obj instanceof THREE.Group && obj.children.length > 0 ? obj : obj;
    const n = countCollections(scene!) + 1;
    const g = new THREE.Group();
    g.name = `Collection ${n}`;
    parent.add(g);
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
        groups.length > 0 ? (
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
            {groups.map((g) => (
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
                <TypeIcon type="group" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              </div>
            ))}
          </div>
        ) : undefined,
    },
    { divider: true },
    {
      label: 'Hide',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
          <line x1="2" y1="2" x2="14" y2="14" />
        </svg>
      ),
      shortcut: 'H',
      action: handleHide,
      disabled: isHidden,
    },
    {
      label: 'Show',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      ),
      action: handleShow,
      disabled: !isHidden,
    },
    {
      label: 'Isolate',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      ),
      shortcut: 'Numpad /',
      action: handleIsolate,
    },
    { divider: true },
    {
      label: 'New Collection Here',
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M3 3h3l1-1h4l1 1h2a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" />
          <path d="M8 7v5M5.5 9.5l5 0" />
        </svg>
      ),
      action: handleNewCollectionHere,
    },
  ];

  // Calculate position to keep menu in viewport
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
   Tree Node
   ═══════════════════════════════════════════════════════════════════ */

const TreeNode: React.FC<{
  node: HierarchyNode;
  depth: number;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  refresh: () => void;
  onContextMenu: (e: React.MouseEvent, uuid: string) => void;
}> = ({ node, depth, sceneRef, refresh, onContextMenu }) => {
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

  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.object.uuid;
  const isHidden = hiddenIds.includes(node.object.uuid);
  const isExpanded = expandedIds.includes(node.object.uuid);

  // Filter by type
  if (filterType !== 'all') {
    const typeMap: Record<string, string[]> = {
      mesh: ['mesh'],
      light: ['light'],
      camera: ['camera'],
      group: ['group'],
    };
    const allowed = typeMap[filterType] || [];
    if (allowed.length > 0 && !allowed.includes(node.type)) {
      // Check if any descendant matches
      let hasMatch = false;
      const checkDescendants = (n: HierarchyNode) => {
        if (allowed.includes(n.type)) hasMatch = true;
        n.children.forEach(checkDescendants);
      };
      checkDescendants(node);
      if (!hasMatch) return null;
    }
  }

  // Filter by search
  const matchesSearch = !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase());
  const childMatchesSearch = searchQuery ? hasDescendantMatch(node, searchQuery) : false;
  if (searchQuery && !matchesSearch && !childMatchesSearch) return null;

  const handleSelect = useCallback(() => {
    select(node.object.uuid);
    // Material integration for mesh
    if (node.type === 'mesh' && node.object instanceof THREE.Mesh) {
      const matStore = useMaterialEditorStore.getState();
      const mat = node.object.material;
      if (mat) {
        const matName = Array.isArray(mat) ? mat[0]?.name : (mat as THREE.Material).name;
        if (matName) {
          const match = matStore.materials.find((m) => m.name === matName);
          if (match) {
            matStore.selectMaterial(match.id);
            useUIStore.getState().setRightPanelTab('matEdit');
            useUIStore.getState().showPanel('rightPanel');
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
      node.object.traverse((c) => {
        c.visible = !newHidden;
      });
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

  // Filter children
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
          if (allowed.includes(child.type)) return true;
          // Check descendants
          let hasMatch = false;
          const check = (n: HierarchyNode) => {
            if (allowed.includes(n.type)) hasMatch = true;
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          paddingLeft: 4 + depth * 14,
          paddingRight: 4,
          height: 24,
          cursor: 'pointer',
          background: isSelected ? 'var(--accent-bg)' : 'transparent',
          borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
          transition: 'background 0.1s',
        }}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        onMouseEnter={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)';
          } else {
            (e.currentTarget as HTMLElement).style.background = 'rgba(167, 139, 250, 0.12)';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--accent-bg)' : 'transparent';
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
            fontSize: 7,
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
          \u25B6
        </span>

        {/* Type icon */}
        <TypeIcon type={node.type} />

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
              color: isHidden ? 'var(--text-dim)' : 'var(--text-sec)',
              opacity: isHidden ? 0.5 : 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontStyle: isHidden ? 'italic' : 'normal',
              minWidth: 0,
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

        {/* Visibility eye */}
        <button
          onClick={handleToggleVisibility}
          style={{
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: isHidden ? 'var(--text-dim)' : 'var(--text-sec)',
            opacity: 0.6,
            flexShrink: 0,
            padding: 0,
          }}
          title={isHidden ? 'Show' : 'Hide'}
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
        </button>
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Number Input
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
    <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 28, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
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
            width: 52,
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            color: 'var(--text-sec)',
            padding: '1px 3px',
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
  children: React.ReactNode;
}> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 0',
          cursor: 'pointer',
          userSelect: 'none',
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
          \u25B6
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-sec)', fontWeight: 500 }}>{title}</span>
      </div>
      {open && <div style={{ paddingLeft: 12, paddingBottom: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Object Properties Panel
   ═══════════════════════════════════════════════════════════════════ */

const ObjectPropertiesPanel: React.FC<{
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  refresh: () => void;
}> = ({ sceneRef, refresh }) => {
  const selectedId = useSceneHierarchyStore((s) => s.selectedId);
  const hiddenIds = useSceneHierarchyStore((s) => s.hiddenIds);

  const selectedObj = useMemo(() => {
    if (!selectedId || !sceneRef.current) return null;
    return findObjectByUuid(sceneRef.current, selectedId);
  }, [selectedId, sceneRef.current]);

  if (!selectedObj) return null;

  const nodeType = getNodeType(selectedObj);
  const isHidden = hiddenIds.includes(selectedObj.uuid);

  const toDeg = THREE.MathUtils.radToDeg;
  const toRad = THREE.MathUtils.degToRad;

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

  // Mesh info
  let meshInfo: React.ReactNode = null;
  if (selectedObj instanceof THREE.Mesh) {
    const geo = selectedObj.geometry;
    const verts = geo.attributes.position ? geo.attributes.position.count : 0;
    const tris = geo.index ? geo.index.count / 3 : verts / 3;
    const matNames = (Array.isArray(selectedObj.material) ? selectedObj.material : [selectedObj.material])
      .map((m) => m.name || 'unnamed')
      .join(', ');

    meshInfo = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Vertices</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{verts}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Triangles</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{Math.floor(tris)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Material</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={matNames}>
            {matNames}
          </span>
        </div>
      </div>
    );
  }

  // Light info
  let lightInfo: React.ReactNode = null;
  if (selectedObj instanceof THREE.Light) {
    const lightColor = '#' + selectedObj.color.getHexString();
    let intensity = 0;
    if ('intensity' in selectedObj) {
      intensity = (selectedObj as THREE.Light).intensity;
    }
    lightInfo = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Type</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{selectedObj.type.replace('Light', '')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Color</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: lightColor,
                border: '1px solid var(--border)',
                display: 'inline-block',
              }}
            />
            <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{lightColor}</span>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Intensity</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{intensity.toFixed(3)}</span>
        </div>
      </div>
    );
  }

  const childCount = selectedObj.children.filter(
    (c) => !c.userData.isGrid && !c.userData.isProxy,
  ).length;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
        maxHeight: '45%',
        overflowY: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
        <TypeIcon type={nodeType} />
        <span style={{ fontSize: 10, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedObj.name || selectedObj.type}>
          {selectedObj.name || selectedObj.type}
        </span>
        <span
          style={{
            fontSize: 8,
            color: TYPE_COLORS[nodeType],
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '0 4px',
            lineHeight: '14px',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}
        >
          {nodeType}
        </span>
      </div>

      {/* Transform */}
      <CollapsibleSection title="Transform" defaultOpen={true}>
        <Vec3Input
          label="Pos"
          values={[selectedObj.position.x, selectedObj.position.y, selectedObj.position.z]}
          onChange={handlePositionChange}
        />
        <Vec3Input
          label="Rot"
          values={[
            toDeg(selectedObj.rotation.x),
            toDeg(selectedObj.rotation.y),
            toDeg(selectedObj.rotation.z),
          ]}
          onChange={handleRotationChange}
        />
        <Vec3Input
          label="Scale"
          values={[selectedObj.scale.x, selectedObj.scale.y, selectedObj.scale.z]}
          onChange={handleScaleChange}
        />
      </CollapsibleSection>

      {/* Info */}
      <CollapsibleSection title="Info" defaultOpen={false}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Type</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{nodeType}</span>
        </div>
        {meshInfo}
        {lightInfo}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Children</span>
          <span style={{ color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{childCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
          <span style={{ color: 'var(--text-dim)' }}>Visible</span>
          <button
            onClick={handleVisibleToggle}
            style={{
              fontSize: 8,
              background: isHidden ? 'var(--bg-input)' : 'rgba(74, 222, 128, 0.15)',
              color: isHidden ? 'var(--text-dim)' : 'var(--success)',
              border: `1px solid ${isHidden ? 'var(--border)' : 'rgba(74, 222, 128, 0.3)'}`,
              borderRadius: 3,
              padding: '0 6px',
              lineHeight: '14px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {isHidden ? 'Hidden' : 'Visible'}
          </button>
        </div>
      </CollapsibleSection>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Main SceneHierarchy Component
   ═══════════════════════════════════════════════════════════════════ */

export const SceneHierarchy: React.FC<SceneHierarchyProps> = ({ sceneRef }) => {
  const [tick, setTick] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const filterType = useSceneHierarchyStore((s) => s.filterType);
  const searchQuery = useSceneHierarchyStore((s) => s.searchQuery);
  const setFilterType = useSceneHierarchyStore((s) => s.setFilterType);
  const setSearchQuery = useSceneHierarchyStore((s) => s.setSearchQuery);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const tree = useMemo(() => {
    const scene = sceneRef.current;
    if (!scene) return [];
    return buildTree(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef.current, tick]);

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

  const filterButtons: { label: string; value: HierarchyFilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Mesh', value: 'mesh' },
    { label: 'Light', value: 'light' },
    { label: 'Camera', value: 'camera' },
    { label: 'Group', value: 'group' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Toolbar */}
      <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Filter buttons row */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          {filterButtons.map((fb) => (
            <button
              key={fb.value}
              onClick={() => setFilterType(fb.value)}
              style={{
                fontSize: 9,
                padding: '1px 6px',
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
              title={`Filter: ${fb.label}`}
            >
              {fb.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* New Collection */}
          <button
            onClick={handleNewCollection}
            title="New Collection"
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 4h4l1.5-2h5L14 4h2a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z" />
              <path d="M8 7v4M6 9h4" />
            </svg>
          </button>

          {/* Show All */}
          <button
            onClick={handleShowAll}
            title="Show All"
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </button>

          {/* Refresh */}
          <button
            onClick={refresh}
            title="Refresh"
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M13.5 8A5.5 5.5 0 113 5.5" />
              <path d="M13.5 3v5h-5" />
            </svg>
          </button>
        </div>

        {/* Search bar */}
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
            placeholder="Search objects..."
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
      </div>

      {/* Tree View */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 2 }}>
        {tree.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>No objects in scene</div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.object.uuid}
              node={node}
              depth={0}
              sceneRef={sceneRef}
              refresh={refresh}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Properties Panel */}
      <ObjectPropertiesPanel sceneRef={sceneRef} refresh={refresh} />

      {/* Context Menu */}
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