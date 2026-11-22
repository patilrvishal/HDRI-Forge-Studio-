import React, { useEffect } from 'react';
import * as THREE from 'three';
import { useMaterialOverrideStore } from '../../store/materialOverrideStore';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import { useSceneHierarchyStore } from '../../store/sceneHierarchyStore';
import { applyMaterialOverride } from '../../three/materialOverride';
import { NEW_SCENE_EVENT } from '../../utils/newScene';

/**
 * Keeps the temporary Material Override in step with its settings. Always mounted (the panel that edits it may be closed), and
 * renders nothing. A new scene or model switches the override off so nothing stale is left on the next model.
 */
export const MaterialOverrideController: React.FC<{ sceneRef: React.MutableRefObject<THREE.Scene | null> }> = ({ sceneRef }) => {
  const o = useMaterialOverrideStore();
  const selectedId = useSceneHierarchyStore((s) => s.selectedId);
  const materials = useMaterialEditorStore((s) => s.materials);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    applyMaterialOverride(scene, o.enabled, { color: o.color, metalness: o.metalness, roughness: o.roughness, clearcoat: o.clearcoat }, o.scope === 'selected' ? selectedId : null);
  }, [sceneRef, o.enabled, o.color, o.metalness, o.roughness, o.clearcoat, o.scope, selectedId, materials]);

  useEffect(() => {
    const off = () => {
      const scene = sceneRef.current;
      if (scene) applyMaterialOverride(scene, false, { color: '#fff', metalness: 0, roughness: 1, clearcoat: 0 }, null);
      useMaterialOverrideStore.getState().reset();
    };
    window.addEventListener(NEW_SCENE_EVENT, off);
    return () => window.removeEventListener(NEW_SCENE_EVENT, off);
  }, [sceneRef]);

  return null;
};
