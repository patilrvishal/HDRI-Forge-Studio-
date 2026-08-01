/**
 * Module-level store for raw custom HDRI binary data.
 * Used to persist the HDRI ArrayBuffer so it can be
 * embedded in scene files (as base64) and restored on load.
 */

let rawHDRIArrayBuffer: ArrayBuffer | null = null;
let rawHDRIFileName: string = 'custom.hdr';

export function setRawHDRIData(data: ArrayBuffer | null, fileName?: string): void {
  rawHDRIArrayBuffer = data;
  if (fileName) rawHDRIFileName = fileName;
}

export function getRawHDRIData(): ArrayBuffer | null {
  return rawHDRIArrayBuffer;
}

export function getRawHDRIFileName(): string {
  return rawHDRIFileName;
}

export function clearRawHDRIData(): void {
  rawHDRIArrayBuffer = null;
  rawHDRIFileName = 'custom.hdr';
}

/**
 * Convert the stored ArrayBuffer to a base64 string.
 */
export function getRawHDRIDataBase64(): string | null {
  if (!rawHDRIArrayBuffer) return null;
  const bytes = new Uint8Array(rawHDRIArrayBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string back to an ArrayBuffer.
 */
export function hdriBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}