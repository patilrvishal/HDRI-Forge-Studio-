import React, { useRef, useState, useCallback, useEffect } from 'react';
import { TopMenubar } from '../Toolbar/TopMenubar';
import { LeftToolbar } from '../Toolbar/LeftToolbar';
import { Viewport } from '../Viewport/Viewport';
import { LightListPanel } from '../Lights/LightListPanel';
import { LightProfileGrid } from '../Lights/LightProfileGrid';
import { DynamicPropertiesPanel } from '../Properties/DynamicPropertiesPanel';
import { PresetBrowser } from '../Presets/PresetBrowser';
import { LightPreview } from '../Previews/LightPreview';
import { MaterialPreviewTab, getMaterialPreviewThumbnail } from '../Previews/MaterialPreviewTab';
import { MaterialEditorPanel } from '../Materials/MaterialEditorPanel';
import { ViewportDesignPanel } from '../Viewport/ViewportDesignPanel';
import { RenderSettingsPanel } from '../Settings/RenderSettingsPanel';
import { ResizeHandle } from '../UI/ResizeHandle';
import { ErrorBoundary } from '../UI/ErrorBoundary';
import { useUIStore, type PanelKey } from '../../store/uiStore';
import { useSceneStore } from '../../store/sceneStore';
import { useLightsStore } from '../../store/lightsStore';
import { useUILayoutStore } from '../../store/uiLayoutStore';
import { useHistoryStore } from '../../store/historyStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { TimelinePanel } from '../Timeline/TimelinePanel';
import { CameraPanel } from '../Viewport/CameraPanel';
import { useSceneHierarchyStore } from '../../store/sceneHierarchyStore';

/** Wireframe box glyph shown before the active "Properties" tab label. */
function CubeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="tab-icon" style={{ marginRight: 6, flexShrink: 0 }}>
      <path
        d="M8 1.5L14 5V11L8 14.5L2 11V5L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M2 5L8 8.5L14 5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 8.5V14.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function SceneCameraSlot() {
  const filterType = useSceneHierarchyStore((s) => s.filterType);
  if (filterType !== 'camera') return null;
  return <CameraPanel />;
}
import { GradientBackgroundPanel } from '../Environment/GradientBackgroundPanel';
import { HDRIPreviewPanel } from '../HDRI/HDRIPreviewPanel';
import { ExportDialog } from '../Export/ExportDialog';
import { FinalRenderPanel } from '../Export/FinalRenderPanel';
import { EnvironmentBrowser } from '../Environment/EnvironmentBrowser';
import { EnvironmentAssetsPanel } from '../Environment/EnvironmentAssetsPanel';
import { SceneHierarchy } from '../Scene/SceneHierarchy';
import { ManualWindow } from '../Help/ManualWindow';
import { SceneManager, RenderPipeline } from '../../three/engine';
import { SceneExporter } from '../../three/SceneExporter';
import { MaterialManager } from '../../three/MaterialManager';
import * as THREE from 'three';


/** Inline wrapper: Light Profile grid section below the light list */
const LightProfileSection: React.FC = () => {
  const lights = useLightsStore((s) => s.lights);
  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const selectLight = useLightsStore((s) => s.selectLight);

  if (lights.length === 0) return null;

  return (
    <div className="light-profile-section">
      <div className="light-profile-section-title">Light Profiles</div>
      <LightProfileGrid
        lights={lights.map((l) => ({ id: l.id, type: l.type, color: l.color, name: l.name }))}
        selectedLightId={selectedLightId}
        onSelectLight={selectLight}
      />
    </div>
  );
};

/** Small close (Ã—) button for panel headers */
const PanelCloseButton: React.FC<{ panel: PanelKey }> = ({ panel }) => (
  <button
    className="btn-icon panel-close-btn"
    onClick={() => useUIStore.getState().hidePanel(panel)}
    title="Close panel"
    aria-label="Close panel"
    style={{ width: 18, height: 18, opacity: 0.5, flexShrink: 0 }}
  >
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2l6 6M8 2l-6 6" />
    </svg>
  </button>
);

export const AppLayout: React.FC = () => {
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const envMapRef = useRef<THREE.Texture | null>(null);

  // Left panel tab state
  const [leftTab, setLeftTab] = useState<'lights' | 'environment' | 'scene'>('lights');

  // Resizable panel sizes from store
  const leftPanelWidth = useUILayoutStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useUILayoutStore((s) => s.rightPanelWidth);
  const bottomPanelHeight = useUILayoutStore((s) => s.bottomPanelHeight);
  const setLeftPanelWidth = useUILayoutStore((s) => s.setLeftPanelWidth);
  const setRightPanelWidth = useUILayoutStore((s) => s.setRightPanelWidth);
  const setBottomPanelHeight = useUILayoutStore((s) => s.setBottomPanelHeight);
  const resetLayout = useUILayoutStore((s) => s.resetToDefaults);

  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen);
  const focusMode = useUIStore((s) => s.focusMode);
  const panelVisibility = useUIStore((s) => s.panelVisibility);
  const settingsModalOpen = useUIStore((s) => s.settingsModalOpen);
  const aboutModalOpen = useUIStore((s) => s.aboutModalOpen);
  const manualModalOpen = useUIStore((s) => s.manualModalOpen);
  const envBrowserOpen = useUIStore((s) => s.envBrowserModalOpen);
  const setSettingsModal = useUIStore((s) => s.setSettingsModal);
  const setAboutModal = useUIStore((s) => s.setAboutModal);
  const setEnvBrowserModal = useUIStore((s) => s.setEnvBrowserModal);
  const setManualModal = useUIStore((s) => s.setManualModal);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const toggleTurntable = useSceneStore((s) => s.toggleTurntable);

  // Bottom panel section visibility
  const timelineVisible = panelVisibility.timelineSection;
  const presetsVisible = panelVisibility.presetsSection;
  const viewportDesignVisible = panelVisibility.viewportDesign;

  // Bottom panel: side-by-side tabs (mutually exclusive)
  const [bottomTab, setBottomTab] = useState<'hdri' | 'timeline' | 'presets'>('hdri');

  // History state for status bar
  const undoCount = useHistoryStore((s) => s.undoStack.length);
  const redoCount = useHistoryStore((s) => s.redoStack.length);

  const [rightTab, setRightTab] = useState<'properties' | 'preview' | 'material' | 'matEdit'>('properties');
  const storeRightTab = useUIStore((s) => s.rightPanelTab);

  // Sync right tab from store (e.g. viewport click sets it to 'matEdit')
  useEffect(() => {
    if (storeRightTab && storeRightTab !== rightTab) {
      setRightTab(storeRightTab);
    }
  }, [storeRightTab]);
  const [, setScreenshotUrl] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [finalRenderOpen, setFinalRenderOpen] = useState(false);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);
  const materialManagerRef = useRef<MaterialManager | null>(null);

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
    link.download = `lightforge-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, []);

  // Export image handler
  const handleExportImage = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  // Final render handler
  const handleFinalRender = useCallback(() => {
    setFinalRenderOpen(true);
  }, []);

  // Pass renderPipeline ref from Viewport to ExportDialog
  const handleViewportReady = useCallback((rp: RenderPipeline | null, mm: MaterialManager | null) => {
    renderPipelineRef.current = rp;
    materialManagerRef.current = mm;
    sceneRef.current = sceneManagerRef.current?.scene ?? null;
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onSave: () => {
      // Ctrl+S must do what the Project menu advertises next to this shortcut:
      // write an actual scene FILE. It previously ran quickSave(), which only
      // touched localStorage - invisible on success, and silently dropped
      // entirely once an embedded model pushed it past the storage quota, so
      // Ctrl+S looked completely dead.
      const ui = useUIStore.getState();
      try {
        const data = SceneExporter.exportScene();
        SceneExporter.downloadSceneFile(data);
        // Keep the session-recovery copy too, best-effort.
        SceneExporter.quickSave();
        ui.showToast('Scene saved', 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[LightForge] Save failed:', err);
        ui.showToast(`Save failed: ${msg}`, 'error');
      }
    },
    onOpen: () => {
      const ui = useUIStore.getState();
      const hist = useHistoryStore.getState();
      hist.pause();
      const data = SceneExporter.quickLoad();
      if (!data) {
        hist.resume();
        ui.showToast('No auto-saved scene found. Use Project > Open Scene.', 'info');
        return;
      }
      const error = SceneExporter.importScene(data);
      hist.resume();
      if (error) {
        ui.showToast(error, 'error');
      } else {
        if (sceneManagerRef.current) {
          sceneManagerRef.current.setCameraState(
            data.scene.camera.position,
            data.scene.camera.target,
            data.scene.camera.fov,
          );
        }
        ui.showToast('Scene restored', 'success');
      }
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
      <TopMenubar sceneManagerRef={sceneManagerRef} onExportImage={handleExportImage} onFinalRender={handleFinalRender} />

      {/* Main body */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Left Toolbar (fixed width) */}
        <LeftToolbar sceneManagerRef={sceneManagerRef} />

        {/* Left Panel - Light List (resizable, smooth transition) */}
        <div
          className="panel-transition"
          style={{
            width: leftPanelOpen ? leftPanelWidth : 0,
            opacity: leftPanelOpen ? 1 : 0,
            pointerEvents: leftPanelOpen ? 'auto' : 'none',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <div
            className="panel panel-glow border-light-effect"
            style={{
              width: leftPanelWidth,
              flexShrink: 0,
              overflow: 'hidden',
              borderRight: 'none',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="panel-header">
              <h3>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.6 }}>
                  <circle cx="5" cy="5" r="3" />
                </svg>
                {leftTab === 'lights' ? 'Light List' : leftTab === 'environment' ? 'Environment' : 'Scene Hierarchy'}
              </h3>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {leftTab === 'lights' && (
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
                )}
                <PanelCloseButton panel="leftPanel" />
              </div>
            </div>

            {/* Tab bar */}
            <div className="tab-bar tab-bar-purple" style={{ flexShrink: 0 }}>
              {(['lights', 'environment', 'scene'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`tab-item ${leftTab === tab ? 'active' : ''}`}
                  onClick={() => setLeftTab(tab)}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {tab === 'lights' ? 'Lights' : tab === 'environment' ? 'Env' : 'Scene'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {leftTab === 'lights' ? (
                <>
                  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <LightListPanel />
                  </div>
                  <LightProfileSection />
                </>
              ) : leftTab === 'environment' ? (
                <>
                  <EnvironmentAssetsPanel />
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                    <GradientBackgroundPanel />
                  </div>
                </>
              ) : (
                <ErrorBoundary>
                  <SceneHierarchy sceneRef={sceneRef} />
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                    <SceneCameraSlot />
                  </div>
                </ErrorBoundary>
              )}
            </div>
          </div>
        </div>

        {/* Left resize handle */}
        {leftPanelOpen && (
          <ResizeHandle
            direction="horizontal"
            side="left"
            onResize={(newSize) => setLeftPanelWidth(newSize)}
            getCurrentSize={() => leftPanelWidth}
            minSize={150}
            maxSize={500}
            onDoubleClick={() => setLeftPanelWidth(220)}
          />
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
              flex: 1,
              overflow: 'hidden',
              minWidth: 0,
              minHeight: 0,
              position: 'relative',
            }}
          >
            <ErrorBoundary>
              <Viewport sceneManagerRef={sceneManagerRef} onScreenshot={handleScreenshot} onReady={handleViewportReady} />
            </ErrorBoundary>

            {/* Viewport Design Panel - floating overlay */}
            {viewportDesignVisible && !focusMode && <ViewportDesignPanel />}

            {/* Focus mode hint overlay */}
            {focusMode && (
              <div className="focus-hint">
                Press F to exit focus mode
              </div>
            )}
          </div>

          {/* Bottom resize handle */}
          {bottomPanelOpen && (
            <ResizeHandle
              direction="vertical"
              side="top"
              onResize={(newSize) => setBottomPanelHeight(newSize)}
              getCurrentSize={() => bottomPanelHeight}
              minSize={100}
              maxSize={400}
              onDoubleClick={() => setBottomPanelHeight(240)}
            />
          )}

          {/* Bottom panel (smooth height transition, tabbed) */}
          <div
            className="panel-transition"
            style={{
              height: bottomPanelOpen ? bottomPanelHeight : 0,
              opacity: bottomPanelOpen ? 1 : 0,
              pointerEvents: bottomPanelOpen ? 'auto' : 'none',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <div
              className="panel panel-glow border-light-effect"
              style={{
                height: bottomPanelHeight,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Tab bar */}
              <div
                style={{
                  background: 'var(--bg-deep)',
                  borderBottom: '2px solid var(--border-light)',
                  boxShadow: '0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -4px 6px -4px rgba(0, 0, 0, 0.55)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <div className="tab-bar tab-bar-purple" style={{ flex: 1, background: 'none', boxShadow: 'none' }}>
                  <div
                    className={`tab-item ${bottomTab === 'hdri' ? 'active' : ''}`}
                    onClick={() => setBottomTab('hdri')}
                  >
                    HDRI Preview
                  </div>
                  <div
                    className={`tab-item ${bottomTab === 'timeline' ? 'active' : ''}`}
                    onClick={() => setBottomTab('timeline')}
                  >
                    Timeline
                  </div>
                  <div
                    className={`tab-item ${bottomTab === 'presets' ? 'active' : ''}`}
                    onClick={() => setBottomTab('presets')}
                  >
                    Presets
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2, padding: '0 6px 0 0', flexShrink: 0 }}>
                  <PanelCloseButton panel="timelineSection" />
                  <PanelCloseButton panel="presetsSection" />
                </div>
              </div>

              {/* Tab content - mutually exclusive, full width */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {bottomTab === 'hdri' && <HDRIPreviewPanel />}
                {bottomTab === 'timeline' && <TimelinePanel />}
                {bottomTab === 'presets' && <PresetBrowser onGenerateThumbnail={handleGenerateThumbnail} />}
              </div>
            </div>
          </div>
        </div>

        {/* Right resize handle */}
        {rightPanelOpen && (
          <ResizeHandle
            direction="horizontal"
            side="right"
            onResize={(newSize) => setRightPanelWidth(newSize)}
            getCurrentSize={() => rightPanelWidth}
            minSize={200}
            maxSize={500}
            onDoubleClick={() => setRightPanelWidth(320)}
          />
        )}

        {/* Right Panel (resizable, smooth transition) */}
        <div
          className="panel-transition"
          style={{
            width: rightPanelOpen ? rightPanelWidth : 0,
            opacity: rightPanelOpen ? 1 : 0,
            pointerEvents: rightPanelOpen ? 'auto' : 'none',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <div
            className="panel panel-glow border-light-effect properties-card-frame"
            style={{
              width: rightPanelWidth,
              flexShrink: 0,
              overflow: 'hidden',
              borderLeft: 'none',
            }}
          >
            {/* Tab bar with close button */}
            <div
              style={{
                background: 'var(--bg-deep)',
                borderBottom: '2px solid var(--border-light)',
                boxShadow: '0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -4px 6px -4px rgba(0, 0, 0, 0.55)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <div className="tab-bar tab-bar-purple" style={{ flex: 1, background: 'none', boxShadow: 'none' }}>
                <div
                  className={`tab-item ${rightTab === 'properties' ? 'active' : ''}`}
                  onClick={() => setRightTab('properties')}
                >
                  <CubeIcon />
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
                <div
                  className={`tab-item ${rightTab === 'matEdit' ? 'active' : ''}`}
                  onClick={() => setRightTab('matEdit')}
                >
                  Mat Edit
                </div>
              </div>
              <div style={{ padding: '0 6px 0 0', flexShrink: 0 }}>
                <PanelCloseButton panel="rightPanel" />
              </div>
            </div>

            {/* Tab content */}
            <div className="panel-body" style={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
              {rightTab === 'properties' && (
                <div className="glossy-3d-trial" style={{ flex: 1, overflow: 'hidden' }}>
                  <ErrorBoundary>
                    <DynamicPropertiesPanel sceneRef={sceneRef} />
                  </ErrorBoundary>
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
              {rightTab === 'matEdit' && (
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <MaterialEditorPanel
                    materialManagerRef={materialManagerRef}
                    sceneRef={sceneRef}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
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
          background: 'linear-gradient(90deg, var(--bg-deep), rgba(34, 211, 238,0.02), var(--bg-deep))',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <span>
            {undoCount > 0 ? `Undo: ${undoCount}` : 'Undo: -'}
          </span>
          <span>
            {redoCount > 0 ? `Redo: ${redoCount}` : 'Redo: -'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span>LightForge Studio <span style={{ color: 'var(--accent)' }}>v2.0</span></span>
          <span>Phase 12</span>
        </div>
      </div>

      {/* Export Dialog (Phase 6) */}
      {exportDialogOpen && (
        <ExportDialog
          renderPipeline={renderPipelineRef.current}
          onClose={() => setExportDialogOpen(false)}
        />
      )}

      {/* Final Render Panel (Phase 12) */}
      {finalRenderOpen && (
        <FinalRenderPanel
          renderPipeline={renderPipelineRef.current}
          sceneManagerRef={sceneManagerRef}
          onClose={() => setFinalRenderOpen(false)}
        />
      )}

      {/* Settings Modal */}
      {settingsModalOpen && <RenderSettingsPanel onClose={() => setSettingsModal(false)} />}

      {/* Environment Browser Modal */}
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
            <div style={{ fontSize: 16, fontWeight: 700, background: 'var(--neon-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 4 }}>
              LightForge Studio
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 8 }}>
              3D Car Lighting Studio
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Version 1.0.0
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

      {/* Manual / Documentation Modal */}
      {manualModalOpen && <ManualWindow onClose={() => setManualModal(false)} />}

      {/* Transient status toast (save / load / export feedback) */}
      <StatusToast />
    </div>
  );
};

/** Bottom-centre status message. Silent saves were indistinguishable from
 *  broken ones, so every save/load path now reports through here. */
const StatusToast: React.FC = () => {
  const toast = useUIStore((s) => s.toast);
  if (!toast) return null;

  const accent =
    toast.kind === 'error' ? 'var(--danger)'
    : toast.kind === 'success' ? 'var(--success)'
    : 'var(--accent)';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 34,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '70vw',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'var(--bg-elevated)',
        border: `1px solid ${accent}`,
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        color: 'var(--text)',
        fontSize: 11.5,
        fontWeight: 500,
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
      <span>{toast.message}</span>
    </div>
  );
};