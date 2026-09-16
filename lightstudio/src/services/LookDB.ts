/**
 * IndexedDB-backed Look persistence service.
 * Uses the 'LightStudioLooks' database with a 'looks' object store - a
 * separate database from PresetDB's 'LightStudioPresets' rather than a
 * second object store bolted onto it, so this ships without touching
 * PresetDB's schema/version at all.
 * All methods are async and fail silently (console.warn) so the app
 * remains functional even if IndexedDB is unavailable.
 */

import type { Look } from '../types/Look';

const DB_NAME = 'LightStudioLooks';
const DB_VERSION = 1;
const STORE_NAME = 'looks';

class LookDB {
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
          console.warn('[LookDB] Failed to open database:', error);
          this.initPromise = null;
          reject(error);
        };
      } catch (err) {
        console.warn('[LookDB] IndexedDB unavailable:', err);
        this.initPromise = null;
        resolve(); // Don't crash, just run without persistence
      }
    });

    return this.initPromise;
  }

  /** Retrieve all Looks from the store. */
  async getAll(): Promise<Look[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise<Look[]>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          resolve((request.result as Look[]) || []);
        };

        request.onerror = () => {
          console.warn('[LookDB] Failed to read Looks');
          resolve([]);
        };
      } catch {
        resolve([]);
      }
    });
  }

  /** Insert or update a single Look. */
  async put(look: Look): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(look);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('[LookDB] Failed to save Look');
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  /** Delete a Look by its id. */
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
          console.warn('[LookDB] Failed to delete Look');
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

export const lookDB = new LookDB();
