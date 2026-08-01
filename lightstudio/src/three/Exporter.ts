import * as THREE from 'three';

export class Exporter {
  /**
   * Exports the current canvas content as a PNG data URL.
   * If width/height are provided, temporarily resizes the renderer
   * (the caller must re-render before calling this for the new size to take effect).
   * Default resolution uses the renderer's current pixel ratio.
   */
  static exportPNG(
    renderer: THREE.WebGLRenderer,
    width?: number,
    height?: number,
  ): string {
    const currentSize = new THREE.Vector2();
    renderer.getSize(currentSize);
    const currentPixelRatio = renderer.getPixelRatio();

    // If custom dimensions are specified, temporarily resize
    if (width !== undefined && height !== undefined) {
      // Set pixel ratio to 1 so we control exact pixel output
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
    }

    const dataURL = renderer.domElement.toDataURL('image/png');

    // Restore original size if we changed it
    if (width !== undefined && height !== undefined) {
      renderer.setPixelRatio(currentPixelRatio);
      renderer.setSize(currentSize.x, currentSize.y, false);
    }

    return dataURL;
  }

  /**
   * Exports the current canvas content as a JPEG data URL.
   * Quality ranges from 0 to 1, default 0.92.
   */
  static exportJPEG(
    renderer: THREE.WebGLRenderer,
    quality: number = 0.92,
  ): string {
    return renderer.domElement.toDataURL('image/jpeg', quality);
  }

  /**
   * Triggers a browser download of a data URL with the given filename.
   * Creates a temporary anchor element, clicks it, and cleans up.
   */
  static downloadDataURL(dataURL: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    // Cleanup after a short delay to ensure the download initiates
    setTimeout(() => {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    }, 100);
  }

  /**
   * Performs a single render and captures the viewport as a PNG data URL.
   * Useful for quick screenshots without relying on the animation loop.
   */
  static captureViewport(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): string {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }
}