/**
 * Detects whether an HDRI file is OpenEXR or Radiance HDR by its magic bytes,
 * not its filename/extension - several code paths (selecting an already-
 * uploaded library asset, restoring a saved scene) only ever have a blob URL
 * or raw buffer by the time the file reaches a loader, with no reliable
 * filename attached. Sniffing the actual bytes works everywhere uniformly.
 *
 * OpenEXR files start with the fixed magic number 0x76 0x2f 0x31 0x01
 * (little-endian 0x01312f76). Anything else is treated as Radiance HDR -
 * RGBELoader already throws a clear error on genuinely unsupported input.
 */
export function isEXRBuffer(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return bytes.length >= 4 &&
    bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01;
}

/** Same check, for a URL (blob: or http) whose bytes aren't in hand yet. */
export async function isEXRUrl(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    return isEXRBuffer(header);
  } catch {
    return false;
  }
}
