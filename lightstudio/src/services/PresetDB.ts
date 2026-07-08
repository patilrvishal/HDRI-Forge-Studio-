/**
 * IndexedDB-backed preset persistence service.
 * Uses the 'LightStudioPresets' database with a 'presets' object store.
 * All methods are async and fail silently (console.warn) so the app
 * remains functional even if IndexedDB is unavailable.
 */

import type { Preset } from '../types/Preset';

const DB_NAME = 'LightStudioPresets';
const DB_VERSION = 1;
const STORE_NAME = 'presets';

class PresetDB {
  private db: IDBDatabase | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  /** Ensure the database is open. Safe to call multiple times. */
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
          console.warn('[PresetDB] Failed to open database:', error);
          this.initPromise = null;
          reject(error);
        };
      } catch (err) {
        console.warn('[PresetDB] IndexedDB unavailable:', err);
        this.initPromise = null;
        resolve(); // Don't crash, just run without persistence
      }
    });

    return this.initPromise;
  }

  /** Retrieve all presets from the store. */
  async getAll(): Promise<Preset[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise<Preset[]>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          resolve((request.result as Preset[]) || []);
        };

        request.onerror = () => {
          console.warn('[PresetDB] Failed to read presets');
          resolve([]);
        };
      } catch {
        resolve([]);
      }
    });
  }

  /** Insert or update a single preset. */
  async put(preset: Preset): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(preset);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('[PresetDB] Failed to save preset');
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  /** Delete a preset by its id. */
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
          console.warn('[PresetDB] Failed to delete preset');
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  /** Check if the database is ready. */
  isReady(): boolean {
    return this.ready;
  }
}

export const presetDB = new PresetDB();