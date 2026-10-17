import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { driveViewportWith } from './viewportEnv';

/** Adds a procedural sky as an HDRI asset and shows it in the viewport. */
export function addProceduralSky(): void {
  const asset = useHDRIAssetStore.getState().addSkyAsset();
  void driveViewportWith(asset.id);
}
