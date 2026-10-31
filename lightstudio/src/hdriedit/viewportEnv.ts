/**
 * Keeps the live 3D viewport's environment in step with an edited / procedural HDRI:
 * the edited image is encoded to a Radiance .hdr blob and set as the scene environment
 * (the viewport can only show one environment map at a time).
 */
import { useEffect } from 'react';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { useSceneStore } from '../store/sceneStore';
import { encodeHDR } from '../three/HDRIExporter';
import { getEditedImage, hasEdits } from './envSource';

const VIEWPORT_W = 1024;

let liveAssetId: string | null = null;
let liveUrl: string | null = null;
let liveSig = '';
let timer: number | undefined;
let generation = 0;

export const getLiveAssetId = (): string | null => liveAssetId;

/** Make this (edited or sky) asset the one shown in the viewport. */
export async function driveViewportWith(assetId: string): Promise<void> {
  const asset = useHDRIAssetStore.getState().assets.find((a) => a.id === assetId);
  if (!asset) return;
  const gen = ++generation;
  const img = await getEditedImage(asset, VIEWPORT_W);
  if (!img || gen !== generation) return;
  const buf = encodeHDR(img.data, img.width, img.height);
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
  const prev = liveUrl;
  liveAssetId = assetId;
  liveUrl = url;
  liveSig = signature(asset);
  useSceneStore.getState().setEnvironment({ hdri: url, presetId: '__custom__', showBackground: true });
  if (prev) setTimeout(() => URL.revokeObjectURL(prev), 2000);
}

const signature = (a: { kind?: string; sky?: unknown; edits?: unknown }): string => JSON.stringify([a.kind, a.sky, a.edits]);

/** Called when the user picks a plain (unedited) environment so we stop tracking. */
export function releaseViewportDrive(): void {
  liveAssetId = null;
  generation++;
}

/** Mount once: re-renders the viewport environment when the driving asset's edits change. */
export function useEditedEnvSync(): void {
  const assets = useHDRIAssetStore((s) => s.assets);
  const hdri = useSceneStore((s) => s.environment.hdri);
  useEffect(() => {
    // Someone else changed the environment (preset, another HDRI): stop driving it.
    if (liveAssetId && hdri !== liveUrl) {
      liveAssetId = null;
      return;
    }
    if (!liveAssetId) return;
    const asset = assets.find((a) => a.id === liveAssetId);
    if (!asset) { liveAssetId = null; return; }
    if (!hasEdits(asset)) {
      // Edits were switched off: fall back to the original file.
      if (asset.blobUrl) useSceneStore.getState().setEnvironment({ hdri: asset.blobUrl, presetId: '__custom__', showBackground: true });
      liveAssetId = null;
      return;
    }
    if (signature(asset) === liveSig) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void driveViewportWith(asset.id); }, 350);
    return () => window.clearTimeout(timer);
  }, [assets, hdri]);
}
