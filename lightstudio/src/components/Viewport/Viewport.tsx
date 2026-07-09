import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { useAnimationStore } from '../../store/animationStore';
import { ThreeSceneProvider } from '../../hooks/useThreeScene';
import { SceneManager, RenderPipeline, LightManager, ModelLoader } from '../../three/engine';
import { animationEngine, AnimationEngine } from '../../three/AnimationEngine';
import { EnvironmentLoader } from '../../three/EnvironmentLoader';
import { getHDRIPresetById } from '../../types/Environment';
import { base64ToArrayBuffer } from '../../store/modelDataStore';
import { hdriBase64ToArrayBuffer, setRawHDRIData } from '../../store/hdriDataStore';
import { ViewportToolbar } from './ViewportToolbar';
import { CameraBookmarks } from './CameraBookmarks';
import type { AnimatedProperty } from '../../types/Animation';
import { MaterialManager } from '../../three/MaterialManager';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import { useUIStore } from '../../store/uiStore';

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
  const renderSettings = useSceneStore((s) => s.renderSettings);
  const setModel = useSceneStore((s) => s.setModel);
  const setExposure = useSceneStore((s) => s.setExposure);
  const setBloom = useSceneStore((s) => s.setBloom);
  const pendingModelData = useSceneStore((s) => s._pendingModelDataBase64);
  const pendingModelFileName = useSceneStore((s) => s._pendingModelFileName);
  const clearPendingModelData = useSceneStore((s) => s.clearPendingModelData);
  const pendingHDRIData = useSceneStore((s) => s._pendingHDRIDataBase64);
  const clearPendingHDRIData = useSceneStore((s) => s.clearPendingHDRIData);
  const backplate = useSceneStore((s) => s.environment.backplate);
  const backplateOpacity = useSceneStore((s) => s.environment.backplateOpacity);

  const lights = useLightsStore((s) => s.lights);
  const updateLight = useLightsStore((s) => s.updateLight);

  // Animation store selectors (non-reactive — read inside the loop via getState)
  // We only use isPlaying for the dependency to know if animation is active

  // Initialize the 3D scene on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const sceneManager = new SceneManager();
    sceneManagerRef.current = sceneManager;
    sceneManager.attach(containerRef.current);

    const lightManager = new LightManager(sceneManager.scene);
    lightManagerRef.current = lightManager;

    const modelLoader = new ModelLoader(sceneManager.scene);
    modelLoaderRef.current = modelLoader;

    // Material Manager
    const materialManager = new MaterialManager();
    materialManagerRef.current = materialManager;

    // Phase 9: Environment loader
    const envLoader = new EnvironmentLoader();
    envLoaderRef.current = envLoader;

    modelLoader.setCallbacks({
      onProgress: (p) => setLoadProgress(p),
      onLoaded: (name) => {
        setIsLoading(false);
        setLoadProgress(100);
        setModel('', name);

        // Extract materials from the loaded model
        setTimeout(() => {
          const model = modelLoader.getCurrentModel?.();
          if (model && materialManager) {
            // Check if we have saved material states (from a scene file restore)
            const savedMaterials = useMaterialEditorStore.getState().materials;
            const hasSavedStates = savedMaterials.length > 0;

            const matStates = materialManager.extractMaterials(model);

            if (hasSavedStates) {
              // Merge saved edits over the freshly extracted defaults
              const merged = matStates.map((extracted) => {
                const saved = savedMaterials.find((s) => s.name === extracted.name);
                if (saved) {
                  // Keep the extracted ID (it's linked to the materialMap), but use saved values
                  return { ...extracted, ...saved, id: extracted.id };
                }
                return extracted;
              });
              useMaterialEditorStore.getState().setMaterials(merged);

              requestAnimationFrame(() => {
                materialManager.rebuildMaterialMap(sceneManager.scene, merged);
                // Apply saved property overrides to Three.js materials
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
      },
      onError: (err) => {
        setIsLoading(false);
        setLoadProgress(0);
        setLoadError(err);
        setTimeout(() => setLoadError(null), 4000);
      },
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

    // Notify parent that the render pipeline is ready (for export)
    onReady?.(renderPipeline, materialManager);

    // ── Animation frame accumulator & tick callback ─────────────────────
    const clock = new THREE.Clock();
    animAccumulatorRef.current = 0;

    const loop = () => {
      const delta = clock.getDelta();

      // ── Animation tick (frame-accurate playback) ──────────────────────
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

      // ── Turntable (non-animated, manual rotation) ─────────────────────
      if (sceneManager._turntableActive) {
        const model = sceneManager._findModel();
        if (model) model.rotation.y += delta * sceneManager._turntableSpeed * 0.5;
      }

      sceneManager.controls.update();
      renderPipeline.render();
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
      lightManager.dispose();
      envLoader.dispose();
      materialManager.dispose();
      sceneManager.dispose();
      sceneManagerRef.current = null;
      renderPipelineRef.current = null;
      lightManagerRef.current = null;
      modelLoaderRef.current = null;
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

  // Sync environment background (only when no backplate)
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm || backplate) return; // Skip if backplate is active
    sm.setBackground(environment.background, environment.showBackground);
  }, [environment.background, environment.showBackground, sceneManagerRef, backplate]);

  // Phase 9: Sync environment preset to 3D scene (built-in presets only)
  useEffect(() => {
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || !el) return;

    // Skip custom HDRI — handled by the separate effect below
    if (environment.presetId === '__custom__') return;

    const preset = getHDRIPresetById(environment.presetId);
    if (!preset) return;

    const envTexture = el.generateFromPreset(preset, sm.pmremGenerator, environment.rotation);
    el.setEnvironmentTexture(sm.scene, envTexture, environment.intensity);
  }, [environment.presetId, environment.rotation, environment.intensity, sceneManagerRef, envLoaderRef]);

  // Phase 9: Load custom HDRI file into the 3D scene
  useEffect(() => {
    const sm = sceneManagerRef.current;
    const el = envLoaderRef.current;
    if (!sm || !el) return;

    if (environment.presetId === '__custom__' && environment.hdri) {
      el.loadHDRI(environment.hdri, sm.pmremGenerator)
        .then((envTexture) => {
          el.setEnvironmentTexture(sm.scene, envTexture, environment.intensity);
        })
        .catch(() => {
          // Fallback to neutral studio on error
          const fallback = getHDRIPresetById('studio-neutral');
          if (fallback) {
            const envTexture = el.generateFromPreset(fallback, sm.pmremGenerator, 0);
            el.setEnvironmentTexture(sm.scene, envTexture, environment.intensity);
          }
        });
    }
  }, [environment.presetId, environment.hdri, environment.intensity, sceneManagerRef, envLoaderRef]);

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
      ml.loadFromBuffer(arrayBuffer, pendingModelFileName);
    } catch {
      setLoadError('Failed to restore model from scene file');
      setIsLoading(false);
    }

    clearPendingModelData();
  }, [pendingModelData, pendingModelFileName, modelLoaderRef, clearPendingModelData]);

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
          el.setEnvironmentTexture(sm.scene, envTexture, useSceneStore.getState().environment.intensity);
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
  }, [renderSettings, renderPipelineRef]);

  // Sync lights to scene
  useEffect(() => {
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
      }))
    );
  }, [lights, lightManagerRef]);

  // Sync turntable state to SceneManager
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;
    sm._turntableActive = turntable.active;
    sm._turntableSpeed = turntable.speed;
  }, [turntable.active, turntable.speed, sceneManagerRef]);

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
      if (obj instanceof THREE.Mesh && !(obj as any).userData?.isHelper) {
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

        // Open right panel and switch to matEdit tab if needed
        const ui = useUIStore.getState();
        if (!ui.rightPanelOpen) ui.showPanel('rightPanel');

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
      if (ext === 'glb' || ext === 'gltf') {
        loadModelFile(file);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelLoaderRef]
  );

  // Load model from file
  const loadModelFile = useCallback(
    (file: File) => {
      if (!modelLoaderRef.current) return;
      setIsLoading(true);
      setLoadError(null);
      setLoadProgress(0);
      modelLoaderRef.current.loadFromFile(file);
    },
    [modelLoaderRef]
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
              <span>Drop .glb file to load model</span>
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
            accept=".glb,.gltf"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />

          <CameraBookmarks sceneManagerRef={sceneManagerRef} />
        </div>
      </div>
    </ThreeSceneProvider>
  );
};