import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useUIStore } from '../../store/uiStore';
import { useViewportModeStore } from '../../store/viewportModeStore';
import { SceneManager, RenderPipeline } from '../../three/engine';
import type { ViewMode } from '../../types/Light';


interface ViewportToolbarProps {
  sceneManagerRef: React.MutableRefObject<SceneManager | null>;
  renderPipelineRef: React.MutableRefObject<RenderPipeline | null>;
  onScreenshot: () => void;
  onLoadModel: () => void;
}

const VIEW_PRESETS: Record<ViewMode, { position: [number, number, number]; target: [number, number, number] }> = {
  perspective: { position: [5, 3, 5], target: [0, 0.5, 0] },
  front: { position: [0, 1.5, 8], target: [0, 0.5, 0] },
  right: { position: [8, 1.5, 0], target: [0, 0.5, 0] },
  top: { position: [0, 8, 0.01], target: [0, 0, 0] },
};

export const ViewportToolbar: React.FC<ViewportToolbarProps> = ({
  sceneManagerRef,
  renderPipelineRef,
  onScreenshot,
  onLoadModel,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pathTracerStatus, setPathTracerStatus] = useState<{ ready: boolean; samples: number; error: string | null } | null>(null);

  const modelName = useSceneStore((s) => s.modelName);
  const renderEngine = useSceneStore((s) => s.renderSettings.engine);
  const setRenderSettings = useSceneStore((s) => s.setRenderSettings);
  const showGrid = useSceneStore((s) => s.showGrid);
  const toggleGrid = useSceneStore((s) => s.toggleGrid);
  const environment = useSceneStore((s) => s.environment);
  const toggleBackground = useSceneStore((s) => s.toggleBackground);
  const turntable = useSceneStore((s) => s.turntable);
  const setTurntable = useSceneStore((s) => s.setTurntable);
  const toggleTurntable = useSceneStore((s) => s.toggleTurntable);

  const setSettingsModal = useUIStore((s) => s.setSettingsModal);

  const workspaceMode = useViewportModeStore((s) => s.mode);
  const setWorkspaceMode = useViewportModeStore((s) => s.setMode);
  const handleWorkspaceChange = useCallback(
    (mode: string) => setWorkspaceMode(mode as '360' | 'angleHunt'),
    [setWorkspaceMode],
  );

  // Observe container size for resolution display
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm?.container) return;

    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        const size = sm.getContainerSize();
        setResolution({ width: Math.round(size.width), height: Math.round(size.height) });
      }, 100);
    });

    observer.observe(sm.container);
    // Initial
    const size = sm.getContainerSize();
    setResolution({ width: Math.round(size.width), height: Math.round(size.height) });

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, [sceneManagerRef]);

  // Handle view mode change
  const handleViewModeChange = useCallback(
    (mode: string) => {
      const vm = mode as ViewMode;
      setViewMode(vm);
      const preset = VIEW_PRESETS[vm];
      if (preset) {
        sceneManagerRef.current?.animateCameraTo(preset.position, preset.target, 500);
      }
    },
    [sceneManagerRef]
  );

  // Handle engine change
  const handleEngineChange = useCallback(
    (engine: string) => setRenderSettings({ engine: engine as 'pbr' | 'pathtracer' }),
    [setRenderSettings],
  );

  // Poll the path tracer's live sample count - it accumulates every rendered
  // frame inside RenderPipeline, not through a store, so there's nothing to
  // subscribe to; only run this extra rAF loop while pathtracer mode is on.
  useEffect(() => {
    if (renderEngine !== 'pathtracer') {
      setPathTracerStatus(null);
      return;
    }
    // Throttled to a few times a second - polling every rendered frame would
    // re-render this toolbar every frame for as long as the mode is on.
    const interval = setInterval(() => {
      const rp = renderPipelineRef.current;
      if (rp) {
        setPathTracerStatus({ ready: rp.isPathTracingReady(), samples: rp.getPathTracerSamples(), error: rp.getPathTracerError() });
      }
    }, 200);
    return () => clearInterval(interval);
  }, [renderEngine, renderPipelineRef]);

  // Handle turntable speed change
  const handleSpeedChange = useCallback(
    (speed: number) => {
      setTurntable(turntable.active, speed);
    },
    [turntable.active, setTurntable]
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        padding: '0 8px',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        gap: 8,
      }}
    >
      {/* Left: Model name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
        <button
          className="btn-sm"
          onClick={onLoadModel}
          style={{ fontSize: 10, whiteSpace: 'nowrap' }}
          title="Load Model"
        >
          {modelName}
        </button>
      </div>

      {/* Center: Workspace + Engine + View */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* Workspace toggle: 360 Workspace (free-orbit) vs Angle Hunt Mode
            (locked to one camera, HDR Light Studio's Camera/Light-Editor
            workflow). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text-dim)',
            }}
          >
            WORKSPACE
          </span>
          <select
            className="field-select"
            value={workspaceMode}
            onChange={(e) => handleWorkspaceChange(e.target.value)}
            style={{ width: 100, height: 22, fontSize: 10 }}
            title={
              workspaceMode === '360'
                ? 'Free-orbit - edit the HDRI environment from any angle'
                : 'Locked to one camera shot - position lights precisely against that exact angle'
            }
          >
            <option value="360">360 Workspace</option>
            <option value="angleHunt">Angle Hunt</option>
          </select>
        </div>

        {/* Engine */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text-dim)',
            }}
          >
            ENGINE
          </span>
          <select
            className="field-select"
            value={renderEngine}
            onChange={(e) => handleEngineChange(e.target.value)}
            style={{ width: 84, height: 22, fontSize: 10 }}
          >
            <option value="pbr">PBR</option>
            <option value="pathtracer">Pathtracer</option>
          </select>
          {renderEngine === 'pathtracer' && (
            <span
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: pathTracerStatus?.error ? 'var(--danger, #e5484d)' : 'var(--accent)',
                whiteSpace: 'nowrap',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={
                pathTracerStatus?.error ??
                'Path-traced final-quality preview: accumulates samples while the camera and scene are still, resets on any change.'
              }
            >
              {pathTracerStatus
                ? pathTracerStatus.error
                  ? pathTracerStatus.error
                  : pathTracerStatus.ready
                  ? `${pathTracerStatus.samples} spp`
                  : 'Building…'
                : ''}
            </span>
          )}
        </div>

        {/* View mode - drives the raw live camera transform directly,
            bypassing cameraStore entirely, so it would silently do nothing
            useful (or feel broken) against a locked Angle Hunt camera. */}
        {workspaceMode === '360' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-dim)',
              }}
            >
              VIEW
            </span>
            <select
              className="field-select"
              value={viewMode}
              onChange={(e) => handleViewModeChange(e.target.value)}
              style={{ width: 90, height: 22, fontSize: 10 }}
            >
              <option value="perspective">Perspective</option>
              <option value="front">Front</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
            </select>
          </div>
        )}
      </div>

      {/* Right: Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flex: 1,
          justifyContent: 'flex-end',
        }}
      >
        {/* Grid toggle */}
        <button
          className={`btn-icon ${showGrid ? 'active' : ''}`}
          onClick={toggleGrid}
          title="Toggle Grid"
          aria-label="Toggle Grid"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M0 3.5h14M0 7h14M0 10.5h14M3.5 0v14M7 0v14M10.5 0v14" />
          </svg>
        </button>

        {/* Environment toggle */}
        <button
          className={`btn-icon ${environment.showBackground ? 'active' : ''}`}
          onClick={toggleBackground}
          title="Toggle Environment"
          aria-label="Toggle Environment"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 1.5v11M1.5 7h11" />
            <path d="M2.5 3.5l9 7M11.5 3.5l-9 7" opacity="0.4" />
          </svg>
        </button>

        {/* Turntable play/pause */}
        <button
          className={`btn-icon ${turntable.active ? 'active' : ''}`}
          onClick={toggleTurntable}
          title="Toggle Turntable"
          aria-label="Toggle Turntable"
        >
          {turntable.active ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1.5" width="3" height="11" rx="0.5" />
              <rect x="9" y="1.5" width="3" height="11" rx="0.5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3.5 1.5l8 5.5-8 5.5z" />
            </svg>
          )}
        </button>

        {/* Speed slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: 70 }}>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={turntable.speed}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            style={{ width: '100%', height: 3 }}
            title={`Turntable Speed: ${turntable.speed.toFixed(1)}x`}
          />
          <span style={{ fontSize: 9, color: 'var(--text-dim)', minWidth: 24, textAlign: 'right' }}>
            {turntable.speed.toFixed(1)}x
          </span>
        </div>

        {/* Resolution display */}
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            marginLeft: 4,
          }}
        >
          {resolution.width}×{resolution.height}
        </span>

        {/* Screenshot button */}
        <button
          className="btn-icon"
          onClick={onScreenshot}
          title="Screenshot"
          aria-label="Take Screenshot"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="3" width="11" height="8" rx="1" />
            <circle cx="7" cy="7" r="2" />
            <path d="M5 3V2a1 1 0 011-1h2a1 1 0 011 1v1" />
          </svg>
        </button>

        {/* Viewport Design panel toggle */}
        <button
          className={`btn-icon ${useUIStore.getState().panelVisibility.viewportDesign ? 'active' : ''}`}
          onClick={() => useUIStore.getState().togglePanel('viewportDesign')}
          title="Viewport Design"
          aria-label="Toggle Viewport Design"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
            <circle cx="5" cy="5.5" r="1.5" />
            <circle cx="9" cy="5.5" r="1.5" />
            <circle cx="7" cy="8.5" r="1.5" />
          </svg>
        </button>

        {/* Settings button */}
        <button
          className="btn-icon"
          onClick={() => setSettingsModal(true)}
          title="Settings"
          aria-label="Open Settings"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="7" cy="7" r="2" />
            <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4" />
          </svg>
        </button>
      </div>
    </div>
  );
};