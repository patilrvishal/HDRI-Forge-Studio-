/**
 * Minimal uncompressed OpenEXR writer for float RGBA (or RGB) images, used to
 * export per-light textures with a real alpha channel. Channels are written in
 * the alphabetical order the format requires (A, B, G, R), FLOAT pixel type,
 * scanline layout, no compression - readable by every DCC / compositor.
 */
export function encodeEXRRGBA(pixels: Float32Array, width: number, height: number, withAlpha = true): ArrayBuffer {
  const chans = withAlpha ? ['A', 'B', 'G', 'R'] : ['B', 'G', 'R'];
  const srcIdx: Record<string, number> = { R: 0, G: 1, B: 2, A: 3 };
  const enc = new TextEncoder();
  const parts: number[] = [];
  const u32 = (v: number) => parts.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const str0 = (s: string) => { for (const b of enc.encode(s)) parts.push(b); parts.push(0); };
  const attr = (name: string, type: string, bytes: number[]) => {
    str0(name); str0(type); u32(bytes.length); for (const b of bytes) parts.push(b);
  };
  const le32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const f32 = (v: number) => { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true); return [...new Uint8Array(b)]; };

  // chlist
  const ch: number[] = [];
  for (const c of chans) {
    ch.push(...enc.encode(c), 0);
    ch.push(...le32(2), ...le32(0), ...le32(1), ...le32(1)); // FLOAT, pLinear, xs, ys
  }
  ch.push(0);
  attr('channels', 'chlist', ch);
  attr('compression', 'compression', [0]);
  attr('dataWindow', 'box2i', [...le32(0), ...le32(0), ...le32(width - 1), ...le32(height - 1)]);
  attr('displayWindow', 'box2i', [...le32(0), ...le32(0), ...le32(width - 1), ...le32(height - 1)]);
  attr('lineOrder', 'lineOrder', [0]);
  attr('pixelAspectRatio', 'float', f32(1));
  attr('screenWindowCenter', 'v2f', [...f32(0), ...f32(0)]);
  attr('screenWindowWidth', 'float', f32(1));
  parts.push(0); // end of header

  const header = new Uint8Array(parts);
  const rowBytes = width * chans.length * 4;
  const blockSize = 8 + rowBytes;
  const dataStart = 8 + header.length + height * 8;
  const total = dataStart + height * blockSize;
  const file = new Uint8Array(total);
  const dv = new DataView(file.buffer);
  dv.setUint32(0, 20000630, true);
  dv.setUint32(4, 2, true);
  file.set(header, 8);
  for (let y = 0; y < height; y++) {
    const off = dataStart + y * blockSize;
    dv.setUint32(8 + header.length + y * 8, off >>> 0, true);
    dv.setUint32(8 + header.length + y * 8 + 4, Math.floor(off / 0x100000000), true);
    dv.setInt32(off, y, true);
    dv.setUint32(off + 4, rowBytes, true);
    let p = off + 8;
    for (const c of chans) {
      const k = srcIdx[c];
      for (let x = 0; x < width; x++) {
        dv.setFloat32(p, pixels[(y * width + x) * 4 + k], true);
        p += 4;
      }
    }
  }
  return file.buffer;
}
