import { create } from 'zustand';
import { hdriAssetDB } from '../services/HDRIAssetDB';

/** A single custom HDRI asset in the scene */
export interface HDRIAsset {
  id: string;
  /** User-visible name (derived from filename) */
  name: string;
  /** Original file name */
  fileName: string;
  /** Blob URL for rendering (transient — not persisted) */
  blobUrl: string | null;
  /** Base64-encoded raw HDRI data for scene file persistence */
  dataBase64: string | null;
  /** Per-asset intensity multiplier (blended with global intensity) - this
   *  IS the asset's exposure control: a linear brightness multiplier on top
   *  of the loaded HDR data, same role "Exposure" plays elsewhere in the app. */
  intensity: number;
  /** Per-asset rotation offset in degrees, around the world Y axis. An
   *  equirectangular environment map has no meaningful X/Z tilt in this
   *  engine (it represents the surroundings at infinite distance, not a
   *  physical object with its own orientation) - Y is the only rotation
   *  that corresponds to something a user can actually see change. */
  rotation: number;
  /** How much this HDRI blends over whatever is beneath it in the layer
   *  stack (0-100) - 100 = fully opaque, 0 = fully see-through to whatever
   *  the next layer down renders. Independent of intensity: a dim HDRI at
   *  100% opacity still fully replaces what's beneath it; a bright one at
   *  20% opacity still only partially shows through. */
  opacity: number;
  /** -100..100. Post-process contrast adjustment applied when sampling this
   *  HDRI, pivoted around mid-grey (0.5 in linear space after tonemap). */
  contrast: number;
  /** Gamma curve applied on top of the HDRI's own decoded values. 1 = no
   *  change; <1 brightens midtones, >1 darkens them. */
  gamma: number;
  /** -100..100. Post-process saturation adjustment (desaturate toward
   *  luminance at -100, oversaturate at +100). */
  saturation: number;
  /** Whether this asset is currently active/selected */
  active: boolean;
}

/** Defaults for the new grading fields, so every existing call site that
 *  constructs an HDRIAsset without them (scene-file import from before
 *  these existed, etc.) still gets sane, no-op values. */
export const HDRI_ASSET_GRADING_DEFAULTS = {
  opacity: 100,
  contrast: 0,
  gamma: 1,
  saturation: 0,
} as const;

interface HDRIAssetStore {
  assets: HDRIAsset[];
  selectedAssetId: string | null;
  /** Whether loadFromDB() has run yet this session. */
  dbLoaded: boolean;

  /** Add a new HDRI asset from file */
  addAsset: (file: File, arrayBuffer: ArrayBuffer) => HDRIAsset;
  /** Remove an asset by ID (also revokes blob URL, deletes from IndexedDB) */
  removeAsset: (id: string) => void;
  /** Select an asset (makes it active) */
  selectAsset: (id: string | null) => void;
  /** Update per-asset properties */
  updateAsset: (id: string, updates: Partial<Pick<HDRIAsset, 'name' | 'intensity' | 'rotation' | 'active' | 'opacity' | 'contrast' | 'gamma' | 'saturation'>>) => void;
  /** Set the blob URL on an asset (after creating from base64 restore) */
  setAssetBlobUrl: (id: string, url: string) => void;
  /** Reorder the whole assets array to match the given id sequence - keeps
   *  this store's array order in sync with the unified cross-type Layers
   *  panel, the same pattern lightsStore/hdriShapesStore already use.
   *  Array order IS render/compositing order (see loadActiveHDRILayers). */
  setAssetsOrder: (ids: string[]) => void;
  /** Import assets from scene file restore */
  importAssets: (assets: HDRIAsset[]) => void;
  /** Export all assets (for scene file save) */
  exportAssets: () => HDRIAsset[];
  /** Clear all assets */
  clearAssets: () => void;
  /** Restore persisted HDRI assets from IndexedDB (regenerates blob URLs). */
  loadFromDB: () => Promise<void>;
  /** Persist every currently-loaded HDRI asset to IndexedDB. */
  saveAllToDB: () => Promise<void>;
}

/** Convert ArrayBuffer to base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** Convert a base64 string back to an ArrayBuffer. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export const useHDRIAssetStore = create<HDRIAssetStore>((set, get) => ({
  assets: [],
  selectedAssetId: null,
  dbLoaded: false,

  addAsset: (file, arrayBuffer) => {
    const id = `hdri_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const blobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/octet-stream' }));
    const baseName = file.name.replace(/\.(hdr|hdri|exr)$/i, '');
    const asset: HDRIAsset = {
      id,
      name: baseName,
      fileName: file.name,
      blobUrl,
      dataBase64: arrayBufferToBase64(arrayBuffer),
      intensity: 1.0,
      rotation: 0,
      ...HDRI_ASSET_GRADING_DEFAULTS,
      active: true,
    };
    // Newly added HDRIs join the stack active, same as a new light or shape
    // - they do NOT deactivate whatever else was already active. Multiple
    // Custom HDRIs are meant to coexist (loadActiveHDRILayers blends every
    // active one together); the old "only one can ever be active" behavior
    // here was inconsistent with that and with how lights/shapes work.
    set((s) => ({
      assets: [...s.assets, asset],
      selectedAssetId: id,
    }));
    return asset;
  },

  removeAsset: (id) => {
    const asset = get().assets.find((a) => a.id === id);
    if (asset?.blobUrl) {
      URL.revokeObjectURL(asset.blobUrl);
    }
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== id),
      selectedAssetId: s.selectedAssetId === id ? null : s.selectedAssetId,
    }));
    void hdriAssetDB.del(id);
  },

  selectAsset: (id) => {
    // Selection is a pure UI concern (which row is highlighted / shown in
    // the Properties panel) and must NEVER touch `active` (whether an asset
    // is actually included in the render). Those two used to be the same
    // assignment here - deselecting to edit something else calls this with
    // id=null, which unconditionally set every asset's `active` to
    // `a.id === null` (always false, since no real asset has a null id),
    // silently hiding every Custom HDRI the instant a light or shape got
    // selected. Activating a specific asset as the live environment is a
    // deliberate, separate action - see LightListPanel's selectHDRIAsset
    // wrapper, which calls updateAsset(id, { active: true }) explicitly.
    set({ selectedAssetId: id });
  },

  updateAsset: (id, updates) => {
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    }));
  },

  setAssetBlobUrl: (id, url) => {
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, blobUrl: url } : a)),
    }));
  },

  setAssetsOrder: (ids) => {
    set((s) => {
      const byId = new Map(s.assets.map((a) => [a.id, a]));
      const ordered: HDRIAsset[] = [];
      for (const id of ids) {
        const a = byId.get(id);
        if (a) { ordered.push(a); byId.delete(id); }
      }
      for (const a of s.assets) {
        if (byId.has(a.id)) ordered.push(a);
      }
      return { assets: ordered };
    });
  },

  importAssets: (assets) => {
    // Clear existing blob URLs
    get().assets.forEach((a) => {
      if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
    });
    // Import without blobUrls (restored separately from base64) - backfill
    // the grading fields for scene files saved before they existed, so an
    // older project still loads with sane (no-op) values instead of
    // `undefined` propagating into sliders/math downstream.
    set({
      assets: assets.map((a) => ({ ...HDRI_ASSET_GRADING_DEFAULTS, ...a, blobUrl: null })),
      selectedAssetId: assets.find((a) => a.active)?.id ?? null,
    });
  },

  exportAssets: () => {
    // Export with base64 data but strip transient blobUrls
    return get().assets.map((a) => ({ ...a, blobUrl: null }));
  },

  clearAssets: () => {
    get().assets.forEach((a) => {
      if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
    });
    set({ assets: [], selectedAssetId: null });
  },

  loadFromDB: async () => {
    if (get().dbLoaded) return;
    // Flip the guard synchronously, before the first await - closes the race
    // window where two concurrent callers (e.g. React StrictMode's double
    // effect-invoke in dev) both see dbLoaded=false and both append.
    set({ dbLoaded: true });

    const stored = await hdriAssetDB.getAll();
    if (stored.length === 0) return;

    // Regenerate blob URLs from the persisted base64 data - blob: URLs
    // don't survive a reload, but the underlying bytes do.
    const restored: HDRIAsset[] = stored.map((a) => {
      let blobUrl: string | null = null;
      if (a.dataBase64) {
        try {
          const buffer = base64ToArrayBuffer(a.dataBase64);
          blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
        } catch (err) {
          console.warn('[hdriAssetStore] Failed to restore blob for', a.name, err);
        }
      }
      return { ...a, blobUrl };
    });

    set((s) => {
      // Defense-in-depth: dedupe by id in case an asset was already added
      // (e.g. imported this session) before the DB restore landed.
      const existingIds = new Set(s.assets.map((a) => a.id));
      const toAdd = restored.filter((a) => !existingIds.has(a.id));
      return {
        assets: [...s.assets, ...toAdd],
        selectedAssetId: s.selectedAssetId ?? toAdd.find((a) => a.active)?.id ?? null,
      };
    });
  },

  saveAllToDB: async () => {
    const assets = get().assets;
    await Promise.all(
      assets.map((a) => {
        const { blobUrl: _blobUrl, ...stored } = a;
        return hdriAssetDB.put(stored);
      }),
    );
  },
}));