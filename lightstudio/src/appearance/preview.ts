import type { LightTexture } from './textures';
import { linearToSrgbChannel } from './evaluate';

/** Soft tone-map so HDR values (bulbs, suns) remain readable in a preview. */
const tone = (v: number, exposure: number) => {
  const x = Math.max(0, v) * exposure;
  return x / (1 + x * 0.3);
};

const lutCache: number[] = [];
function srgbByte(v01: number): number {
  const i = Math.round(Math.min(1, Math.max(0, v01)) * 1023);
  let b = lutCache[i];
  if (b === undefined) {
    b = Math.round(linearToSrgbChannel(i / 1023) * 255);
    lutCache[i] = b;
  }
  return b;
}

/**
 * Draw an appearance texture into a canvas: alpha-composited over a checkerboard so
 * transparent areas read as transparent, HDR values soft tone-mapped.
 */
export function drawTextureToCanvas(canvas: HTMLCanvasElement, tex: LightTexture, opts: { checker?: boolean; exposure?: number } = {}): void {
  const { width: w, height: h, data } = tex;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  const ex = opts.exposure ?? 1;
  const checker = opts.checker !== false;
  const cell = Math.max(2, Math.round(Math.min(w, h) / 12));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const a = data[s + 3];
      const cb = checker ? (((Math.floor(x / cell) + Math.floor(y / cell)) & 1) ? 0.16 : 0.26) : 0.1;
      const o = s;
      for (let c = 0; c < 3; c++) {
        const lin = tone(data[s + c], ex) * a + cb * (1 - a) * 0.5;
        img.data[o + c] = srgbByte(lin);
      }
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Small preview as a data URL (used for preset thumbnails). */
export function textureToDataUrl(tex: LightTexture, exposure = 1): string {
  const c = document.createElement('canvas');
  drawTextureToCanvas(c, tex, { checker: true, exposure });
  return c.toDataURL('image/png');
}
