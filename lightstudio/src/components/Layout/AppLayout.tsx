import React, { useRef, useState, useCallback, useEffect } from 'react';
import { TopMenubar } from '../Toolbar/TopMenubar';
import { LeftToolbar } from '../Toolbar/LeftToolbar';
import { Viewport } from '../Viewport/Viewport';
import { LightListPanel } from '../Lights/LightListPanel';
import { LightProperties } from '../Lights/LightProperties';
import { PresetBrowser } from '../Presets/PresetBrowser';
import { LightPreview } from '../Previews/LightPreview';
import { MaterialPreviewTab, getMaterialPreviewThumbnail } from '../Previews/MaterialPreviewTab';
import { RenderSettingsPanel } from '../Settings/RenderSettingsPanel';
import { useUIStore } from '../../store/uiStore';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { usePresetsStore } from '../../store/presetsStore';
import { useHistoryStore } from '../../store/historyStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { TimelinePanel } from '../Timeline/TimelinePanel';
import { ExportDialog } from '../Export/ExportDialog';
import { EnvironmentBrowser } from '../Environment/EnvironmentBrowser';
import { SceneManager, RenderPipeline } from '../../three/engine';
import { SceneExporter } from '../../three/SceneExporter';
import * as THREE from 'three';

const LEFT_PANEL_WIDTH = 220;
const RIGHT_PANEL_WIDTH = 320;
const BOTTOM_PANEL_HEIGHT = 240;


export const AppLayout: React.FC = () => {
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const envMapRef = useRef<THREE.Texture | null>(null);

  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen);
  const settingsModalOpen = useUIStore((s) => s.settingsModalOpen);
  const aboutModalOpen = useUIStore((s) => s.aboutModalOpen);
  const envBrowserOpen = useUIStore((s) => s.envBrowserModalOpen);
  const setSettingsModal = useUIStore((s) => s.setSettingsModal);
  const setAboutModal = useUIStore((s) => s.setAboutModal);
  const setEnvBrowserModal = useUIStore((s) => s.setEnvBrowserModal);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const toggleTurntable = useSceneStore((s) => s.toggleTurntable);

  // History state for status bar
  const undoCount = useHistoryStore((s) => s.undoStack.length);
  const redoCount = useHistoryStore((s) => s.redoStack.length);

  const [rightTab, setRightTab] = useState<'properties' | 'preview' | 'material'>('properties');
  const [, setScreenshotUrl] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);

  // Generate studio env map on mount for material preview
  useEffect(() => {
    const createEnvForPreview = async () => {
      // Env map setup when scene manager is ready
    };
    createEnvForPreview().catch(() => {});
  }, []);

  // Thumbnail generator callback for PresetBrowser
  const handleGenerateThumbnail = useCallback((lights: Parameters<typeof getMaterialPreviewThumbnail>[0]) => {
    return getMaterialPreviewThumbnail(lights);
  }, []);

  // Screenshot handler
  const handleScreenshot = useCallback((dataUrl: string) => {
    setScreenshotUrl(dataUrl);
    const link = document.createElement('a');
    link.download = `lightstudio-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, []);

  // Export image handler
  const handleExportImage = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  // Pass renderPipeline ref from Viewport to ExportDialog
  const handleViewportReady = useCallback((rp: RenderPipeline | null) => {
    renderPipelineRef.current = rp;
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onSave: () => {
      // Quick save to localStorage via SceneExporter
      SceneExporter.quickSave();
    },
    onOpen: () => {
      // Quick load from localStorage via SceneExporter
      // Pause history during import to avoid recording the restore as an undo point
      const hist = useHistoryStore.getState();
      hist.pause();
      const data = SceneExporter.quickLoad();
      if (!data) {
        hist.resume();
        return;
      }
      const error = SceneExporter.importScene(data);
      hist.resume();
      if (!error && sceneManagerRef.current) {
        sceneManagerRef.current.setCameraState(
          data.scene.camera.position,
          data.scene.camera.target,
          data.scene.camera.fov,
        );
      }
      // Clear history after full scene load
      useHistoryStore.getState().clear();
    },
    onUndo: () => {
      useHistoryStore.getState().undo();
    },
    onRedo: () => {
      useHistoryStore.getState().redo();
    },
    onDelete: () => {
      const id = useLightsStore.getState().selectedLightId;
      if (id) useLightsStore.getState().removeLight(id);
    },
    setActiveTool,
    onFrameAll: () => {
      sceneManagerRef.current?.animateCameraTo([5, 3, 5], [0, 0.5, 0], 500);
    },
    toggleIsolate: () => setActiveTool('isolate'),
    toggleVisibility: () => {
      const id = useLightsStore.getState().selectedLightId;
      if (id) useLightsStore.getState().toggleLightVisibility(id);
    },
    toggleTurntable,
    toggleFullscreen,
    setViewMode: (mode: string) => {
      const presets: Record<string, [number, number, number]> = {
        front: [0, 1.5, 8],
        right: [8, 1.5, 0],
        top: [0, 8, 0.01],
        perspective: [5, 3, 5],
      };
      const target: [number, number, number] = mode === 'top' ? [0, 0, 0] : [0, 0.5, 0];
      const pos = presets[mode];
      if (pos) {
        sceneManagerRef.current?.animateCameraTo(pos, target, 500);
      }
    },
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--bg-deep)',
        overflow: 'hidden',
      }}
    >
      {/* Top Menu Bar */}
      <TopMenubar sceneManagerRef={sceneManagerRef} onExportImage={handleExportImage} />

      {/* Main body */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Left Toolbar */}
        <LeftToolbar sceneManagerRef={sceneManagerRef} />

        {/* Left Panel — Light List */}
        {leftPanelOpen && (
          <div
            className="panel"
            style={{
              width: LEFT_PANEL_WIDTH,
              borderRight: '1px solid var(--border)',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <div className="panel-header">
              <h3>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.6 }}>
                  <circle cx="5" cy="5" r="3" />
                </svg>
                Light List
              </h3>
              <button
                className="btn-icon"
                style={{ width: 20, height: 20 }}
                onClick={() => useLightsStore.getState().addLight()}
                title="Add Light"
                aria-label="Add Light"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 1v10M1 6h10" />
                </svg>
              </button>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <LightListPanel />
            </div>
          </div>
        )}

        {/* Center: Viewport + Bottom panels */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {/* Viewport area */}
          <div
            style={{
              flex: bottomPanelOpen ? 1 : 1,
              overflow: 'hidden',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <Viewport sceneManagerRef={sceneManagerRef} onScreenshot={handleScreenshot} onReady={handleViewportReady} />
          </div>

          {/* Bottom panels */}
          {bottomPanelOpen && (
            <div
              style={{
                height: BOTTOM_PANEL_HEIGHT,
                display: 'flex',
                borderTop: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              {/* Bottom left: Timeline (Phase 5) */}
              <div
                className="panel"
                style={{
                  flex: 1,
                  borderRight: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <TimelinePanel />
              </div>

              {/* Bottom right: Preset Browser (Phase 3) */}
              <div
                className="panel"
                style={{
                  width: 300,
                  flexShrink: 0,
                }}
              >
                <div className="panel-header">
                  <h3>Presets</h3>
                </div>
                <PresetBrowser onGenerateThumbnail={handleGenerateThumbnail} />
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        {rightPanelOpen && (
          <div
            className="panel"
            style={{
              width: RIGHT_PANEL_WIDTH,
              borderLeft: '1px solid var(--border)',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {/* Tab bar */}
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="tab-bar">
                <div
                  className={`tab-item ${rightTab === 'properties' ? 'active' : ''}`}
                  onClick={() => setRightTab('properties')}
                >
                  Properties
                </div>
                <div
                  className={`tab-item ${rightTab === 'preview' ? 'active' : ''}`}
                  onClick={() => setRightTab('preview')}
                >
                  Light Prev
                </div>
                <div
                  className={`tab-item ${rightTab === 'material' ? 'active' : ''}`}
                  onClick={() => setRightTab('material')}
                >
                  Material
                </div>
              </div>
            </div>

            {/* Tab content */}
            <div className="panel-body" style={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
              {rightTab === 'properties' && (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <LightProperties />
                </div>
              )}
              {rightTab === 'preview' && (
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <LightPreview />
                </div>
              )}
              {rightTab === 'material' && (
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <MaterialPreviewTab envMap={envMapRef.current} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status bar (Phase 7) — shows undo/redo count */}
      <div
        className="status-bar"
        style={{
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          fontSize: 10,
          color: 'var(--text-dim)',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-deep)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <span>
            {undoCount > 0 ? `Undo: ${undoCount}` : 'Undo: —'}
          </span>
          <span>
            {redoCount > 0 ? `Redo: ${redoCount}` : 'Redo: —'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span>LightStudio v1.0.0</span>
          <span>Phase 9</span>
        </div>
      </div>

      {/* Export Dialog (Phase 6) */}
      {exportDialogOpen && (
        <ExportDialog
          renderPipeline={renderPipelineRef.current}
          onClose={() => setExportDialogOpen(false)}
        />
      )}

      {/* Settings Modal */}
      {settingsModalOpen && <RenderSettingsPanel onClose={() => setSettingsModal(false)} />}

      {/* Phase 9: Environment Browser Modal */}
      {envBrowserOpen && <EnvironmentBrowser onClose={() => setEnvBrowserModal(false)} />}

      {/* About Modal */}
      {aboutModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setAboutModal(false)}
        >
          <div
            className="context-menu"
            style={{
              minWidth: 260,
              padding: 16,
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
              LightStudio
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 8 }}>
              3D Car Lighting Studio
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Version 1.0.0 — Phase 9
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 12, padding: '4px 16px' }}
              onClick={() => setAboutModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};