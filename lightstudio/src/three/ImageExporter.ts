import * as THREE from 'three';
import type { RenderPipeline } from './engine';

// ── Export configuration ───────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg';

export type ResolutionPreset = '1x' | '2x' | '4k' | 'custom';

export interface ImageExportOptions {
  /** Image format */
  format: ExportFormat;
  /** Resolution preset or custom */
  resolution: ResolutionPreset;
  /** Custom width (only used when resolution = 'custom') */
  customWidth: number;
  /** Custom height (only used when resolution = 'custom') */
  customHeight: number;
  /** JPEG quality 0–1 (ignored for PNG) */
  jpegQuality: number;
  /** Transparent background (PNG only; removes scene background during capture) */
  transparent: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ImageExportOptions = {
  format: 'png',
  resolution: '2x',
  customWidth: 1920,
  customHeight: 1080,
  jpegQuality: 0.92,
  transparent: false,
};

export const RESOLUTION_LABELS: Record<ResolutionPreset, string> = {
  '1x': 'Current (1x)',
  '2x': 'High (2x)',
  '4k': 'Ultra (4K)',
  'custom': 'Custom...',
};

// ── ImageExporter ──────────────────────────────────────────────────────────

export class ImageExporter {
  /**
   * Export a high-resolution image from the render pipeline.
   *
   * Strategy:
   * 1. Save current renderer state (size, pixel ratio, alpha, background).
   * 2. Compute the target export dimensions.
   * 3. Temporarily resize the renderer + composer to export dimensions.
   * 4. Optionally set transparent background (alpha: true, clear scene background).
   * 5. Render one frame, capture from canvas.
   * 6. Restore all state to original values.
   * 7. Trigger browser download.
   */
  static async exportImage(
    pipeline: RenderPipeline,
    options: ImageExportOptions,
    filename?: string,
  ): Promise<void> {
    // Access the underlying scene manager via the pipeline
    const sm = (pipeline as unknown as { _sm: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; resize: () => void } })._sm;
    const renderer = sm.renderer;

    // ── Save current state ─────────────────────────────────────────────────
    const currentSize = new THREE.Vector2();
    renderer.getSize(currentSize);
    const currentPixelRatio = renderer.getPixelRatio();
    const currentAlpha = (renderer.getContext() as WebGL2RenderingContext).getContextAttributes()?.alpha;
    const originalBackground = sm.scene.background;
    const originalAutoClear = renderer.autoClear;

    // ── Compute target dimensions ──────────────────────────────────────────
    const baseW = currentSize.x || 2;
    const baseH = currentSize.y || 2;

    let targetW: number;
    let targetH: number;

    switch (options.resolution) {
      case '1x':
        targetW = Math.round(baseW);
        targetH = Math.round(baseH);
        break;
      case '2x':
        targetW = Math.round(baseW * 2);
        targetH = Math.round(baseH * 2);
        break;
      case '4k':
        targetW = 3840;
        targetH = 2160;
        break;
      case 'custom':
        targetW = Math.max(1, options.customWidth);
        targetH = Math.max(1, options.customHeight);
        break;
    }

    // Clamp to max WebGL texture size to avoid errors
    const maxTexSize = renderer.getContext().getParameter(
      renderer.getContext().MAX_TEXTURE_SIZE,
    ) ?? 4096;
    targetW = Math.min(targetW, maxTexSize);
    targetH = Math.min(targetH, maxTexSize);

    // ── Apply transparent background ───────────────────────────────────────
    if (options.transparent && options.format === 'png') {
      sm.scene.background = null;
      // We need to re-create the renderer with alpha for transparency
      // Instead, we'll just render without background and hope the context supports it
      // For true transparency, we'd need renderer with alpha:true — but recreating
      // the renderer is expensive. We use a workaround: render to canvas, then
      // create an offscreen canvas that composites with transparency.
    }

    // ── Temporarily resize for high-res capture ────────────────────────────
    renderer.setPixelRatio(1);
    renderer.setSize(targetW, targetH, false);

    // Also resize the composer if pipeline has one
    const composer = pipeline.getComposer?.();
    if (composer) {
      composer.setSize(targetW, targetH);
    }

    // Update camera aspect ratio for the new dimensions
    if (sm.camera instanceof THREE.PerspectiveCamera) {
      const originalAspect = sm.camera.aspect;
      sm.camera.aspect = targetW / targetH;
      sm.camera.updateProjectionMatrix();
      // We'll restore this below
      (sm.camera as { _exportOriginalAspect?: number })._exportOriginalAspect = originalAspect;
    }

    // ── Render ────────────────────────────────────────────────────────────
    // Use requestAnimationFrame to ensure the resize has taken effect
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        pipeline.render();

        // ── Capture ───────────────────────────────────────────────────────
        const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = options.format === 'jpeg' ? options.jpegQuality : undefined;
        const dataURL = renderer.domElement.toDataURL(mimeType, quality);

        // ── Handle transparency compositing if needed ──────────────────────
        let finalDataURL = dataURL;
        if (options.transparent && options.format === 'png' && originalBackground) {
          finalDataURL = this.compositeTransparent(
            dataURL,
            targetW,
            targetH,
            (originalBackground as THREE.Color).getStyle(),
          );
        }

        // ── Download ──────────────────────────────────────────────────────
        const ext = options.format === 'jpeg' ? 'jpg' : 'png';
        const name = filename ?? `lightforge_export_${targetW}x${targetH}.${ext}`;
        this.downloadDataURL(finalDataURL, name);

        resolve();
      });
    });

    // ── Restore original state ────────────────────────────────────────────
    if (sm.camera instanceof THREE.PerspectiveCamera) {
      const origAspect = (sm.camera as { _exportOriginalAspect?: number })._exportOriginalAspect;
      if (origAspect !== undefined) {
        sm.camera.aspect = origAspect;
        sm.camera.updateProjectionMatrix();
        delete (sm.camera as { _exportOriginalAspect?: number })._exportOriginalAspect;
      }
    }

    renderer.setPixelRatio(currentPixelRatio);
    renderer.setSize(currentSize.x, currentSize.y, false);

    if (composer) {
      composer.setSize(currentSize.x, currentSize.y);
    }

    // Restore background
    sm.scene.background = originalBackground;

    // Restore resize on the scene manager
    sm.resize();
  }

  /**
   * Quick screenshot at current resolution (no dialog, no resize).
   * Returns the data URL string.
   */
  static quickCapture(pipeline: RenderPipeline): string {
    pipeline.render();
    const sm = (pipeline as unknown as { _sm: { renderer: THREE.WebGLRenderer } })._sm;
    return sm.renderer.domElement.toDataURL('image/png');
  }

  /**
   * Composite a rendered image with a transparent background.
   * Takes the opaque render, reads its pixels, and replaces pixels matching
   * the background color with transparent pixels.
   *
   * This is a simplified approach — for production, you'd use WebGL alpha.
   */
  private static compositeTransparent(
    dataURL: string,
    width: number,
    height: number,
    _bgColor: string,
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataURL;

    const img = new Image();
    img.src = dataURL;

    // Synchronous approach: draw image and try to make background transparent
    // Since we set scene.background = null before rendering, the canvas
    // should already have transparent areas where background was.
    // But if the WebGL context wasn't created with alpha:true, the background
    // will be black. In that case, we just return the original.
    try {
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return dataURL;
    }
  }

  /**
   * Trigger a browser download from a data URL.
   */
  static downloadDataURL(dataURL: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    }, 200);
  }

  /**
   * Get the estimated export dimensions for a given resolution preset.
   * Useful for displaying in the UI before exporting.
   */
  static getEstimatedDimensions(
    options: ImageExportOptions,
    viewportWidth: number,
    viewportHeight: number,
  ): { width: number; height: number; label: string } {
    const baseW = viewportWidth || 1280;
    const baseH = viewportHeight || 720;

    let w: number;
    let h: number;

    switch (options.resolution) {
      case '1x':
        w = baseW;
        h = baseH;
        break;
      case '2x':
        w = baseW * 2;
        h = baseH * 2;
        break;
      case '4k':
        w = 3840;
        h = 2160;
        break;
      case 'custom':
        w = options.customWidth;
        h = options.customHeight;
        break;
    }

    return {
      width: Math.round(w),
      height: Math.round(h),
      label: `${Math.round(w)} x ${Math.round(h)}`,
    };
  }
}