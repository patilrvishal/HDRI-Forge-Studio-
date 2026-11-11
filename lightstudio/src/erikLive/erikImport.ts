import { useErikLiveStore, getErikBridgeBase } from './ErikLiveSync';
import { addCustomHDRIFromBytes } from '../utils/loadCustomHDRI';
import { useUIStore } from '../store/uiStore';

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

interface ErikHdriInfo { version: number; name: string; bytes: number }

async function readInfo(base: string): Promise<ErikHdriInfo> {
  return (await (await fetch(`${base}/erik-hdri/info`, { cache: 'no-store' })).json()) as ErikHdriInfo;
}

/**
 * Brings in the HDRI that is selected in Erik Adjuster.
 *
 * Forge asks Erik (over the live-link event stream Erik already holds) to send the HDRI it is using; Erik uploads the
 * original .hdr to the bridge and Forge adds it as a Custom HDRI layer. Everything done to it here (rotation, grading,
 * lights, shapes, more layers) is then streamed back by the live link, replacing that HDRI in Erik's viewport, so the
 * result is the selected HDRI as it is now plus the edits made here.
 */
let importing = false;

export async function importFromErik(): Promise<boolean> {
  const ui = useUIStore.getState();
  if (importing) return false;                 // a second click while Erik is still answering would add the HDRI twice
  importing = true;
  try {
    const base = await getErikBridgeBase();
    const before = await readInfo(base);
    const req = (await (await fetch(`${base}/request-erik-hdri`, { method: 'POST' })).json()) as { listeners?: number };
    if (!req.listeners) {
      ui.showToast('Erik is not connected. In Erik Adjuster open the HDRI Forge Live Link panel and press Start live link, then try again.', 'error');
      return false;
    }
    ui.showToast('Asking Erik for its selected HDRI…', 'info');
    let got: ErikHdriInfo | null = null;
    for (let t = 0; t < 80; t++) {
      await sleep(250);
      const info = await readInfo(base);
      if (info.version > before.version) { got = info; break; }
    }
    if (!got) {
      ui.showToast('Erik did not send an HDRI. Open the States tab in Erik so an environment is selected, then try again.', 'error');
      return false;
    }
    const res = await fetch(`${base}/erik-hdri`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    let name = got.name || 'erik.hdr';
    if (!/\.(hdr|hdri|exr)$/i.test(name)) name += '.hdr';
    addCustomHDRIFromBytes(buf, name);
    // From here Forge streams its result back to Erik; the link is what makes the edits reach that HDRI.
    const live = useErikLiveStore.getState();
    if (!live.enabled) live.setEnabled(true, true);
    ui.showToast(`Imported "${name}" from Erik. Edit it here; changes stream back to Erik.`, 'success');
    return true;
  } catch (e) {
    ui.showToast('Import from Erik failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
    return false;
  } finally {
    importing = false;
  }
}
