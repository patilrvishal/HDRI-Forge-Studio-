import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { useSceneStore } from '../store/sceneStore';
import { setRawHDRIData } from '../store/hdriDataStore';

/** Registers HDRI bytes as an asset and makes it the scene's environment (what picking a file does). */
export function addCustomHDRIFromBytes(arrayBuffer: ArrayBuffer, fileName: string): void {
  const file = new File([arrayBuffer], fileName, { type: 'application/octet-stream' });
  useHDRIAssetStore.getState().addAsset(file, arrayBuffer);
  const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/octet-stream' }));
  useSceneStore.getState().setEnvironment({ hdri: url, presetId: '__custom__', showBackground: true });
  setRawHDRIData(arrayBuffer, fileName);
}

/**
 * Opens a native file picker for a .hdr/.hdri/.exr file, then registers it
 * as an HDRI asset and activates it as the scene's environment - the same
 * flow EnvironmentAssetsPanel's "+ Add HDRI" button runs, factored out so
 * the Create menu and the HDRI Preview panel can trigger it without a file
 * input element of their own.
 */
export function promptForCustomHDRI(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.hdr,.hdri,.exr';
  input.style.display = 'none';

  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const { addAsset } = useHDRIAssetStore.getState();
      addAsset(file, arrayBuffer);

      const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/octet-stream' }));
      useSceneStore.getState().setEnvironment({ hdri: url, presetId: '__custom__', showBackground: true });

      // Raw bytes kept for legacy .lightscene save compatibility.
      setRawHDRIData(arrayBuffer, file.name);
    } catch (err) {
      console.error('[LightForge] Failed to load custom HDRI:', err);
    }
  };

  document.body.appendChild(input);
  input.click();
}
