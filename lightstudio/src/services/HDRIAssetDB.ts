/**
 * IndexedDB-backed persistence for custom HDRI assets imported via the
 * Presets > Custom tab. Mirrors PresetDB.ts's pattern. Stores the raw
 * base64 HDRI data so assets survive a reload without needing a full
 * scene-file export/import round trip.
 *
 * All methods are async and fail silently (console.warn) so the app
 * remains functional even if IndexedDB is unavailable.
 */

import type { HDRIAsset } from '../store/hdriAssetStore';

const DB_NAME = 'LightStudioHDRIAssets';
const DB_VERSION = 1;
const STORE_NAME = 'hdriAssets';

/** Persisted shape — blobUrl is transient and never stored. */
export type StoredHDRIAsset = Omit<HDRIAsset, 'blobUrl'>;

class HDRIAssetDB {
  private db: IDBDatabase | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event: Event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.ready = true;
          resolve();
        };

        request.onerror = (event: Event) => {
          const error = (event.target as IDBOpenDBRequest).error;
          console.warn('[HDRIAssetDB] Failed to open database:', error);
          this.initPromise = null;
          reject(error);
        };
      } catch (err) {
        console.warn('[HDRIAssetDB] IndexedDB unavailable:', err);
        this.initPromise = null;
        resolve();
      }
    });

    return this.initPromise;
  }

  async getAll(): Promise<StoredHDRIAsset[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise<StoredHDRIAsset[]>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve((request.result as StoredHDRIAsset[]) || []);
        request.onerror = () => {
          console.warn('[HDRIAssetDB] Failed to read HDRI assets');
          resolve([]);
        };
      } catch {
        resolve([]);
      }
    });
  }

  async put(asset: StoredHDRIAsset): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(asset);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('[HDRIAssetDB] Failed to save HDRI asset');
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  async del(id: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('[HDRIAssetDB] Failed to delete HDRI asset');
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  isReady(): boolean {
    return this.ready;
  }
}

export const hdriAssetDB = new HDRIAssetDB();
