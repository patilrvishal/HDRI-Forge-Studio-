import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { useLightsStore } from '../../store/lightsStore';
import { useUIStore } from '../../store/uiStore';
import { sphericalToCartesian } from '../../utils/math';
import {
  MATERIAL_PRESETS,
  type MaterialPresetKey,
  type PresetLight,
  type PreviewBackground,
} from '../../types/Preset';

// Initialize RectAreaLight uniform lib once
let rectAreaLibReady = false;
function ensureRectAreaLib(): void {
  if (!rectAreaLibReady) {
    RectAreaLightUniformsLib.init();
    rectAreaLibReady = true;
  }
}
ensureRectAreaLib();

export interface MaterialPreviewHandle {
  renderThumbnail: (lightsData: PresetLight[]) => string;
  getRenderer: () => THREE.WebGLRenderer | null;
}

interface MaterialPreviewProps {
  envMap?: THREE.Texture | null;
  onReady?: (handle: MaterialPreviewHandle) => void;
}

/**
 * Create a Three.js point/spot/area light from a PresetLight descriptor.
 * Used both for the live preview and for thumbnail rendering.
 */
function createProxyLight(ld: PresetLight): THREE.Light {
  ensureRectAreaLib();

  const pos = sphericalToCartesian(
    ld.transform.spherical.lat,
    ld.transform.spherical.lng,
    ld.transform.spherical.radius,
    ld.transform.spherical.height,
  );
  const col = new THREE.Color(ld.color);
  const effectiveIntensity = ld.brightness * (ld.opacity / 100) * 0.25;

  let light: THREE.Light;
  if (ld.type === 'area' || ld.type === 'overhead') {
    const w = ld.type === 'overhead' ? 4 : 2;
    const h = ld.type === 'overhead' ? 4 : 2;
    light = new THREE.RectAreaLight(col, effectiveIntensity, w, h);
  } else if (ld.type === 'spot' || ld.type === 'rim') {
    light = new THREE.SpotLight(col, effectiveIntensity, 30, 0.785, 0.5, 2);
  } else {
    light = new THREE.PointLight(col, effectiveIntensity, 30, 2);
  }

  light.position.set(pos.x, pos.y, pos.z);
  return light;
}

export const MaterialPreview = React.forwardRef<MaterialPreviewHandle, MaterialPreviewProps>(
  ({ envMap, onReady }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const sphereRef = useRef<THREE.Mesh | null>(null);
    const proxyLightsRef = useRef<THREE.Light[]>([]);
    const rotationRef = useRef(0);
    const animFrameRef = useRef<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const lights = useLightsStore((s) => s.lights);
    const materialPreset = useUIStore((s) => s.materialPreset);
    const previewBackground = useUIStore((s) => s.previewBackground);

    // ── Scene setup (runs once) ──────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      // Renderer
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x333333);
      sceneRef.current = scene;

      // Camera
      const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
      camera.position.set(0, 0, 4.2);
      cameraRef.current = camera;

      // Sphere with MeshStandardMaterial (supports clearcoat)
      const sphereGeo = new THREE.SphereGeometry(1.2, 64, 64);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 1,
        roughness: 0.15,
        envMapIntensity: 1,
      } as any);
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      scene.add(sphere);
      sphereRef.current = sphere;

      // Ground disc for reflections
      const groundGeo = new THREE.CircleGeometry(2, 48);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.5,
        roughness: 0.6,
        envMapIntensity: 0.3,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.25;
      scene.add(ground);

      // Small axes helper for spatial reference
      const axes = new THREE.AxesHelper(0.6);
      axes.position.set(-1.8, -1.4, -0.5);
      scene.add(axes);

      // Set initial size from container
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        renderer.setSize(rect.width, rect.height);
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
      }

      return () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        sphereGeo.dispose();
        sphereMat.dispose();
        groundGeo.dispose();
        groundMat.dispose();
        renderer.dispose();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
        sphereRef.current = null;
      };
    }, []);

    // ── Resize observer ──────────────────────────────────────────────────────
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          const renderer = rendererRef.current;
          const camera = cameraRef.current;
          if (width > 0 && height > 0 && renderer && camera) {
            renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
        }
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    // ── Sync material from preset ────────────────────────────────────────────
    useEffect(() => {
      const sphere = sphereRef.current;
      if (!sphere) return;
      const mat = sphere.material as any;

      const preset = MATERIAL_PRESETS[materialPreset as MaterialPresetKey];
      if (!preset) return;

      mat.color.set(preset.color);
      mat.metalness = preset.metalness;
      mat.roughness = preset.roughness;
      mat.clearcoat = preset.clearcoat;
      mat.clearcoatRoughness = preset.clearcoatRoughness;
      mat.needsUpdate = true;
    }, [materialPreset]);

    // ── Sync background ──────────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;

      switch (previewBackground as PreviewBackground) {
        case 'black':
          scene.background = new THREE.Color(0x000000);
          break;
        case 'grey':
          scene.background = new THREE.Color(0x333333);
          break;
        case 'white':
          scene.background = new THREE.Color(0xffffff);
          break;
        case 'custom':
          scene.background = new THREE.Color(0x0a0a14);
          break;
      }
    }, [previewBackground]);

    // ── Sync environment map ─────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene || !envMap) return;
      scene.environment = envMap;
    }, [envMap]);

    // ── Sync proxy lights from store ─────────────────────────────────────────
    // Build PresetLight data from the lights store
    const presetLightsData = useMemo(() => {
      return lights.map((l) => ({
        name: l.name,
        type: l.type,
        color: l.color,
        brightness: l.brightness,
        opacity: l.opacity,
        colorProfile: l.colorProfile,
        areaLight: l.areaLight,
        falloff: l.falloff,
        transform: JSON.parse(JSON.stringify(l.transform)),
      }));
    }, [lights]);

    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;

      // Remove old proxy lights
      for (const l of proxyLightsRef.current) {
        scene.remove(l);
      }
      proxyLightsRef.current = [];

      const anySolo = lights.some((l) => l.solo);

      for (const ld of presetLightsData) {
        // Determine visibility based on solo mode
        const matchingLight = lights.find((l) => l.name === ld.name);
        const isVisible = anySolo
          ? matchingLight?.solo ?? false
          : matchingLight?.visible ?? true;

        if (!isVisible) continue;

        const light = createProxyLight(ld);
        scene.add(light);
        proxyLightsRef.current.push(light);
      }
    }, [presetLightsData, lights]);

    // ── Render loop ──────────────────────────────────────────────────────────
    useEffect(() => {
      let lastTime = performance.now();

      const animate = (now: number) => {
        const delta = (now - lastTime) / 1000;
        lastTime = now;

        // Slowly rotate the sphere for visual interest
        rotationRef.current += delta * 0.15;
        if (sphereRef.current) {
          sphereRef.current.rotation.y = rotationRef.current;
        }

        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }

        animFrameRef.current = requestAnimationFrame(animate);
      };

      animFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
    }, []);

    // ── renderThumbnail for preset saving ────────────────────────────────────
    const renderThumbnail = useCallback(
      (lightsData: PresetLight[]): string => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const canvas = canvasRef.current;
        if (!renderer || !scene || !camera || !canvas) return '';

        // Save current proxy lights
        const savedLights = [...proxyLightsRef.current];
        for (const l of savedLights) {
          scene.remove(l);
        }
        proxyLightsRef.current = [];

        // Ensure canvas is at least 160x120 for thumbnail generation
        if (canvas.width < 10 || canvas.height < 10) {
          renderer.setSize(160, 120);
          camera.aspect = 160 / 120;
          camera.updateProjectionMatrix();
        }

        // Create thumbnail-specific lights (slightly boosted intensity)
        for (const ld of lightsData) {
          const pos = sphericalToCartesian(
            ld.transform.spherical.lat,
            ld.transform.spherical.lng,
            ld.transform.spherical.radius,
            ld.transform.spherical.height,
          );
          const col = new THREE.Color(ld.color);
          const ei = ld.brightness * (ld.opacity / 100) * 0.3;

          let light: THREE.Light;
          if (ld.type === 'area' || ld.type === 'overhead') {
            ensureRectAreaLib();
            light = new THREE.RectAreaLight(col, ei, 2, 2);
          } else if (ld.type === 'spot' || ld.type === 'rim') {
            light = new THREE.SpotLight(col, ei, 30, 0.785, 0.5, 2);
          } else {
            light = new THREE.PointLight(col, ei, 30, 2);
          }
          light.position.set(pos.x, pos.y, pos.z);
          scene.add(light);
          proxyLightsRef.current.push(light);
        }

        // Render one frame
        renderer.render(scene, camera);
        const dataUrl = canvas.toDataURL('image/png');

        // Restore previous proxy lights
        for (const l of proxyLightsRef.current) {
          scene.remove(l);
        }
        proxyLightsRef.current = savedLights;
        for (const l of savedLights) {
          scene.add(l);
        }

        return dataUrl;
      },
      [],
    );

    // ── Forward the imperative handle ────────────────────────────────────────
    const handle = useMemo<MaterialPreviewHandle>(
      () => ({
        renderThumbnail,
        getRenderer: () => rendererRef.current,
      }),
      [renderThumbnail],
    );

    React.useImperativeHandle(ref, () => handle, [handle]);

    useEffect(() => {
      if (onReady) {
        onReady(handle);
      }
    }, [handle, onReady]);

    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      </div>
    );
  },
);

MaterialPreview.displayName = 'MaterialPreview';