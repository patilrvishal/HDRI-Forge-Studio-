import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { useAnimationStore } from '../../store/animationStore';
import { ThreeSceneProvider } from '../../hooks/useThreeScene';
import { SceneManager, RenderPipeline, LightManager, ModelLoader } from '../../three/engine';
import { ErikLoader } from '../../three/ErikLoader';
import { animationEngine, AnimationEngine } from '../../three/AnimationEngine';
import { EnvironmentLoader } from '../../three/EnvironmentLoader';
import { getHDRIPresetById } from '../../types/Environment';
import { base64ToArrayBuffer } from '../../store/modelDataStore';
import { hdriBase64ToArrayBuffer, setRawHDRIData } from '../../store/hdriDataStore';
import { ViewportToolbar } from './ViewportToolbar';
import { GizmoToolbar } from './GizmoToolbar';
import { useCameraStore } from '../../store/cameraStore';
import { CameraSwitcher } from './CameraSwitcher';
import { ViewportPropertiesPanel } from './ViewportPropertiesPanel';
import { CameraPanel } from './CameraPanel';
import { GizmoManager, type GizmoMode } from '../../three/GizmoManager';
import { solveLightPaint, smoothNormalAt, computeLightDistance, type PaintMode } from '../../three/LightPaint';
import { cartesianToSpherical } from '../../utils/math';
import { CameraBookmarks } from './CameraBookmarks';
import type { AnimatedProperty } from '../../types/Animation';
import { MaterialManager } from '../../three/MaterialManager';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import { useUIStore } from '../../store/uiStore';
import { useHDRIShapesStore } from '../../store/hdriShapesStore';
import { compositeShapesCanvas } from '../../three/HDRIShapesLayer';

interface ViewportProps {
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
  onScreenshot: (dataUrl: string) => void;
  onReady?: (renderPipeline: RenderPipeline | null, materialManager: MaterialManager | null) => void;
}

export const Viewport: React.FC<ViewportProps> = ({ sceneManagerRef, onScreenshot, onReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);
  const lightManagerRef = useRef<LightManager | null>(null);
  const modelLoaderRef = useRef<ModelLoader | null>(null);
  const erikLoaderRef = useRef<ErikLoader | null>(null);
  const envLoaderRef = useRef<EnvironmentLoader | null>(null);
  const materialManagerRef = useRef<MaterialManager | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animAccumulatorRef = useRef(0);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Store selectors
  const showGrid = useSceneStore((s) => s.showGrid);
  const turntable = useSceneStore((s) => s.turntable);
  const environment = useSceneStore((s) => s.environment);
  const hdriShapes = useHDRIShapesStore((s) => s.shapes);
  const hdriLivePreview = useHDRIShapesStore((s) => s.livePreview);
  const hdriSelectedShapeId = useHDRIShapesStore((s) => s.selectedShapeId);
  const updateHDRIShape = useHDRIShapesStore((s) => s.updateShape);
  const renderSettings = useSceneStore((s) => s.renderSettings);
  const setModel = useSceneStore((s) => s.setModel);
  const setExposure = useSceneStore((s) => s.setExposure);
  const setBloom = useSceneStore((s) => s.setBloom);
  const pendingModelData = useSceneStore((s) => s._pendingModelDataBase64);
  const pendingModelFileName = useSceneStore((s) => s._pendingModelFileName);
  const pendingModelSkipFit = useSceneStore((s) => s._pendingModelSkipFit);
  const clearPendingModelData = useSceneStore((s) => s.clearPendingModelData);
  const pendingHDRIData = useSceneStore((s) => s._pendingHDRIDataBase64);
  const clearPendingHDRIData = useSceneStore((s) => s.clearPendingHDRIData);
  const backplate = useSceneStore((s) => s.environment.backplate);
  const backplateOpacity = useSceneStore((s) => s.environment.backplateOpacity);

  const lights = useLightsStore((s) => s.lights);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const updateLight = useLightsStore((s) => s.updateLight);

  // Animation store selectors (non-reactive - read inside the loop via getState)
  // We only use isPlaying for the dependency to know if animation is active

  // Initialize the 3D scene on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const sceneManager = new SceneManager();
    sceneManagerRef.current = sceneManager;
    // Expose camera store so engine.applyActiveCamera() can read it each frame
    // without creating a circular import between engine.ts and the store.
    (window as unknown as { __cameraStore?: unknown }).__cameraStore = useCameraStore;
    // Expose the scene globally so panels outside ThreeSceneProvider
    // (e.g. the bottom HDRI preview dock) can reach it.
    (window as unknown as { __lightforgeScene?: unknown }).__lightforgeScene = sceneManager;
    sceneManager.attach(containerRef.current);

    const lightManager = new LightManager(sceneManager.scene);
    lightManagerRef.current = lightManager;

    const modelLoader = new ModelLoader(sceneManager.scene);
    modelLoaderRef.current = modelLoader;

    const erikLoader = new ErikLoader(sceneManager.scene, sceneManager.renderer);
    erikLoaderRef.current = erikLoader;

    // Material Manager
    const materialManager = new MaterialManager();
    materialManagerRef.current = materialManager;

    // Phase 9: Environment loader
    const envLoader = new EnvironmentLoader();
    envLoaderRef.current = envLoader;

    // Shared onLoaded handler for both the GLB and .erik import paths - both
    // produce a THREE.Group of standard materials, so the rest of the app
    // (material editor, outliner, etc.) doesn't need to know which loader ran.
    const handleModelLoaded = (name: string, getModel: () => THREE.Group | null) => {
      setIsLoading(false);
      setLoadProgress(100);
      setModel('', name);

      setTimeout(() => {
        const model = getModel();
        if (model && materialManager) {
          const savedMaterials = useMaterialEditorStore.getState().materials;
          const hasSavedStates = savedMaterials.length > 0;

          const matStates = materialManager.extractMaterials(model);

          if (hasSavedStates) {
            const merged = matStates.map((extracted) => {
              const saved = savedMaterials.find((s) => s.name === extracted.name);
              if (saved) {
                return { ...extracted, ...saved, id: extracted.id };
              }
              return extracted;
            });
            useMaterialEditorStore.getState().setMaterials(merged);

            requestAnimationFrame(() => {
              materialManager.rebuildMaterialMap(sceneManager.scene, merged);
              for (const state of merged) {
                materialManager.applyMaterialState(state, sceneManager.scene);
              }
            });
          } else {
            useMaterialEditorStore.getState().setMaterials(matStates);
            requestAnimationFrame(() => {
              materialManager.rebuildMaterialMap(sceneManager.scene, matStates);
            });
          }
        }
      }, 100);

      setTimeout(() => setLoadProgress(0), 1000);
    };

    const handleModelError = (err: string) => {
      setIsLoading(false);
      setLoadProgress(0);
      setLoadError(err);
      setTimeout(() => setLoadError(null), 4000);
    };

    modelLoader.setCallbacks({
      onProgress: (p) => setLoadProgress(p),
      onLoaded: (name) => handleModelLoaded(name, () => modelLoader.getCurrentModel?.() ?? null),
      onError: handleModelError,
    });

    erikLoader.setCallbacks({
      onProgress: (p) => setLoadProgress(p),
      onLoaded: (name) => handleModelLoaded(name, () => erikLoader.getCurrentModel()),
      onError: handleModelError,
    });

    sceneManager.setGrid(true);

    const renderPipeline = new RenderPipeline(sceneManager);
    renderPipelineRef.current = renderPipeline;
    renderPipeline.build();

    // Phase 9: Apply default environment preset
    const defaultPreset = getHDRIPresetById(useSceneStore.getState().environment.presetId);
    if (defaultPreset && defaultPreset.id !== 'none') {
      const envTexture = envLoader.generateFromPreset(defaultPreset, sceneManager.pmremGenerator, useSceneStore.getState().environment.rotation);
      envLoader.setEnvironmentTexture(sceneManager.scene, envTexture, useSceneStore.getState().environment.intensity);
    }

    // Apply the default gradient background on init. The reactive effect that
    // normally handles this only fires when gradientBackground *changes*, so a
    // default-enabled gradient would otherwise never be applied on first load.
    const gb0 = useSceneStore.getState().environment.gradientBackground;
    if (gb0?.enabled) {
      sceneManager.setGradientBackground(gb0);
    }

    // Notify parent that the render pipeline is ready (for export)
    onReady?.(renderPipeline, materialManager);

    // ------ Animation frame accumulator & tick callback ---------------------------------------------------------------
    const clock = new THREE.Clock();
    animAccumulatorRef.current = 0;

    const loop = () => {
      const delta = clock.getDelta();

      // ------ Animation tick (frame-accurate playback) ------------------------------------------------------------------
      const animState = useAnimationStore.getState();
      if (animState.isPlaying && animState.tracks.length > 0) {
        animAccumulatorRef.current += delta;
        const frameDuration = 1 / animState.fps;

        while (animAccumulatorRef.current >= frameDuration) {
          animAccumulatorRef.current -= frameDuration;
          const wrapped = animState.tick();

          // Evaluate animation at the new frame
          const evaluated = animationEngine.evaluate(animState.tracks, animState.currentFrame);

          // Apply evaluated values to stores
          if (evaluated.values.size > 0) {
            AnimationEngine.applyToScene(evaluated, {
              updateLightProperty: (lightId: string, property: string, value: number) => {
                const prop = property as AnimatedProperty;
                const currentLight = useLightsStore.getState().lights.find((l) => l.id === lightId);
                if (!currentLight) return;
                const t = currentLight.transform;
                switch (prop) {
                  case 'light.brightness':
                    updateLight(lightId, { brightness: value });
                    break;
                  case 'light.positionX':
                    updateLight(lightId, { transform: { ...t, position: { ...t.position, x: value } } });
                    break;
                  case 'light.positionY':
                    updateLight(lightId, { transform: { ...t, position: { ...t.position, y: value } } });
                    break;
                  case 'light.positionZ':
                    updateLight(lightId, { transform: { ...t, position: { ...t.position, z: value } } });
                    break;
                  case 'light.rotationX':
                    updateLight(lightId, { transform: { ...t, rotation: { ...t.rotation, x: value, enabled: true } } });
                    break;
                  case 'light.rotationY':
                    updateLight(lightId, { transform: { ...t, rotation: { ...t.rotation, y: value, enabled: true } } });
                    break;
                  case 'light.rotationZ':
                    updateLight(lightId, { transform: { ...t, rotation: { ...t.rotation, z: value, enabled: true } } });
                    break;
                }
              },
              updateCameraProperty: (_property: string, _value: number) => {
                // Camera animation applied to SceneManager directly
                const cam = sceneManager.camera;
                const prop = _property as AnimatedProperty;
                switch (prop) {
                  case 'camera.positionX':
                    cam.position.x = _value;
                    break;
                  case 'camera.positionY':
                    cam.position.y = _value;
                    break;
                  case 'camera.positionZ':
                    cam.position.z = _value;
                    break;
                  case 'camera.fov':
                    cam.fov = _value;
                    cam.updateProjectionMatrix();
                    break;
                  default:
                    break;
                }
                sceneManager.controls.update();
              },
              updateTurntableProperty: (property: string, value: number) => {
                if (property === 'turntable.speed') {
                  sceneManager._turntableSpeed = value;
                } else if (property === 'turntable.rotation') {
                  const model = sceneManager._findModel();
                  if (model) {
                    model.rotation.y = (value * Math.PI) / 180;
                  }
                }
              },
              updateRenderProperty: (property: string, value: number) => {
                if (property === 'render.exposure') {
                  setExposure(value);
                } else if (property === 'render.bloomIntensity') {
                  setBloom({ intensity: value });
                }
              },
            }, animState.tracks);
          }
        }
      } else {
        // Reset accumulator when not playing
        animAccumulatorRef.current = 0;
      }

      // ------ Turntable (non-animated, manual rotation) ---------------------------------------------------------------
      if (sceneManager._turntableActive) {
        const model = sceneManager._findModel();
        if (model) model.rotation.y += delta * sceneManager._turntableSpeed * 0.5;
      }

      // ------ Update CubeCamera for PBR floor reflections ---------------------------------------------------------
      if (sceneManager._floorCubeCamera && sceneManager.ground && sceneManager._groundSettings?.reflections) {
        try {
          sceneManager.ground.visible = false;
          sceneManager._floorCubeCamera.update(sceneManager.renderer, sceneManager.scene);
          sceneManager.ground.visible = true;
        } catch (e) {
          sceneManager.ground.visible = true;
          console.warn('[LightForge] CubeCamera update failed, disabling reflections:', e);
          if (sceneManager._floorCubeCamera) {
            sceneManager.scene.remove(sceneManager._floorCubeCamera);
            sceneManager._floorCubeCamera.dispose();
            sceneManager._floorCubeCamera = null;
          }
        }
      }

      sceneManager.controls.update();
      try {
        renderPipeline.render();
      } catch (e) {
        console.error('[LightForge] Render failed, falling back to direct render:', e);
        sceneManager.renderer.render(sceneManager.scene, sceneManager.camera);
      }
      sceneManager._animationId = requestAnimationFrame(loop);
    };
    sceneManager._animationId = requestAnimationFrame(loop);

    // Set up resize observer
    const observer = new ResizeObserver(() => {
      sceneManager.resize();
      renderPipeline.resize();
    });
    observer.observe(containerRef.current);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      sceneManager.stopRenderLoop();
      renderPipeline.dispose();
      modelLoader.dispose();
      erikLoader.dispose();
      lightManager.dispose();
      envLoader.dispose();
      materialManager.dispose();
      sceneManager.dispose();
      sceneManagerRef.current = null;
      renderPipelineRef.current = null;
      lightManagerRef.current = null;
      modelLoaderRef.current = null;
      erikLoaderRef.current = null;
      envLoaderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync grid visibility
  useEffect(() => {
    sceneManagerRef.current?.setGrid(showGrid);
  }, [showGrid, sceneManagerRef]);

  // Backplate: render as scene.background when set
  const backplateTextureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;

    if (backplate) {
      // Load backplate as texture for background
      if (backplateTextureRef.current) {
        backplateTextureRef.current.dispose();
        backplateTextureRef.current = null;
      }
      const loader = new THREE.TextureLoader();
      loader.load(backplate, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        backplateTextureRef.current = tex;
        if (backplateOpacity >= 0.99) {
          sm.scene.background = tex;
        }
      });
    } else {
      if (backplateTextureRef.current) {
        backplateTextureRef.current.dispose();
        backplateTextureRef.current = null;
      }
      // Restore normal background behavior
      sm.setBackground(
        useSceneStore.getState().environment.background,
        useSceneStore.getState().environment.showBackground,
      );
    }

    return () => {
      if (backplateTextureRef.current) {
        backplateTextureRef.current.dispose();
        backplateTextureRef.current = null;
      }
    };
  }, [backplate, backplateOpacity, sceneManagerRef]);

  // Sync environment background (only when no backplate and no custom HDRI backplate)
  useEffect(() => {
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || backplate) return; // Skip if backplate is active

    // Gradient background takes priority over the flat colour / limbo
    // default for what's VISIBLE behind the subject, AND now also owns the
    // reflection/lighting environment while it's shown - previously only
    // the backdrop switched to the gradient while a real HDRI's reflections
    // kept showing untouched, which read as broken (the object looked like
    // it belonged to a different scene than its own backdrop). Toggling
    // back off restores the real HDRI's own environment map via
    // el.getCurrentEnvTexture() below, which is untouched by the bake here
    // - it goes through the public setEnvironmentTexture (scene.environment
    // only) rather than the private setEnvironmentTextureDirect that owns
    // that cached reference (see loadHDRI/generateFromPreset).
    if (environment.gradientBackground?.enabled) {
      sm.setGradientBackground(environment.gradientBackground);

      // createGradientBackground() already sets EquirectangularReflection-
      // Mapping on this texture (so it displays as a proper spherical sky
      // dome behind the subject, matching HDRI Preview's equirect render,
      // and can be fed straight into pmremGenerator for reflections) - that
      // mapping must be left in place afterward, not reset to UVMapping, or
      // the dome collapses back to a flat image the instant this effect
      // re-runs.
      if (el && sm.scene.background && 'mapping' in sm.scene.background) {
        const gradTex = sm.scene.background as THREE.Texture;
        const envMap = sm.pmremGenerator.fromEquirectangular(gradTex).texture;
        el.setEnvironmentTexture(sm.scene, envMap, environment.intensity);
      }
      return;
    }

    // Gradient disabled - restore whichever real environment (custom HDRI
    // or built-in preset) was actually loaded, in case reflections are
    // still showing the gradient bake from above.
    if (el) {
      const realEnv = el.getCurrentEnvTexture();
      if (realEnv) el.setEnvironmentTexture(sm.scene, realEnv, environment.intensity);
    }

    // If a custom HDRI is loaded, let it manage the background via setBackgroundFromEnv
    if (environment.presetId === '__custom__' && el?.getEquirectTexture()) {
      el.setBackgroundFromEnv(sm.scene, environment.showBackground);
      return;
    }

    sm.setBackground(environment.background, environment.showBackground);
  }, [environment.background, environment.showBackground, environment.presetId, environment.gradientBackground, environment.intensity, sceneManagerRef, envLoaderRef, backplate]);

  // Sync ground settings (reflections, fade, color, PBR)
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;
    try {
      sm.updateGround(renderSettings.ground);
    } catch (e) {
      console.error('[LightForge] Failed to update ground:', e);
    }
  }, [renderSettings.ground, sceneManagerRef]);

  // Phase 9: Sync environment preset to 3D scene (built-in presets only)
  useEffect(() => {
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || !el) return;

    // Skip custom HDRI - handled by the separate effect below
    if (environment.presetId === '__custom__') return;

    // Built-in presets: clear any custom equirect, no 360deg background.
    // Skip the background clear when a gradient background owns the scene bg.
    el.clearEquirectTexture();
    if (!environment.gradientBackground?.enabled) {
      el.setBackgroundFromEnv(sm.scene, false);
    }

    // Built-in presets bake rotation into the generated scene, so the
    // native scene rotation must be reset to avoid double-rotating.
    sm.scene.environmentRotation = new THREE.Euler(0, 0, 0);
    sm.scene.backgroundRotation = new THREE.Euler(0, 0, 0);

    try {
      const preset = getHDRIPresetById(environment.presetId);
      if (!preset) return;

      const envTexture = el.generateFromPreset(preset, sm.pmremGenerator, environment.rotation);
      el.setEnvironmentTexture(sm.scene, envTexture, environment.intensity);
    } catch (e) {
      console.error('[LightForge] Failed to sync environment preset:', e);
    }
  }, [environment.presetId, environment.rotation, environment.intensity, sceneManagerRef, envLoaderRef]);

  // Phase 9: Load custom HDRI file into the 3D scene
  // NOTE: intensity is deliberately NOT a dependency - it is applied by the
  // effect below without reloading. Reloading on every slider tick was making
  // the HDRI vanish mid-drag.
  useEffect(() => {
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || !el) return;

    if (environment.presetId === '__custom__' && environment.hdri) {
      el.loadHDRI(environment.hdri, sm.pmremGenerator)
        .then((envTexture) => {
          el.setEnvironmentTexture(sm.scene, envTexture, environment.intensity);

          // Rotate the HDRI natively (equirect textures are not re-baked)
          const rad = (environment.rotation * Math.PI) / 180;
          sm.scene.environmentRotation = new THREE.Euler(0, rad, 0);
          sm.scene.backgroundRotation = new THREE.Euler(0, rad, 0);

          // Show the HDRI as a 360deg backplate in the viewport
          el.setBackgroundFromEnv(sm.scene, environment.showBackground);
        })
        .catch((e) => {
          // Do NOT fall back to a built-in preset - that silently replaces the
          // user's custom HDRI with studio-neutral.
          console.error('[LightForge] Custom HDRI load failed:', e);
        });
    } else if (environment.presetId !== '__custom__') {
      // Not custom - clear any HDRI backplate, unless a gradient owns the bg
      if (!environment.gradientBackground?.enabled) {
        el.setBackgroundFromEnv(sm.scene, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    environment.presetId,
    environment.hdri,
    environment.rotation,
    environment.showBackground,
    sceneManagerRef,
    envLoaderRef,
  ]);

  // Apply environment intensity WITHOUT reloading the texture.
  // scene.backgroundIntensity is NOT run through renderer.toneMappingExposure
  // by three.js (only lit materials are), so View Exposure is folded in here
  // to keep the background plate's brightness in sync with the HDRI preview.
  // The preview panel tonemaps with Reinhard + gamma 2.2 (see HDRIPreviewPanel's
  // tonemapToImageData), which reads much brighter than a raw linear multiply at
  // the same exposure value - gamma-correcting the multiplier here approximates
  // that curve so the two stay visually close instead of the viewport crushing
  // to black far faster than the preview dims.
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;
    sm.scene.environmentIntensity = environment.intensity;
    const gammaCorrectedExposure = Math.pow(Math.max(renderSettings.exposure, 0.0001), 1 / 2.2);
    sm.scene.backgroundIntensity = environment.intensity * gammaCorrectedExposure;
  }, [environment.intensity, renderSettings.exposure, sceneManagerRef]);

  // Sync HDRI Shapes onto the live 3D viewport when Live Preview is on -
  // but ONLY when there's no real HDRI/preset actually loaded.
  //
  // compositeShapesCanvas() paints shapes onto a flat gradient-or-near-black
  // base - it has no way to include a real loaded HDRI's own pixels (those
  // are a separate float/HDR texture, not something a 2D canvas can draw),
  // so using it as the WHOLE new environment/background here was silently
  // discarding whatever custom HDRI or preset was active the moment any
  // shape existed with Live Preview on - the car (and everything else)
  // would go dark/matte and the backdrop would collapse to just the shape
  // on a near-black field, which read as the scene getting "isolated" down
  // to only that one shape instead of shapes layering on top of it.
  //
  // Shapes still work correctly as an overlay in the HDRI Preview panel and
  // the exported file (HDRIExporter/HDRIPreviewPanel push them as an
  // ADDITIONAL EnvLayer alongside the real HDRI's own layer, not a
  // replacement) - this effect now only takes over the live 3D viewport
  // when building a synthetic environment from scratch (no real HDRI to
  // preserve), matching how Gradient Background already behaves.
  useEffect(() => {
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || !el) return;
    if (!hdriLivePreview || hdriShapes.length === 0) return;
    const hasRealEnvironment = environment.presetId !== 'none' && environment.presetId !== 'none ';
    if (hasRealEnvironment) return;

    const gb = environment.gradientBackground?.enabled ? environment.gradientBackground : null;
    const canvas = compositeShapesCanvas(hdriShapes, gb);
    const canvasTex = new THREE.CanvasTexture(canvas);
    canvasTex.mapping = THREE.EquirectangularReflectionMapping;
    canvasTex.needsUpdate = true;

    const envMap = sm.pmremGenerator.fromEquirectangular(canvasTex).texture;
    el.setEnvironmentTexture(sm.scene, envMap, environment.intensity);
    sm.scene.background = canvasTex;
    sm.scene.backgroundRotation = new THREE.Euler(0, 0, 0);
    sm.scene.environmentRotation = new THREE.Euler(0, 0, 0);
  }, [hdriShapes, hdriLivePreview, environment.gradientBackground, environment.intensity, environment.presetId, sceneManagerRef, envLoaderRef]);

  // Restore model from scene file (triggered when _pendingModelDataBase64 is set)
  useEffect(() => {
    if (!pendingModelData) return;
    const ml = modelLoaderRef.current;
    if (!ml) return;

    setIsLoading(true);
    setLoadError(null);
    setLoadProgress(0);

    try {
      const arrayBuffer = base64ToArrayBuffer(pendingModelData);
      ml.loadFromBuffer(arrayBuffer, pendingModelFileName, { skipCenterAndScale: pendingModelSkipFit });
    } catch {
      setLoadError('Failed to restore model from scene file');
      setIsLoading(false);
    }

    clearPendingModelData();
  }, [pendingModelData, pendingModelFileName, pendingModelSkipFit, modelLoaderRef, clearPendingModelData]);

  // Restore custom HDRI from scene file
  useEffect(() => {
    if (!pendingHDRIData) return;
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || !el) return;

    try {
      const arrayBuffer = hdriBase64ToArrayBuffer(pendingHDRIData);
      setRawHDRIData(arrayBuffer, 'custom.hdr');
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      el.loadHDRI(url, sm.pmremGenerator)
        .then((envTexture) => {
          const envState = useSceneStore.getState().environment;
          el.setEnvironmentTexture(sm.scene, envTexture, envState.intensity);
          // Restore 360deg HDRI backplate - always show when custom HDRI is loaded
          if (!envState.showBackground) {
            useSceneStore.getState().setEnvironment({ showBackground: true });
          }
          el.setBackgroundFromEnv(sm.scene, true);
        })
        .catch(() => {
          // Fallback to neutral studio
          const fallback = getHDRIPresetById('studio-neutral');
          if (fallback) {
            const tex = el.generateFromPreset(fallback, sm.pmremGenerator, 0);
            el.setEnvironmentTexture(sm.scene, tex, 1);
          }
        });
    } catch {
      // ignore
    }

    clearPendingHDRIData();
  }, [pendingHDRIData, sceneManagerRef, envLoaderRef, clearPendingHDRIData]);

  // Sync render settings
  useEffect(() => {
    const rp = renderPipelineRef.current;
    if (!rp) return;
    try {
      rp.setEngine(renderSettings.engine);
      rp.setToneMapping(renderSettings.tonemapping);
      rp.setExposure(renderSettings.exposure);
      rp.setQuality(renderSettings.quality);
      rp.setShadowQuality(renderSettings.shadowQuality);
      rp.setBloom(
        renderSettings.bloom.enabled,
        renderSettings.bloom.intensity,
        renderSettings.bloom.threshold,
        renderSettings.bloom.radius
      );
      rp.setAO(
        renderSettings.ao.enabled,
        renderSettings.ao.radius,
        renderSettings.ao.intensity
      );
      rp.setAntialiasing(renderSettings.antialiasing);
      rp.setVignette(
        renderSettings.vignette.enabled,
        renderSettings.vignette.intensity
      );
      rp.setColorGrading(
        renderSettings.colorGrading.enabled,
        renderSettings.colorGrading.brightness,
        renderSettings.colorGrading.contrast,
        renderSettings.colorGrading.saturation
      );
    } catch (e) {
      console.error('[LightForge] Failed to sync render settings:', e);
    }
  }, [renderSettings, renderPipelineRef]);

  // -- Transform gizmo --------------------------------------------------------
  const gizmoRef = useRef<GizmoManager | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>(null);

  const selectedLight = lights.find((l) => l.id === selectedLightId) ?? null;
  const scaleAllowed = selectedLight?.type === 'area' || selectedLight?.type === 'overhead';

  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm || gizmoRef.current) return;

    gizmoRef.current = new GizmoManager(
      sm.camera,
      sm.renderer.domElement,
      sm.scene,
      sm.controls,
      {
        onTransform: (lightId, data) => {
          const st = useLightsStore.getState();
          const l = st.lights.find((x) => x.id === lightId);
          if (!l) return;

          // Push cartesian back AND recompute spherical, so the properties
          // panel sliders stay in step with what the gizmo just did.
          const sph = cartesianToSpherical(data.position.x, data.position.y, data.position.z);
          st.updateLightTransform(lightId, {
            position: data.position,
            spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height },
            rotation: {
              ...l.transform.rotation,
              x: data.rotation.x,
              y: data.rotation.y,
              z: data.rotation.z,
              enabled: true,
            },
          });

          if (l.type === 'area' || l.type === 'overhead') {
            st.updateLight(lightId, {
              areaWidth: Math.max(0.1, (l.areaWidth ?? 2) * data.scale.x),
              areaHeight: Math.max(0.1, (l.areaHeight ?? 2) * data.scale.y),
            });
          }
        },
      },
    );

    return () => {
      gizmoRef.current?.dispose();
      gizmoRef.current = null;
    };
  }, [sceneManagerRef]);

  useEffect(() => {
    gizmoRef.current?.setMode(gizmoMode);
    gizmoRef.current?.attachToLight(selectedLightId);
  }, [gizmoMode, selectedLightId, lights]);

  useEffect(() => {
    gizmoRef.current?.setScaleAllowed(scaleAllowed);
    if (!scaleAllowed && gizmoMode === 'scale') setGizmoMode('translate');
  }, [scaleAllowed, gizmoMode]);

  // W / E / R -- same bindings as Blender and Unity
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'w' || e.key === 'W') { setGizmoMode('translate'); useUIStore.getState().setActiveTool('move'); }
      if (e.key === 'e' || e.key === 'E') { setGizmoMode('rotate'); useUIStore.getState().setActiveTool('rotate'); }
      if ((e.key === 'r' || e.key === 'R') && scaleAllowed) { setGizmoMode('scale'); useUIStore.getState().setActiveTool('scale'); }
      if (e.key === 'Escape') { setGizmoMode(null); useUIStore.getState().setActiveTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scaleAllowed]);

  // Left toolbar's Select/Move/Rotate/Scale buttons drive the same gizmo the
  // W/E/R shortcuts do, so both entry points stay in sync.
  const activeTool = useUIStore((s) => s.activeTool);
  useEffect(() => {
    if (activeTool === 'move') setGizmoMode('translate');
    else if (activeTool === 'rotate') setGizmoMode('rotate');
    else if (activeTool === 'scale' && scaleAllowed) setGizmoMode('scale');
    else if (activeTool === 'select') setGizmoMode(null);
  }, [activeTool, scaleAllowed]);

  // Grid Snap tool - snaps the transform gizmo to fixed position/rotation/scale steps.
  const gridSnapEnabled = useUIStore((s) => s.gridSnapEnabled);
  useEffect(() => {
    gizmoRef.current?.setSnap(gridSnapEnabled);
  }, [gridSnapEnabled, gizmoMode]);

  // -- Measure tool -------------------------------------------------------------
  // Click two points on the model to read the distance between them, in scene units.
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  const measureLineRef = useRef<THREE.Line | null>(null);

  const clearMeasureLine = useCallback(() => {
    const sm = sceneManagerRef.current;
    if (measureLineRef.current && sm) {
      sm.scene.remove(measureLineRef.current);
      measureLineRef.current.geometry.dispose();
      (measureLineRef.current.material as THREE.Material).dispose();
      measureLineRef.current = null;
    }
  }, [sceneManagerRef]);

  useEffect(() => {
    const container = containerRef.current;
    const sm = sceneManagerRef.current;
    if (!container || !sm || activeTool !== 'measure') return;

    const onClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, sm.camera);

      const meshes: THREE.Mesh[] = [];
      sm.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && !obj.userData?.isHelper && !obj.userData?.isProxy && obj.name !== '__floor__') {
          meshes.push(obj);
        }
      });
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) return;
      const point = hits[0].point.clone();

      setMeasurePoints((prev) => {
        // A third click starts a fresh measurement.
        const next = prev.length >= 2 ? [point] : [...prev, point];
        if (next.length < 2) {
          setMeasureDistance(null);
          clearMeasureLine();
        } else {
          const dist = next[0].distanceTo(next[1]);
          setMeasureDistance(dist);
          clearMeasureLine();
          const geometry = new THREE.BufferGeometry().setFromPoints(next);
          const material = new THREE.LineDashedMaterial({ color: 0xffc24d, dashSize: 0.1, gapSize: 0.05, linewidth: 2 });
          const line = new THREE.Line(geometry, material);
          line.computeLineDistances();
          line.userData.isHelper = true;
          sm.scene.add(line);
          measureLineRef.current = line;
        }
        return next;
      });
    };

    container.addEventListener('click', onClick);
    container.style.cursor = 'crosshair';
    return () => {
      container.removeEventListener('click', onClick);
      container.style.cursor = '';
    };
  }, [activeTool, sceneManagerRef, containerRef, clearMeasureLine]);

  // Leaving measure mode clears the in-progress readout and drawn line.
  useEffect(() => {
    if (activeTool !== 'measure') {
      setMeasurePoints([]);
      setMeasureDistance(null);
      clearMeasureLine();
    }
  }, [activeTool, clearMeasureLine]);

  // Sync lights to scene
  useEffect(() => {
    const smForLights = sceneManagerRef.current;
    if (!smForLights) return;

    lightManagerRef.current?.syncLights(
      lights.map((l) => ({
        id: l.id,
        type: l.type,
        color: l.color,
        brightness: l.brightness,
        opacity: l.opacity,
        visible: l.visible,
        solo: l.solo,
        falloff: l.falloff,
        gearVisible: l.gearVisible,
        transform: l.transform,
        spotAngle: l.spotAngle,
        spotPenumbra: l.spotPenumbra,
        spotDecay: 2,
        areaWidth: l.areaWidth,
        areaHeight: l.areaHeight,
        edgeSoftness: l.edgeSoftness,
        dropShadow: l.dropShadow,
      })),
      smForLights.scene
    );
  }, [lights, lightManagerRef, sceneManagerRef]);

  // Sync turntable state to SceneManager
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;
    sm._turntableActive = turntable.active;
    sm._turntableSpeed = turntable.speed;
  }, [turntable.active, turntable.speed, sceneManagerRef]);

  // -- LightPaint -------------------------------------------------------------
  // Click a point on the car and the selected light is repositioned so that its
  // reflection lands exactly there. This is the reverse-reflection problem:
  // reflect the VIEW ray about the surface normal, then walk the light out
  // along that reflected direction. Same idea as HDR Light Studio's LightPaint.
  const [paintActive, setPaintActive] = useState(false);
  const [paintMode, setPaintMode] = useState<PaintMode>('reflection');
  const [distanceScale, setDistanceScale] = useState(1.0);
  const paintPivotRef = useRef<THREE.Vector3 | null>(null);
  const paintBoundsRef = useRef<{ center: THREE.Vector3; distance: number } | null>(null);
  const paintRafRef = useRef<number | null>(null);
  const paintPosRef = useRef<{ x: number; y: number } | null>(null);
  const paintingRef = useRef(false);

  const paintAt = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    const sm = sceneManagerRef.current;
    const lightId = useLightsStore.getState().selectedLightId;
    const shapeId = useHDRIShapesStore.getState().selectedShapeId;
    if (!container || !sm || (!lightId && !shapeId)) return;

    const rect = container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, sm.camera);

    const meshes: THREE.Mesh[] = [];
    sm.scene.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        !obj.userData?.isHelper &&
        !obj.userData?.isProxy &&
        obj.name !== '__floor__'
      ) {
        meshes.push(obj);
      }
    });

    const hits = raycaster.intersectObjects(meshes, false);

    // An HDRI shape has no 3D position - it only lives on the equirect map -
    // so instead of solving for where a light must sit, mirror the camera's
    // view ray off the clicked surface and place the shape at the reflected
    // direction on the sphere. That's the exact same reverse-reflection math
    // real-time renderers use to look up an environment map for a mirror
    // surface, so a shape "wrapped" this way lands its reflection precisely
    // where you clicked, the same way LightPaint does for a real light.
    if (!lightId && shapeId) {
      const targetShape = useHDRIShapesStore.getState().shapes.find((s) => s.id === shapeId);
      if (targetShape?.locked) return;
      const hit = hits[0];
      if (!hit) return;
      const N = smoothNormalAt(hit);
      const incident = hit.point.clone().sub(sm.camera.position).normalize();
      const R = incident.clone().sub(N.clone().multiplyScalar(2 * incident.dot(N))).normalize();

      // Same equirect convention as HDRIExporter's pixelToDirection/
      // sampleEnvTexture and HDRIShapesLayer's directionAt: phi = v*PI
      // measured from the top/north pole (R.y=+1 -> v=0), theta = (u-0.5)*2PI.
      // This MUST stay in sync with those - a mismatched sign here is what
      // made a "wrapped" shape land at the wrong latitude on the map.
      let u = Math.atan2(R.z, R.x) / (2 * Math.PI) + 0.5;
      u = ((u % 1) + 1) % 1;
      const v = Math.acos(Math.max(-1, Math.min(1, R.y))) / Math.PI;

      updateHDRIShape(shapeId, { u, v });
      return;
    }

    // Rim ignores the model entirely - it rides the camera ray out past the scene.
    if (paintMode !== 'rim' && hits.length === 0) return;

    if (!paintBoundsRef.current) {
      paintBoundsRef.current = computeLightDistance(sm.scene, distanceScale);
    }
    const { center, distance } = paintBoundsRef.current;

    const hit = hits[0];
    const P = hit ? hit.point.clone() : center.clone();
    const N = hit ? smoothNormalAt(hit) : new THREE.Vector3(0, 1, 0);

    const result = solveLightPaint(
      paintMode,
      P,
      N,
      sm.camera,
      center,
      distance,
      paintPivotRef.current ?? undefined,
    );

    // Reflection and Illumination set the pivot that Shadow later swings around.
    if (paintMode === 'reflection' || paintMode === 'illumination') {
      paintPivotRef.current = P.clone();
    }

    const lp = result.position;
    const sphDbg = cartesianToSpherical(lp.x, lp.y, lp.z);
    console.log('[LP]', paintMode,
      '| dist:', distance.toFixed(1),
      '| center:', center.x.toFixed(1), center.y.toFixed(1), center.z.toFixed(1),
      '| lightPos:', lp.x.toFixed(1), lp.y.toFixed(1), lp.z.toFixed(1),
      '| sph lat:', sphDbg.lat.toFixed(1), 'lng:', sphDbg.lng.toFixed(1),
      'rad:', sphDbg.radius.toFixed(1), 'h:', sphDbg.height.toFixed(1));
    const st = useLightsStore.getState();
    const l = st.lights.find((x) => x.id === lightId);
    if (!l) return;

    const sph = cartesianToSpherical(lp.x, lp.y, lp.z);
    st.updateLightTransform(lightId, {
      position: { x: lp.x, y: lp.y, z: lp.z },
      spherical: { lat: sph.lat, lng: sph.lng, radius: sph.radius, height: sph.height },
      // Leave rotation.enabled alone. Forcing it true makes engine.ts abandon
      // lookAt() and apply these raw Eulers instead - and a RectAreaLight is
      // single-sided, so if the face ends up pointing away from the scene the
      // light emits into the void and simply disappears.
      // Hand the engine the POINT to look at, not a precomputed Euler. Euler
      // angles are applied as a LOCAL rotation, so they silently break the moment
      // a light sits under a parent transform. Overhead the discrepancy is tiny;
      // beside the car it is not - which is exactly why door paints drifted while
      // roof paints looked fine. lookAt() sets the quaternion directly and is
      // immune to the whole problem.
      aimTarget: { x: P.x, y: P.y, z: P.z },
      rotation: { ...l.transform.rotation, enabled: false },
    } as never);
  }, [paintMode, distanceScale, containerRef, sceneManagerRef, updateHDRIShape]);

  // Pointer handling lives on the container so no JSX surgery is needed.
  useEffect(() => {
    const container = containerRef.current;
    const sm = sceneManagerRef.current;
    if (!container || !sm || !paintActive) return;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      paintingRef.current = true;
      paintBoundsRef.current = null;
      sm.controls.enabled = false;
      paintAt(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (!paintingRef.current) return;

      // pointermove fires far faster than the renderer draws. Raycasting on every
      // event means several raycasts per frame, all but the last one thrown away -
      // that is what makes the drag feel heavy and jumpy. Keep only the newest
      // cursor position and resolve it once per animation frame.
      paintPosRef.current = { x: e.clientX, y: e.clientY };
      if (paintRafRef.current !== null) return;

      paintRafRef.current = requestAnimationFrame(() => {
        paintRafRef.current = null;
        const p = paintPosRef.current;
        if (p) paintAt(p.x, p.y);
      });
    };
    const up = () => {
      paintingRef.current = false;
      paintBoundsRef.current = null;
      if (paintRafRef.current !== null) {
        cancelAnimationFrame(paintRafRef.current);
        paintRafRef.current = null;
      }
      sm.controls.enabled = true;
    };

    container.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    container.style.cursor = 'crosshair';

    return () => {
      container.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      container.style.cursor = '';
      sm.controls.enabled = true;
    };
  }, [paintActive, paintAt, containerRef, sceneManagerRef]);

  // Click-to-select material from viewport
  const handleViewportClick = useCallback((event: React.MouseEvent) => {
    // Only work with select tool
    if (useUIStore.getState().activeTool !== 'select') return;

    const container = containerRef.current;
    const sm = sceneManagerRef.current;
    if (!container || !sm) return;

    const rect = container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, sm.camera);

    const meshes: THREE.Mesh[] = [];
    sm.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !(obj as any).userData?.isHelper && !(obj as any).userData?.isProxy && obj.name !== '__floor__') {
        meshes.push(obj);
      }
    });

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const mesh = hits[0].object as THREE.Mesh;
      // Get material name from Three.js material
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const matName = material.name || mesh.name;

      // Find matching material in store by name or mesh name
      const matState = useMaterialEditorStore.getState().materials;
      const match = matState.find((m) =>
        m.name === matName || m.meshNames.includes(mesh.name)
      );

      if (match) {
        useMaterialEditorStore.getState().selectMaterial(match.id);

        // Open right panel and switch to matEdit tab
        const ui = useUIStore.getState();
        if (!ui.rightPanelOpen) ui.showPanel('rightPanel');
        ui.setRightPanelTab('matEdit');

        // Visual feedback: brief emissive flash on the mesh
        if (material && 'emissive' in material) {
          const mat = material as THREE.MeshStandardMaterial;
          const origEmissive = mat.emissive.clone();
          mat.emissive.set(0x444466);
          setTimeout(() => {
            mat.emissive.copy(origEmissive);
            mat.needsUpdate = true;
          }, 200);
        }
      }
    }
  }, [sceneManagerRef]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length === 0) return;

      const file = files[0];
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'glb' || ext === 'gltf' || ext === 'erik') {
        loadModelFile(file);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelLoaderRef, erikLoaderRef]
  );

  // Load model from file - routes to the .erik importer or the standard
  // GLTFLoader-based one depending on extension.
  const loadModelFile = useCallback(
    (file: File) => {
      const isErik = /\.erik$/i.test(file.name);
      const loader = isErik ? erikLoaderRef.current : modelLoaderRef.current;
      if (!loader) return;
      setIsLoading(true);
      setLoadError(null);
      setLoadProgress(0);
      loader.loadFromFile(file);
    },
    [modelLoaderRef, erikLoaderRef]
  );

  // File picker
  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadModelFile(file);
      e.target.value = '';
    },
    [loadModelFile]
  );

  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Screenshot handler
  const handleScreenshot = useCallback(() => {
    const dataUrl = renderPipelineRef.current
      ? renderPipelineRef.current.capture()
      : sceneManagerRef.current?.takeScreenshot() ?? '';
    if (dataUrl) onScreenshot(dataUrl);
  }, [sceneManagerRef, renderPipelineRef, onScreenshot]);

  return (
    <ThreeSceneProvider>
      <CameraSwitcher />
      <ViewportPropertiesPanel />
      <GizmoToolbar
        mode={gizmoMode}
        onModeChange={setGizmoMode}
        scaleAllowed={scaleAllowed}
        disabled={!selectedLightId && !hdriSelectedShapeId}
        transformDisabled={!selectedLightId}
        paintActive={paintActive}
        onPaintToggle={() => { setPaintActive((p) => !p); setGizmoMode(null); }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <ViewportToolbar
          sceneManagerRef={sceneManagerRef}
          onScreenshot={handleScreenshot}
          onLoadModel={handleOpenFilePicker}
        />
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            flex: 1,
            overflow: 'hidden',
            background: 'var(--bg-deep)',
          }}
          onMouseDown={(e) => { mouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
          onClick={(e) => {
            if (mouseDownPos.current) {
              const dx = e.clientX - mouseDownPos.current.x;
              const dy = e.clientY - mouseDownPos.current.y;
              if (Math.sqrt(dx*dx + dy*dy) < 3) {
                handleViewportClick(e);
              }
            }
            mouseDownPos.current = null;
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="drop-overlay">
              <span>Drop .glb or .erik file to load model</span>
            </div>
          )}

          {isLoading && loadProgress < 100 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 10,
                padding: '6px 12px',
              }}
            >
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
            </div>
          )}

          {loadError && (
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
                background: 'var(--danger)',
                color: '#fff',
                padding: '4px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11,
              }}
            >
              {loadError}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf,.erik"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />

          <CameraBookmarks sceneManagerRef={sceneManagerRef} />

          {activeTool === 'measure' && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '4px 12px',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
                zIndex: 5,
              }}
            >
              {measureDistance !== null
                ? `Distance: ${measureDistance.toFixed(3)} units — click to start a new measurement`
                : measurePoints.length === 1
                  ? 'Click a second point to measure'
                  : 'Click a point on the model to start measuring'}
            </div>
          )}
        </div>
      </div>
    </ThreeSceneProvider>
  );
};