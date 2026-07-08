import React, { createContext, useContext, type ReactNode, useRef, useMemo } from 'react';
import {
  SceneManager,
  RenderPipeline,
  LightManager,
  ModelLoader,
} from '../three/engine';

interface ThreeSceneContextValue {
  sceneManager: React.MutableRefObject<SceneManager | null>;
  renderPipeline: React.MutableRefObject<RenderPipeline | null>;
  lightManager: React.MutableRefObject<LightManager | null>;
  modelLoader: React.MutableRefObject<ModelLoader | null>;
}

const ThreeSceneContext = createContext<ThreeSceneContextValue | null>(null);

interface ThreeSceneProviderProps {
  children: ReactNode;
}

export function ThreeSceneProvider({ children }: ThreeSceneProviderProps) {
  const sceneManager = useRef<SceneManager | null>(null);
  const renderPipeline = useRef<RenderPipeline | null>(null);
  const lightManager = useRef<LightManager | null>(null);
  const modelLoader = useRef<ModelLoader | null>(null);

  const value = useMemo<ThreeSceneContextValue>(
    () => ({ sceneManager, renderPipeline, lightManager, modelLoader }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <ThreeSceneContext.Provider value={value}>
      {children}
    </ThreeSceneContext.Provider>
  );
}

export function useThreeScene(): ThreeSceneContextValue {
  const ctx = useContext(ThreeSceneContext);
  if (!ctx) {
    throw new Error('useThreeScene must be used within a ThreeSceneProvider');
  }
  return ctx;
}