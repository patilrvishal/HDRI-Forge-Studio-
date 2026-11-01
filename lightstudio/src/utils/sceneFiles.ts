import { invoke, isTauri } from '@tauri-apps/api/core';
import { SceneExporter } from '../three/SceneExporter';
import type { SceneManager } from '../three/engine';
import { useUIStore } from '../store/uiStore';
import { useHistoryStore } from '../store/historyStore';
import { useSceneFileStore, baseName, dirName } from '../store/sceneFileStore';

/**
 * Save, Save As and Open for scene files.
 *
 * Desktop app: native dialogs. Save As lets you choose the folder and name; Save overwrites the file you last saved
 * or opened (after asking); Open Recent re-opens a file by its remembered path.
 * Browser / dev server: a page cannot pick a folder or overwrite a file, so it keeps the old download behaviour.
 */

type SceneManagerRef = { current: SceneManager | null } | undefined;

export const canUseNativeFiles = (): boolean => {
  try {
    return isTauri();
  } catch {
    return false;
  }
};

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'scene';
}

async function writeScene(path: string): Promise<void> {
  const data = SceneExporter.exportScene();
  await invoke('write_text_file', { path, contents: SceneExporter.toJSON(data) });
  // Keep the session-recovery copy too, best-effort (same as Ctrl+S always did).
  SceneExporter.quickSave();
}

/** Save As: choose the folder and file name. */
export async function saveSceneAs(): Promise<void> {
  const ui = useUIStore.getState();
  try {
    if (!canUseNativeFiles()) {
      // Not window.prompt() - unsupported in the packaged app's WebView2 (see the New Scene action).
      const name = await ui.requestPrompt('Enter filename:', `lightforge_scene_${Date.now()}.lightscene`);
      if (!name) return;
      SceneExporter.downloadSceneFile(SceneExporter.exportScene(), name);
      ui.showToast(`Saved as "${name}"`, 'success');
      return;
    }

    const files = useSceneFileStore.getState();
    const startFrom = files.currentPath ?? files.recent[0]?.path;
    const data = SceneExporter.exportScene();
    const defaultName = files.currentPath
      ? baseName(files.currentPath)
      : `lightforge_${safeFileName(data.scene.modelName)}.lightscene`;

    const picked = await invoke<string | null>('pick_scene_save_path', {
      defaultName,
      startDir: startFrom ? dirName(startFrom) : undefined,
    });
    if (!picked) return; // cancelled

    await writeScene(picked);
    files.setCurrent(picked);
    files.addRecent(picked);
    ui.showToast(`Saved to ${picked}`, 'success');
  } catch (err) {
    console.error('[LightForge] Save As failed:', err);
    ui.showToast(`Save failed: ${errorText(err)}`, 'error');
  }
}

/** Save: overwrite the file saved or opened last (asks first); a never-saved scene goes to Save As. */
export async function saveScene(): Promise<void> {
  const ui = useUIStore.getState();
  try {
    if (!canUseNativeFiles()) {
      SceneExporter.downloadSceneFile(SceneExporter.exportScene());
      SceneExporter.quickSave();
      ui.showToast('Scene saved', 'success');
      return;
    }

    const files = useSceneFileStore.getState();
    const path = files.currentPath;
    if (!path) {
      await saveSceneAs();
      return;
    }

    const name = baseName(path);
    const ok = await ui.requestConfirm(`Overwrite "${name}"? It will be replaced with the current scene (${path}).`, 'Overwrite');
    if (!ok) return;

    await writeScene(path);
    files.addRecent(path);
    ui.showToast(`Saved "${name}"`, 'success');
  } catch (err) {
    console.error('[LightForge] Save failed:', err);
    ui.showToast(`Save failed: ${errorText(err)}`, 'error');
  }
}

/** Loads scene text into the app (shared by Open, Open Recent and the browser file picker). Returns true on success. */
export function applyLoadedScene(text: string, filename: string, sceneManagerRef: SceneManagerRef): boolean {
  const ui = useUIStore.getState();
  try {
    const sceneFile = SceneExporter.fromJSON(text);
    const error = SceneExporter.importScene(sceneFile);
    if (error) {
      ui.showToast(error, 'error');
      return false;
    }
    // Clear undo history after full scene load
    useHistoryStore.getState().clear();
    // Restore camera position in 3D view
    if (sceneManagerRef?.current) {
      const cam = sceneFile.scene.camera;
      sceneManagerRef.current.setCameraState(cam.position, cam.target, cam.fov);
    }
    ui.showToast(`Opened "${filename}"`, 'success');
    return true;
  } catch (err) {
    ui.showToast(errorText(err) || 'Failed to open scene file', 'error');
    return false;
  }
}

/** Open Recent: open a remembered file by path. */
export async function openSceneFromPath(path: string, sceneManagerRef: SceneManagerRef): Promise<void> {
  const ui = useUIStore.getState();
  const files = useSceneFileStore.getState();
  let text: string;
  try {
    text = await invoke<string>('read_text_file', { path });
  } catch (err) {
    if (errorText(err) === 'not-found') {
      files.removeRecent(path);
      ui.showToast(`"${baseName(path)}" no longer exists, removed from recent files`, 'error');
    } else {
      ui.showToast(`Could not open "${baseName(path)}": ${errorText(err)}`, 'error');
    }
    return;
  }
  if (applyLoadedScene(text, baseName(path), sceneManagerRef)) {
    files.setCurrent(path);
    files.addRecent(path);
  }
}

/** Open Scene...: native file dialog on the desktop, the browser file picker otherwise. */
export async function openSceneDialog(sceneManagerRef: SceneManagerRef): Promise<void> {
  if (!canUseNativeFiles()) {
    const result = await SceneExporter.openSceneFile();
    if (result) applyLoadedScene(result.text, result.filename, sceneManagerRef);
    return;
  }
  const files = useSceneFileStore.getState();
  const startFrom = files.currentPath ?? files.recent[0]?.path;
  try {
    const picked = await invoke<string | null>('pick_scene_open_path', {
      startDir: startFrom ? dirName(startFrom) : undefined,
    });
    if (!picked) return; // cancelled
    await openSceneFromPath(picked, sceneManagerRef);
  } catch (err) {
    useUIStore.getState().showToast(`Could not open: ${errorText(err)}`, 'error');
  }
}
