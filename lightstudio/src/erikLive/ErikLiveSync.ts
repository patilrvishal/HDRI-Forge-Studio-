/**
 * Erik live link - Forge side.
 *
 * While enabled, every change that affects the exported HDRI (lights, HDRI assets,
 * shapes, gradient, exposure, included objects) re-renders the HDRI through the SAME
 * generateAnalyticalHDRI() the export uses and pushes it to the dev-server bridge,
 * which relays it to any open Erik Adjuster tab.
 *
 * Cost control (the CPU pixel loop is the expensive part):
 *   - nothing runs unless the link is switched on
 *   - progressive passes 256x128 -> 512x256 -> 1024x512; any new edit cancels the
 *     in-flight pass so a drag never queues stale work
 *   - decoded HDRI layers / shape canvases are cached until their source changes
 */
import * as THREE from 'three';
import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  generateAnalyticalHDRI, loadActiveHDRILayers, gradientToEnvLayer, HDRICancelled,
  type EnvLayer,
} from '../three/HDRIExporter';
import { compositeShapesCanvas, shapesCanvasToEnvLayer } from '../three/HDRIShapesLayer';
import { useLightsStore } from '../store/lightsStore';
import { useSceneStore } from '../store/sceneStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { useHDRIShapesStore } from '../store/hdriShapesStore';
import { useObjectHdriStore } from '../store/objectHdriStore';
import { useAppearanceStore } from '../appearance/appearanceStore';
import { encodeHDRRLE, computeAshSH9, formatAsh } from './hdriLiveEncode';
import { useMatchGainStore, getMatchGain } from './matchGain';

const DEBOUNCE_MS = 120;

let baseCache: string | null = null;
/** Bridge URL: relative to the Vite dev server in `npm run dev`; the Rust bridge (127.0.0.1:<port>) in the desktop app. */
async function getBase(): Promise<string> {
  if (!isTauri()) return '/__erik_live';
  if (baseCache) return baseCache;
  const port = await invoke<number>('erik_live_port');
  if (!port) throw new Error('Erik live bridge could not bind a port (5173-5180 all busy)');
  baseCache = `http://127.0.0.1:${port}/__erik_live`;
  useErikLiveStore.getState()._set({ port });
  return baseCache;
}
/** Cheap passes always run first so dragging stays smooth; the selected resolution is the last pass. */
const CHEAP_WIDTHS = [256, 512, 1024];
/** Erik's engine freezes for ~0.4s (2K) to ~7s (8K) while ingesting a map, so big passes wait for the edit to settle. */
const SETTLE_BEFORE_BIG_MS = 700;
const BIG_WIDTH = 2048;

interface Pass { w: number; h: number; label: string; }

function buildPasses(targetW: number): Pass[] {
  const passes: Pass[] = CHEAP_WIDTHS.filter((w) => w < targetW).map((w) => ({ w, h: w / 2, label: `${w}x${w / 2}` }));
  passes.push({ w: targetW, h: targetW / 2, label: `${targetW}x${targetW / 2}` });
  return passes;
}

export type LiveStatus = 'off' | 'idle' | 'rendering' | 'sent' | 'error';

interface LiveState {
  enabled: boolean;
  status: LiveStatus;
  pass: string;
  lastMs: number;
  lastBytes: number;
  version: number;
  clients: number;
  error: string;
  /** Desktop app only: the port the Erik panel must point at (5173 unless busy). */
  port: number;
  /** Resolution selected in the HDRI Preview panel; the link streams up to this. */
  targetW: number;
  targetH: number;
  targetLabel: string;
  setTarget: (w: number, h: number, label: string) => void;
  setEnabled: (on: boolean) => void;
  _set: (p: Partial<LiveState>) => void;
}

export const useErikLiveStore = create<LiveState>((set, get) => ({
  enabled: false, status: 'off', pass: '', lastMs: 0, lastBytes: 0, version: 0, clients: 0, error: '', port: 0,
  targetW: 1024, targetH: 512, targetLabel: '1K',
  setTarget: (w, h, label) => {
    const cur = get();
    if (cur.targetW === w && cur.targetH === h) return;
    set({ targetW: w, targetH: h, targetLabel: label });
    if (cur.enabled) schedule();
  },
  setEnabled: (on) => { set({ enabled: on }); if (on) start(); else stop(); },
  _set: (p) => set(p),
}));

let gen = 0;
let timer: number | null = null;
let unsubs: Array<() => void> = [];
let upSource: EventSource | null = null;

/** Messages Erik sends back (currently only "match reference photo" gain requests). */
async function listenToErik(): Promise<void> {
  try {
    const base = await getBase();
    if (upSource) return;
    const es = new EventSource(`${base}/up-events`);
    upSource = es;
    es.onmessage = (ev) => {
      let m: { type?: string; gain?: number[]; seq?: number };
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'matchGain' && Array.isArray(m.gain) && m.gain.length === 3 && typeof m.seq === 'number') {
        useMatchGainStore.getState().set([m.gain[0], m.gain[1], m.gain[2]], m.seq);
      } else if (m.type === 'matchReset') {
        useMatchGainStore.getState().reset();
      }
    };
  } catch { /* bridge not reachable: the live link itself reports that */ }
}

let layerCache: { assets: unknown; intensity: number; layers: EnvLayer[] } | null = null;
let shapeCache: { shapes: unknown; gb: unknown; intensity: number; layer: EnvLayer } | null = null;

const getScene = (): THREE.Scene | null =>
  ((window as unknown as { __lightforgeScene?: { scene: THREE.Scene } }).__lightforgeScene)?.scene ?? null;

async function buildLayers(): Promise<EnvLayer[]> {
  const sceneState = useSceneStore.getState();
  const intensity = sceneState.environment.intensity ?? 1.0;
  const assets = useHDRIAssetStore.getState().assets;

  if (!layerCache || layerCache.assets !== assets || layerCache.intensity !== intensity) {
    layerCache = { assets, intensity, layers: await loadActiveHDRILayers(intensity) };
  }
  const layers = [...layerCache.layers];

  const gb = sceneState.environment.gradientBackground;
  const shapes = useHDRIShapesStore.getState().shapes;
  if (shapes.length > 0) {
    if (!shapeCache || shapeCache.shapes !== shapes || shapeCache.gb !== gb || shapeCache.intensity !== intensity) {
      const canvas = compositeShapesCanvas(shapes, gb?.enabled ? gb : null);
      shapeCache = { shapes, gb, intensity, layer: shapesCanvasToEnvLayer(canvas, intensity) };
    }
    layers.push(shapeCache.layer);
  } else if (gb?.enabled) {
    layers.push(gradientToEnvLayer(gb, intensity));
  }
  return layers;
}

// requestAnimationFrame stops while Forge's window is hidden or covered (e.g. you are watching Erik), so cap the wait.
const nextFrames = () => new Promise<void>((resolve) => {
  let done = false;
  const fin = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(() => requestAnimationFrame(fin));
  window.setTimeout(fin, 100);
});

// Diffuse (SH) lighting is very low-frequency. It is DEFINED as the SH of a 512x256 render of the
// current scene (see exportSHText in HDRIExporter, which the file export uses), so the live preview and
// an exported .ash are identical. Passes narrower than 512 give a rough interim value; the 512 pass
// (always part of the chain) sets the final one, and bigger passes reuse it.
let lastAsh = '';

async function renderAndPush(pass: Pass, my: number): Promise<boolean> {
  const st = useErikLiveStore.getState();
  const scene = getScene();
  if (!scene) { st._set({ status: 'error', error: 'Viewport scene not ready' }); return false; }

  const t0 = performance.now();
  const mg = getMatchGain();
  const mseq = useMatchGainStore.getState().seq;
  st._set({ status: 'rendering', pass: pass.label });
  const layers = await buildLayers();
  if (my !== gen) return false;

  let pixels: Float32Array;
  try {
    pixels = await generateAnalyticalHDRI(scene, pass.w, pass.h, new THREE.Vector3(0, 0, 0), layers, {
      isCancelled: () => my !== gen,
      yieldEveryRows: Math.max(4, Math.round(65536 / pass.w)), // ~65k pixels per slice at any width
    });
  } catch (e) {
    if (e instanceof HDRICancelled) return false;
    const msg = e instanceof RangeError ? `Out of memory at ${pass.label} - pick a lower resolution` : String(e);
    st._set({ status: 'error', error: msg });
    return false;
  }
  if (my !== gen) return false;

  const exposure = useSceneStore.getState().renderSettings.exposure;
  const gr = exposure * mg[0], gg = exposure * mg[1], gb = exposure * mg[2];
  if (gr !== 1 || gg !== 1 || gb !== 1) {
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] *= gr; pixels[i + 1] *= gg; pixels[i + 2] *= gb; }
  }

  let hdr: Uint8Array;
  try {
    hdr = encodeHDRRLE(pixels, pass.w, pass.h);
    if (pass.w <= 512 || !lastAsh) lastAsh = formatAsh(computeAshSH9(pixels, pass.w, pass.h));
  } catch (e) {
    st._set({ status: 'error', error: e instanceof RangeError ? `Out of memory encoding ${pass.label}` : String(e) });
    return false;
  }
  const ash = lastAsh;
  const ms = Math.round(performance.now() - t0);

  try {
    const base = await getBase();
    const res = await fetch(`${base}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Ash': encodeURIComponent(ash),
        // final = the selected export resolution, i.e. byte-identical to what Export HDRI writes
        'X-Meta': encodeURIComponent(JSON.stringify({ w: pass.w, h: pass.h, ms, pass: pass.label, final: pass.w === useErikLiveStore.getState().targetW, m: mseq })),
      },
      body: hdr,
    });
    const j = await res.json();
    st._set({ status: 'sent', lastMs: ms, lastBytes: hdr.length, version: j.version ?? 0, clients: j.clients ?? 0, error: '' });
  } catch (e) {
    st._set({ status: 'error', error: `Bridge unreachable: ${String(e)}` });
    return false;
  }
  return true;
}

async function runChain() {
  const my = ++gen;
  await nextFrames(); // let the viewport apply store changes to the THREE scene first
  for (const p of buildPasses(useErikLiveStore.getState().targetW)) {
    if (my !== gen) return;
    if (p.w >= BIG_WIDTH) {
      // expensive for both Forge (CPU render) and Erik (engine freeze): only once the edit has settled
      useErikLiveStore.getState()._set({ status: 'rendering', pass: `${p.label} (waiting for edit to settle)` });
      await new Promise<void>((r) => window.setTimeout(r, SETTLE_BEFORE_BIG_MS));
      if (my !== gen) return;
    }
    if (!(await renderAndPush(p, my))) return;
  }
  if (my === gen) useErikLiveStore.getState()._set({ status: 'idle' });
}

function schedule() {
  gen++; // cancel anything in flight immediately
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => { void runChain(); }, DEBOUNCE_MS);
}

function start() {
  if (!import.meta.env.DEV && !isTauri()) {
    useErikLiveStore.getState()._set({ enabled: false, status: 'error', error: 'Erik live link needs the desktop app or `npm run dev`' });
    return;
  }
  if (isTauri()) void getBase().catch((e) => useErikLiveStore.getState()._set({ status: 'error', error: String(e) }));
  stop(false);
  const watch = <T,>(sub: (l: () => void) => () => void, pick: () => T) => {
    let prev = pick();
    unsubs.push(sub(() => { const cur = pick(); if (cur !== prev) { prev = cur; schedule(); } }));
  };
  watch((l) => useLightsStore.subscribe(l), () => useLightsStore.getState().lights);
  watch((l) => useSceneStore.subscribe(l), () => useSceneStore.getState().environment);
  watch((l) => useSceneStore.subscribe(l), () => useSceneStore.getState().renderSettings.exposure);
  watch((l) => useHDRIAssetStore.subscribe(l), () => useHDRIAssetStore.getState().assets);
  watch((l) => useHDRIShapesStore.subscribe(l), () => useHDRIShapesStore.getState().shapes);
  watch((l) => useObjectHdriStore.subscribe(l), () => useObjectHdriStore.getState().version);
  watch((l) => useAppearanceStore.subscribe(l), () => useAppearanceStore.getState());
  watch((l) => useMatchGainStore.subscribe(l), () => useMatchGainStore.getState().gain);
  void listenToErik();
  useErikLiveStore.getState()._set({ status: 'idle', error: '' });
  schedule(); // push the current state straight away
}

function stop(resetStatus = true) {
  gen++;
  if (timer) { window.clearTimeout(timer); timer = null; }
  unsubs.forEach((u) => u());
  unsubs = [];
  if (upSource) { upSource.close(); upSource = null; }
  if (resetStatus) {
    useErikLiveStore.getState()._set({ status: 'off' });
    useMatchGainStore.getState().reset();
  }
}
