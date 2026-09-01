import React, { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useSceneHierarchyStore } from '../../store/sceneHierarchyStore';
import { useLightsStore } from '../../store/lightsStore';
import { useHDRIShapesStore } from '../../store/hdriShapesStore';
import { useUIStore } from '../../store/uiStore';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';
import { LightProperties } from '../Lights/LightProperties';
import { HDRIShapeProperties } from '../Lights/HDRIShapeProperties';
import { CustomHDRIProperties } from '../Environment/CustomHDRIProperties';

/* ═══════════════════════════════════════════════════════════════════
   Utility: find a Three.js object by UUID in the scene
   ═══════════════════════════════════════════════════════════════════ */
function findObjectByUuid(scene: THREE.Scene, uuid: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  scene.traverse((child) => {
    if (child.uuid === uuid) result = child;
  });
  return result;
}

function getNodeType(obj: THREE.Object3D): string {
  if (obj.userData.isLightHelper || obj.userData.isProxy || obj.userData.isGrid) return 'helper';
  if (obj instanceof THREE.Light) return 'light';
  if (obj instanceof THREE.Camera) return 'camera';
  if (obj instanceof THREE.Mesh) return 'mesh';
  if (obj instanceof THREE.Group && obj.children.length > 0) return 'group';
  return 'other';
}

/* ═══════════════════════════════════════════════════════════════════
   Type badge colors (matching SceneHierarchy)
   ═══════════════════════════════════════════════════════════════════ */
const TYPE_COLORS: Record<string, string> = {
  mesh: '#4ade80',
  light: '#f0a868',
  camera: '#60a5fa',
  group: '#4a9eff',
  helper: '#6b7280',
  other: '#6b7280',
  collection: '#4a9eff',
};

/* ═══════════════════════════════════════════════════════════════════
   Small UI helpers (self-contained, matching app style)
   ═══════════════════════════════════════════════════════════════════ */

const InfoRow: React.FC<{
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  title?: string;
}> = ({ label, value, valueColor, title }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, padding: '1px 0' }}>
    <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{label}</span>
    <span
      style={{ color: valueColor || 'var(--text-sec)', fontFamily: 'var(--font-mono)', fontSize: 10, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={title}
    >
      {value}
    </span>
  </div>
);

const Vec3Input: React.FC<{
  label: string;
  values: [number, number, number];
  onChange: (idx: number, value: number) => void;
  step?: number;
}> = ({ label, values, onChange, step = 0.01 }) => {
  const labels = ['X', 'Y', 'Z'];
  const colors = ['#f87171', '#4ade80', '#60a5fa'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 8, color: colors[i], fontWeight: 700, width: 10, textAlign: 'center' }}>{labels[i]}</span>
            <input
              type="number"
              value={Number(v.toFixed(3))}
              step={step}
              onChange={(e) => onChange(i, parseFloat(e.target.value) || 0)}
              style={{
                flex: 1,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                color: 'var(--text)',
                fontSize: 9,
                padding: '2px 4px',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
                minWidth: 0,
                width: 0,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Collapsible Section
   ═══════════════════════════════════════════════════════════════════ */

const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 8px',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(255,255,255,0.015)',
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
        <span style={{ fontSize: 9, color: 'var(--text-sec)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 8px 8px 20px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {children}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Type Icon
   ═══════════════════════════════════════════════════════════════════ */

const TypeIcon: React.FC<{ type: string; size?: number }> = ({ type, size = 12 }) => {
  const s = size;
  switch (type) {
    case 'mesh':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="var(--text-sec)" strokeWidth="1.2">
          <path d="M8 1.5L14.5 5v6L8 14.5 1.5 11V5z" />
        </svg>
      );
    case 'light':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="var(--text-sec)" strokeWidth="1.2">
          <circle cx="8" cy="8" r="3.5" />
          <line x1="8" y1="2" x2="8" y2="3.5" />
          <line x1="8" y1="12.5" x2="8" y2="14" />
        </svg>
      );
    case 'camera':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="var(--text-sec)" strokeWidth="1.2">
          <rect x="2" y="5" width="12" height="8" rx="1.5" />
          <path d="M5.5 5L6.5 3h3l1 2" />
        </svg>
      );
    case 'group':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="var(--text-sec)" strokeWidth="1.2">
          <rect x="2" y="2" width="12" height="12" rx="2" strokeDasharray="3 2" />
        </svg>
      );
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
          <circle cx="8" cy="8" r="6" />
        </svg>
      );
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Deselect button
   ═══════════════════════════════════════════════════════════════════ */

const DeselectButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    title="Deselect"
    style={{
      width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
      borderRadius: 2, padding: 0, flexShrink: 0,
    }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; (e.currentTarget as HTMLElement).style.background = 'var(--accent-bg)'; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
  >
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  </button>
);

/* ═══════════════════════════════════════════════════════════════════
   Empty State (no selection)
   ═══════════════════════════════════════════════════════════════════ */

const EmptyState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 8,
      opacity: 0.4,
    }}
  >
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 9h6v6H9z" opacity="0.3" />
    </svg>
    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Select an object in the Scene hierarchy</span>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════
   Object Header (shared across all object types)
   ═══════════════════════════════════════════════════════════════════ */

const ObjectHeader: React.FC<{
  obj: THREE.Object3D;
  nodeType: string;
  typeLabel: string;
  typeColor: string;
}> = ({ obj, nodeType, typeLabel, typeColor }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
    borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)',
  }}>
    <TypeIcon type={nodeType} size={14} />
    <span style={{
      fontSize: 11, color: 'var(--text)', flex: 1, overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500,
    }}>
      {obj.name || obj.type}
    </span>
    <span style={{
      fontSize: 8, color: typeColor, background: 'var(--bg-input)',
      border: `1px solid ${typeColor}30`, borderRadius: 3,
      padding: '0 5px', lineHeight: '16px', textTransform: 'uppercase',
      fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.03em',
      flexShrink: 0,
    }}>
      {typeLabel}
    </span>
    <DeselectButton onClick={() => useSceneHierarchyStore.getState().select(null)} />
  </div>
);

/* ═══════════════════════════════════════════════════════════════════
   Transform Section (shared)
   ═══════════════════════════════════════════════════════════════════ */

const TransformSection: React.FC<{
  obj: THREE.Object3D;
  onChange: () => void;
}> = ({ obj, onChange }) => {
  const toDeg = THREE.MathUtils.radToDeg;
  const toRad = THREE.MathUtils.degToRad;

  const pos: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z];
  const rot: [number, number, number] = [toDeg(obj.rotation.x), toDeg(obj.rotation.y), toDeg(obj.rotation.z)];
  const scl: [number, number, number] = [obj.scale.x, obj.scale.y, obj.scale.z];

  const worldPos = new THREE.Vector3();
  obj.getWorldPosition(worldPos);

  return (
    <CollapsibleSection title="Transform" defaultOpen={true} icon={
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
        <path d="M8 1v14M1 8h14M4 4l8 8M12 4l-8 8" />
      </svg>
    }>
      <Vec3Input
        label="Location"
        values={pos}
        step={0.1}
        onChange={(idx, value) => {
          if (idx === 0) obj.position.x = value;
          if (idx === 1) obj.position.y = value;
          if (idx === 2) obj.position.z = value;
          onChange();
        }}
      />
      <Vec3Input
        label="Rotation"
        values={rot}
        step={1}
        onChange={(idx, value) => {
          const rad = toRad(value);
          if (idx === 0) obj.rotation.x = rad;
          if (idx === 1) obj.rotation.y = rad;
          if (idx === 2) obj.rotation.z = rad;
          onChange();
        }}
      />
      <Vec3Input
        label="Scale"
        values={scl}
        step={0.01}
        onChange={(idx, value) => {
          if (idx === 0) obj.scale.x = value;
          if (idx === 1) obj.scale.y = value;
          if (idx === 2) obj.scale.z = value;
          onChange();
        }}
      />
      <InfoRow
        label="World Position"
        value={`${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)}`}
        valueColor="var(--text-dim)"
      />
    </CollapsibleSection>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Mesh Properties
   ═══════════════════════════════════════════════════════════════════ */

const MeshProperties: React.FC<{
  obj: THREE.Mesh;
}> = ({ obj }) => {
  const [tick, setTick] = useState(0);
  const hiddenIds = useSceneHierarchyStore((s) => s.hiddenIds);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(interval);
  }, []);

  const isHidden = hiddenIds.includes(obj.uuid);
  void tick; // ensures tick usage for re-renders

  const handleVisibleToggle = () => {
    useSceneHierarchyStore.getState().toggleVisibility(obj.uuid);
    const newHidden = useSceneHierarchyStore.getState().hiddenIds.includes(obj.uuid);
    obj.visible = !newHidden;
    obj.traverse((c) => { c.visible = !newHidden; });
    setTick((n) => n + 1);
  };

  // Mesh info — defensive guards for missing geometry/material
  const geo = obj.geometry;
  let verts = 0;
  let tris = 0;
  let matNames = 'unnamed';
  let matType = '\u2014';
  let hasVertexColors = false;
  let hasUVs = false;
  let hasNormals = false;
  const size = new THREE.Vector3();

  try {
    if (geo && geo.attributes) {
      verts = geo.attributes.position ? geo.attributes.position.count : 0;
      tris = geo.index ? geo.index.count / 3 : verts / 3;
      hasVertexColors = !!geo.attributes.color;
      hasUVs = !!geo.attributes.uv;
      hasNormals = !!geo.attributes.normal;

      try { geo.computeBoundingBox(); } catch (_) { /* ignore */ }
      const bb = geo.boundingBox;
      if (bb) bb.getSize(size);
    }
    const mat = obj.material;
    if (mat) {
      const matArr = Array.isArray(mat) ? mat.filter(Boolean) : [mat];
      matNames = matArr.map((m) => m.name || 'unnamed').join(', ');
      matType = (matArr[0])?.type || '\u2014';
    }
  } catch (_) { /* use defaults */ }

  const childCount = obj.children.filter((c) => !c.userData.isGrid && !c.userData.isProxy).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ObjectHeader obj={obj} nodeType="mesh" typeLabel="Mesh" typeColor={TYPE_COLORS.mesh} />

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--border-light)' }}>
          <button
            onClick={handleVisibleToggle}
            style={{
              flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 3, cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${isHidden ? 'var(--border)' : 'rgba(74, 222, 128, 0.3)'}`,
              background: isHidden ? 'var(--bg-input)' : 'rgba(74, 222, 128, 0.1)',
              color: isHidden ? 'var(--text-dim)' : 'var(--success)',
            }}
          >
            {isHidden ? 'Hidden' : 'Visible'}
          </button>
        </div>

        {/* Transform */}
        <TransformSection obj={obj} onChange={() => setTick((n) => n + 1)} />

        {/* Object Info */}
        <CollapsibleSection title="Object Info" defaultOpen={true} icon={
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3.5M8 10.5v.5" />
          </svg>
        }>
          <InfoRow label="Type" value="Mesh" valueColor={TYPE_COLORS.mesh} />
          <InfoRow label="Children" value={String(childCount)} />
          <InfoRow label="UUID" value={`${obj.uuid.slice(0, 13)}...`} valueColor="var(--text-dim)" title={obj.uuid} />
        </CollapsibleSection>

        {/* Mesh Info */}
        <CollapsibleSection title="Mesh Info" defaultOpen={true} icon={
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
            <path d="M8 1.5L14.5 5v6L8 14.5 1.5 11V5z" />
          </svg>
        }>
          <InfoRow label="Vertices" value={verts.toLocaleString()} />
          <InfoRow label="Triangles" value={Math.floor(tris).toLocaleString()} />
          <InfoRow label="Size" value={`${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`} />
          <InfoRow label="Material" value={matNames} valueColor="var(--accent-bright)" title={matNames} />
          <InfoRow label="Mat. Type" value={matType.replace('Material', '')} />
          <InfoRow label="UVs" value={hasUVs ? 'Yes' : 'No'} valueColor={hasUVs ? 'var(--success)' : 'var(--text-dim)'} />
          <InfoRow label="Normals" value={hasNormals ? 'Yes' : 'No'} valueColor={hasNormals ? 'var(--success)' : 'var(--text-dim)'} />
          <InfoRow label="Vertex Colors" value={hasVertexColors ? 'Yes' : 'No'} valueColor={hasVertexColors ? 'var(--success)' : 'var(--text-dim)'} />
        </CollapsibleSection>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Generic Properties (Camera, Group, Helper, Other)
   ═══════════════════════════════════════════════════════════════════ */

const GenericProperties: React.FC<{
  obj: THREE.Object3D;
  nodeType: string;
}> = ({ obj, nodeType }) => {
  const [tick, setTick] = useState(0);
  const hiddenIds = useSceneHierarchyStore((s) => s.hiddenIds);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(interval);
  }, []);

  const isHidden = hiddenIds.includes(obj.uuid);
  void tick;

  const isColl = obj instanceof THREE.Group && !obj.userData.isGrid && !obj.userData.isProxy && obj.userData._isCollection === true;
  const typeLabel = isColl ? 'Collection' : nodeType;
  const typeColor = TYPE_COLORS[isColl ? 'collection' : nodeType] || 'var(--text-dim)';

  const handleVisibleToggle = () => {
    useSceneHierarchyStore.getState().toggleVisibility(obj.uuid);
    const newHidden = useSceneHierarchyStore.getState().hiddenIds.includes(obj.uuid);
    obj.visible = !newHidden;
    obj.traverse((c) => { c.visible = !newHidden; });
    setTick((n) => n + 1);
  };

  const childCount = obj.children.filter((c) => !c.userData.isGrid && !c.userData.isProxy).length;

  // Camera-specific info
  let cameraInfo: React.ReactNode = null;
  if (obj instanceof THREE.PerspectiveCamera) {
    cameraInfo = (
      <CollapsibleSection title="Camera Info" defaultOpen={true} icon={
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
          <rect x="2" y="5" width="12" height="8" rx="1.5" />
          <path d="M5.5 5L6.5 3h3l1 2" />
        </svg>
      }>
        <InfoRow label="FOV" value={`${obj.fov.toFixed(1)}deg`} />
        <InfoRow label="Near" value={obj.near.toFixed(3)} />
        <InfoRow label="Far" value={obj.far.toFixed(1)} />
      </CollapsibleSection>
    );
  } else if (obj instanceof THREE.OrthographicCamera) {
    cameraInfo = (
      <CollapsibleSection title="Camera Info" defaultOpen={true} icon={
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
          <rect x="2" y="5" width="12" height="8" rx="1.5" />
          <path d="M5.5 5L6.5 3h3l1 2" />
        </svg>
      }>
        <InfoRow label="Type" value="Orthographic" />
        <InfoRow label="Near" value={obj.near.toFixed(3)} />
        <InfoRow label="Far" value={obj.far.toFixed(1)} />
      </CollapsibleSection>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ObjectHeader obj={obj} nodeType={nodeType} typeLabel={typeLabel} typeColor={typeColor} />

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--border-light)' }}>
          <button
            onClick={handleVisibleToggle}
            style={{
              flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 3, cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${isHidden ? 'var(--border)' : 'rgba(74, 222, 128, 0.3)'}`,
              background: isHidden ? 'var(--bg-input)' : 'rgba(74, 222, 128, 0.1)',
              color: isHidden ? 'var(--text-dim)' : 'var(--success)',
            }}
          >
            {isHidden ? 'Hidden' : 'Visible'}
          </button>
        </div>

        {/* Transform */}
        <TransformSection obj={obj} onChange={() => setTick((n) => n + 1)} />

        {/* Object Info */}
        <CollapsibleSection title="Object Info" defaultOpen={true} icon={
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3.5M8 10.5v.5" />
          </svg>
        }>
          <InfoRow label="Type" value={typeLabel} valueColor={typeColor} />
          <InfoRow label="Children" value={String(childCount)} />
          <InfoRow label="UUID" value={`${obj.uuid.slice(0, 13)}...`} valueColor="var(--text-dim)" title={obj.uuid} />
        </CollapsibleSection>

        {cameraInfo}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Main: DynamicPropertiesPanel
   ═══════════════════════════════════════════════════════════════════ */

interface DynamicPropertiesPanelProps {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}

export const DynamicPropertiesPanel: React.FC<DynamicPropertiesPanelProps> = ({ sceneRef }) => {
  const selectedId = useSceneHierarchyStore((s) => s.selectedId);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const selectedShapeId = useHDRIShapesStore((s) => s.selectedShapeId);
  const selectedHDRIAssetId = useHDRIAssetStore((s) => s.selectedAssetId);
  const selectLight = useLightsStore((s) => s.selectLight);
  const setRightPanelTab = useUIStore((s) => s.setRightPanelTab);
  const showPanel = useUIStore((s) => s.showPanel);

  // Find the selected Three.js object from the scene
  const selectedObj = useMemo(() => {
    try {
      if (!selectedId || !sceneRef.current) return null;
      return findObjectByUuid(sceneRef.current, selectedId);
    } catch (_) {
      return null;
    }
  }, [selectedId, sceneRef.current]);

  const nodeType = useMemo(() => {
    try {
      if (!selectedObj) return null;
      return getNodeType(selectedObj);
    } catch (_) {
      return 'other';
    }
  }, [selectedObj]);

  // Bridge: when a light is selected in hierarchy, sync lightsStore.selectedLightId
  // Also auto-switch to Properties tab
  useEffect(() => {
    try {
      if (!selectedObj || nodeType !== 'light') return;
      const lightId = selectedObj.userData.lightId as string | undefined;
      if (lightId) {
        selectLight(lightId);
      }
      setRightPanelTab('properties');
      showPanel('rightPanel');
    } catch (_) { /* ignore sync errors */ }
  }, [selectedId, nodeType, selectedObj, selectLight, setRightPanelTab, showPanel]);

  // Auto-switch to Properties tab when any non-light object is selected
  useEffect(() => {
    try {
      if (!selectedId || !nodeType) return;
      if (nodeType !== 'light') {
        setRightPanelTab('properties');
        showPanel('rightPanel');
      }
    } catch (_) { /* ignore */ }
  }, [selectedId]);

  // ── Render Logic ──
  try {
  // Priority 1: Hierarchy has a selection -> route by object type
  if (selectedObj && nodeType) {
    if (nodeType === 'light') {
      return (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <LightProperties />
        </div>
      );
    }

    if (nodeType === 'mesh') {
      return (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <MeshProperties obj={selectedObj as THREE.Mesh} />
        </div>
      );
    }

    // Camera, Group, Helper, Other
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <GenericProperties obj={selectedObj} nodeType={nodeType} />
      </div>
    );
  }

  // Priority 2: No hierarchy selection, but a light is selected via Light List panel
  if (selectedLightId) {
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <LightProperties />
      </div>
    );
  }

  // Priority 3: No hierarchy/light selection, but an HDRI Shape is selected
  // via the Light List panel - shapes have no Object3D in the scene graph,
  // so they never reach Priority 1's hierarchy branch.
  if (selectedShapeId) {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <HDRIShapeProperties />
      </div>
    );
  }

  // Priority 4: No hierarchy/light/shape selection, but a Custom HDRI is
  // selected via the Light List panel.
  if (selectedHDRIAssetId) {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <CustomHDRIProperties />
      </div>
    );
  }

  // No selection at all
  return <EmptyState />;
  } catch (err) {
    // Last resort: if anything in the render logic throws, show empty state
    console.error('[DynamicPropertiesPanel] Render error:', err);
    return <EmptyState />;
  }
};