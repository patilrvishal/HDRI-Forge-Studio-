import * as THREE from 'three';
import type { RenderPipeline } from './engine';

// ── Render job types ───────────────────────────────────────────────────────

export interface RenderJobOptions {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  jpegQuality: number; // 0-1
  transparent: boolean;
}

export interface RenderJobResult {
  dataURL: string;
  width: number;
  height: number;
  format: string;
  timestamp: number;
  durationMs: number;
}

export type RenderJobStatus = 'idle' | 'rendering' | 'done' | 'error';

export interface RenderJobState {
  status: RenderJobStatus;
  progress: number;    // 0-100
  result: RenderJobResult | null;
  error: string | null;
  startTime: number;
}

// ── RenderJob ──────────────────────────────────────────────────────────────

export class RenderJob {
  private _pipeline: RenderPipeline;
  private _state: RenderJobState = {
    status: 'idle',
    progress: 0,
    result: null,
    error: null,
    startTime: 0,
  };
  private _listeners: Set<(state: RenderJobState) => void> = new Set();
  private _cancelled = false;

  constructor(pipeline: RenderPipeline) {
    this._pipeline = pipeline;
  }

  get state(): Readonly<RenderJobState> {
    return this._state;
  }

  subscribe(listener: (state: RenderJobState) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      listener({ ...this._state });
    }
  }

  cancel(): void {
    this._cancelled = true;
  }

  /**
   * Execute a high-quality render at the specified resolution.
   * Temporarily resizes the renderer, renders one frame, captures, then restores.
   */
  async execute(options: RenderJobOptions): Promise<RenderJobResult> {
    const sm = (this._pipeline as unknown as {
      _sm: {
        renderer: THREE.WebGLRenderer;
        scene: THREE.Scene;
        camera: THREE.Camera;
        resize: () => void;
        container: HTMLElement | null;
      };
    })._sm;

    const renderer = sm.renderer;
    this._cancelled = false;

    // ── Save state ─────────────────────────────────────────────────────────
    const currentSize = new THREE.Vector2();
    renderer.getSize(currentSize);
    const currentPixelRatio = renderer.getPixelRatio();
    const originalBackground = sm.scene.background;

    this._state = {
      status: 'rendering',
      progress: 0,
      result: null,
      error: null,
      startTime: performance.now(),
    };
    this._notify();

    // ── Compute dimensions ─────────────────────────────────────────────────
    const maxTexSize = renderer.getContext().getParameter(
      renderer.getContext().MAX_TEXTURE_SIZE,
    ) ?? 8192;
    const targetW = Math.min(options.width, maxTexSize);
    const targetH = Math.min(options.height, maxTexSize);

    // ── Apply transparent background ───────────────────────────────────────
    if (options.transparent) {
      sm.scene.background = null;
    }

    // ── Resize for capture ────────────────────────────────────────────────
    this._state.progress = 20;
    this._notify();

    renderer.setPixelRatio(1);
    renderer.setSize(targetW, targetH, false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipelineAny = this._pipeline as any;
    const composer = typeof pipelineAny.getComposer === 'function' ? pipelineAny.getComposer() : null;
    if (composer) {
      composer.setSize(targetW, targetH);
    }

    // Update camera aspect
    let originalAspect: number | undefined;
    if (sm.camera instanceof THREE.PerspectiveCamera) {
      originalAspect = sm.camera.aspect;
      sm.camera.aspect = targetW / targetH;
      sm.camera.updateProjectionMatrix();
    }

    // ── Render frame ──────────────────────────────────────────────────────
    this._state.progress = 60;
    this._notify();

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        this._pipeline.render();
        resolve();
      });
    });

    if (this._cancelled) {
      // Restore and abort
      this._restore(sm, renderer, composer, currentSize, currentPixelRatio, originalBackground, originalAspect);
      this._state = { status: 'idle', progress: 0, result: null, error: null, startTime: 0 };
      this._notify();
      throw new Error('Render cancelled');
    }

    // ── Capture ───────────────────────────────────────────────────────────
    this._state.progress = 80;
    this._notify();

    const mimeType = options.format === 'jpeg' ? 'image/jpeg' : options.format === 'webp' ? 'image/webp' : 'image/png';
    const quality = options.format !== 'png' ? options.jpegQuality : undefined;
    const dataURL = renderer.domElement.toDataURL(mimeType, quality);

    // ── Restore state ─────────────────────────────────────────────────────
    this._restore(sm, renderer, composer, currentSize, currentPixelRatio, originalBackground, originalAspect);

    const durationMs = performance.now() - this._state.startTime;

    const result: RenderJobResult = {
      dataURL,
      width: targetW,
      height: targetH,
      format: options.format,
      timestamp: Date.now(),
      durationMs,
    };

    this._state = {
      status: 'done',
      progress: 100,
      result,
      error: null,
      startTime: this._state.startTime,
    };
    this._notify();

    return result;
  }

  /**
   * Multi-angle render: renders from all saved camera positions.
   * Each position is defined by [x, y, z] and [targetX, targetY, targetZ].
   */
  async executeMultiAngle(
    options: RenderJobOptions,
    angles: Array<{ name: string; position: [number, number, number]; target: [number, number, number]; fov?: number }>,
    onProgress?: (current: number, total: number, angleName: string) => void,
  ): Promise<RenderJobResult[]> {
    const results: RenderJobResult[] = [];

    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];

      this._state = {
        status: 'rendering',
        progress: (i / angles.length) * 100,
        result: null,
        error: null,
        startTime: performance.now(),
      };
      this._notify();

      onProgress?.(i + 1, angles.length, angle.name);

      const result = await this.execute({ ...options });
      // Tag the result with the angle name
      (result as { angleName?: string }).angleName = angle.name;
      results.push(result);
    }

    return results;
  }

  private _restore(
    sm: { camera: THREE.Camera; scene: THREE.Scene; resize: () => void },
    renderer: THREE.WebGLRenderer,
    composer: { setSize: (w: number, h: number) => void } | null | undefined,
    currentSize: THREE.Vector2,
    currentPixelRatio: number,
    originalBackground: THREE.Color | THREE.Texture | null,
    originalAspect: number | undefined,
  ): void {
    if (sm.camera instanceof THREE.PerspectiveCamera && originalAspect !== undefined) {
      sm.camera.aspect = originalAspect;
      sm.camera.updateProjectionMatrix();
    }

    renderer.setPixelRatio(currentPixelRatio);
    renderer.setSize(currentSize.x, currentSize.y, false);
    if (composer) composer.setSize(currentSize.x, currentSize.y);

    sm.scene.background = originalBackground;
    sm.resize();
  }

  static downloadResult(result: RenderJobResult, filename?: string): void {
    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    const name = filename ?? `lightforge_render_${result.width}x${result.height}.${ext}`;
    const link = document.createElement('a');
    link.href = result.dataURL;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 200);
  }
}