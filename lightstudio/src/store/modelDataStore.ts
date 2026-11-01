/**
 * Module-level store for raw GLB model binary data.
 * Used to persist the model's ArrayBuffer so it can be
 * embedded in scene files (as base64) and restored on load.
 */

let rawModelArrayBuffer: ArrayBuffer | null = null;
let rawModelFileName: string = 'model.glb';

export function setRawModelData(data: ArrayBuffer | null, fileName?: string): void {
  rawModelArrayBuffer = data;
  if (fileName) rawModelFileName = fileName;
}

export function getRawModelData(): ArrayBuffer | null {
  return rawModelArrayBuffer;
}

export function getRawModelFileName(): string {
  return rawModelFileName;
}

export function clearRawModelData(): void {
  rawModelArrayBuffer = null;
  rawModelFileName = 'model.glb';
  // A new or replaced model starts a fresh scene, so the extra files imported into the old one go too
  clearRawImportedModels();
}

/**
 * Extra model files imported into the scene (File > Import Models). Kept so a saved scene file can carry them
 * and bring them back exactly as they were imported.
 */
export interface RawImportedModel {
  name: string;
  data: ArrayBuffer;
}

const importedModels: RawImportedModel[] = [];

export function addRawImportedModel(name: string, data: ArrayBuffer): void {
  importedModels.push({ name, data });
}

export function getRawImportedModels(): RawImportedModel[] {
  return importedModels;
}

export function clearRawImportedModels(): void {
  importedModels.length = 0;
}

/** Imported models as base64 for the scene file, or null when there are none. */
export function getImportedModelsBase64(): { name: string; dataBase64: string }[] | null {
  if (importedModels.length === 0) return null;
  return importedModels.map((m) => ({ name: m.name, dataBase64: arrayBufferToBase64(m.data) }));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Convert the stored ArrayBuffer to a base64 string.
 * Returns null if no data is stored.
 */
export function getRawModelDataBase64(): string | null {
  if (!rawModelArrayBuffer) return null;
  const bytes = new Uint8Array(rawModelArrayBuffer);
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
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}