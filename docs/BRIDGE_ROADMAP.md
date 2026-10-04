# Forge Bridge — professional DCC connector roadmap

Goal: make HDRI Forge Studio feel like a native part of Blender and Maya. One click to connect, live feedback in both directions, nothing to configure, and safe failure modes.

## 1. Where we are today (verified in the code)

| Area | State |
|---|---|
| DCC → Studio push | Works, but manual button only: mesh (GLB), lights, cameras (separate button), world. Blender + Maya addons, `hdri-bridge-plugin.ts` (dev) / `lib.rs` port 8973 (desktop). |
| Blender ↔ Maya direct | Works (ports 8975/8976). |
| Studio → external live HDRI | Built for **Erik Adjuster** only: `erikLive/ErikLiveSync.ts` re-renders through `generateAnalyticalHDRI()` on every edit, progressive passes 256→512→1024→target, pushes RLE `.hdr` + SH9 `.ash` to `/__erik_live/push`. Clients use `/status`, `/events` (SSE), `/hdr`, `/ash`. Erik can send "match reference photo" gains back via `/up`. |
| Blender / Maya as live HDRI consumers | **Missing.** Neither addon reads the Erik stream. This is the gap. |

Key insight: the server side already exists and needs no changes. A Blender or Maya addon is just another client of `/__erik_live`.

### 1b. Erik Adjuster reference (read from `Erik_My_Version`, last commit 32b189e, 2026-10-03, clean tree)

Erik is a compiled Angular build (no source), so your features live as overlay scripts. The Bridge should mirror these one for one:

| Erik feature (file) | What it does | Bridge equivalent |
|---|---|---|
| Live link (`hdri-livelink.js`) | Receives each HDRI + `.ash`, substitutes it for the engine's asset, reloads, redraws; off = originals restored; coalesces updates (one in flight, newest wins) | **Live HDRI** toggle; Remove restores the previous World / SkyDome |
| Reload spacing by map size | Gives the engine time per resolution so it never drops a map mid-ingest | Same rule: apply on main thread, one in flight, skip superseded passes |
| Follow environment switches / warn on skipped reload | Status warnings instead of silent failure | Visible status line with reason |
| Import Live HDRI (`import-live-hdri.js`) | Saves the live `.hdr` **and its matching `.ash`** as a real Environment profile (Exterior / Interior template); includes an `.hdr`→`.ash` converter (Spherical Harmonizer maths) | **Import HDRI** saves the `.hdr` + `.ash` pair to disk and wires World / SkyDome; Exterior/Interior preset choice |
| Match reference photo (`match-reference.js`) | Measures subject colour, asks Forge for per-channel gain, iterates until within ~3 % (max 10) | Phase 5: same loop driven from a DCC viewport render |

Note: Forge-side commits `11f0fa7` (v0.1.9, Erik live link) and `e1c7e9f` (v0.1.10, photo-match channel) are already in this repo's branch.

## 2. Product principles

1. **Zero config.** Auto-discover dev server and desktop app; never ask for a port.
2. **Live by default, cheap by design.** Nothing runs until the user switches it on; every edit cancels stale work.
3. **Never block the DCC.** All network and file work in background threads; only the main thread touches `bpy` / `cmds`.
4. **Never lose the user's scene.** Everything the bridge creates is named, tagged, and removable in one click.
5. **Same result everywhere.** Live preview, exported HDRI, and the DCC world must come from the same renderer path (`generateAnalyticalHDRI`).
6. **Fail loudly and helpfully.** A visible status line with a plain-English reason and a "Fix it" action.

## 3. Architecture

```
            Forge Studio (React/three)                      DCC (Blender / Maya)
 edits ──► ErikLiveSync (debounced, progressive) ──► Bridge server ◄── forge_link_core.py
                                                    /status /hdr /ash        (discovery, poller thread,
                                                    /events  /up              temp files, reconnect)
                                                                 │
                                                  ┌──────────────┴───────────────┐
                                           blender_adapter.py              maya_adapter.py
                                           (World nodes, timers)           (aiSkyDome, scriptJob)
```

* **`forge_link_core.py`** — new shared, DCC-agnostic Python module (stdlib only, Py3.7+ so Maya 2022+ works): discovery, `/status` poller thread, `/hdr` downloader with atomic file swap, reconnect/backoff, status model, logging. Both addons import it; adapters stay thin.
* **Discovery order:** desktop app Erik port (scan 5173–5180 for `/__erik_live/status` where `app == "HDRI Forge Studio"`), then dev server. Prefer the instance with `hasMap`.
* **Version handshake:** extend `/status` with `protocol` and `capabilities` so addons can tell "too old" from "too new" and show an update banner.

## 3b. Status (updated as it is built)

| Item | State | Evidence |
|---|---|---|
| `/status` has `protocol` + `capabilities` (dev plugin + desktop app) | Done | Rust compiles; real dev server answers |
| `forge_link_core.py` (discovery, poller, newest-wins, spacing, reconnect, one-shot fetch) | Done | 23 unit tests against a mock bridge, plus the real stream |
| Blender Live HDRI / Import / Restore | Done | 23 headless checks on 4.5 and 5.1; real GUI on 5.1: first update 464 ms, final 2.2 s, 3-37 ms main-thread cost |
| Maya Live HDRI / Import / Restore | Done | 22 checks + 6 Arnold-render checks inside Maya 2023.1; real panel buttons and QTimer path |
| Sky orientation | Measured | Blender 0 deg, Maya 90 deg, both with a two-light mirror test and a failing control |
| Forge shows which apps are connected | Not yet | Forge's badge still says "waiting for Erik" while Blender or Maya receive |
| Packaging / installers | Not yet | Addons are two loose files today |

Bugs the tests caught on the way: a stale version counter after a Forge restart, Windows `localhost` taking 2 s (the `::1` fallback), a Maya plug-in load failure (`__file__` undefined under Plug-in Manager), and leftover Maya file nodes after Stop.

## 4. Phases

### Phase 0 — Shared core (½ day)
* Extract discovery + HTTP + threading into `forge_link_core.py`.
* Add `protocol: 1` and `capabilities: ["hdr","ash","scene-push","cameras"]` to `/status` in both `erik-live-plugin.ts` and `lib.rs`.
* Unit tests for the core against a mock server (no DCC needed).
* **Done when:** core passes tests and the existing Blender push still works through it.

### Phase 1 — Live HDRI, Studio → DCC (MVP, ship first)
**Blender**
* Panel box "Live HDRI": toggle, status (Connected / Streaming / Idle / Error), resolution, last update ms.
* Poller thread watches `/status.version`; on change downloads `/hdr` to a temp file; a main-thread timer swaps it into one image datablock `HDRI Forge Live` and calls `reload()`.
* Creates/reuses World with an Environment Texture → Background chain and a Mapping node (name-tagged).
* **Orientation (measured, not assumed):** Forge three-space `(X,Y,Z)` ↔ Blender `(X,-Z,Y)`, and the Mapping node stays at **0°**. An earlier hand derivation said 180°; a Cycles render aimed at two separate Forge lights proved that wrong (light seen at 368 / 307 toward vs 0.27 / 0.09 away, and the 180° control fails). Two lights, because one cannot tell a rotation from a mirror. Verified on Blender 4.5 and 5.1 (`bridge-core/tests/blender_live_test.py`).
* Progressive frames are applied as they arrive; only the `final` pass is flagged as final.
* One-shot **Import HDRI**: saves the current map next to the `.blend` (`//hdri_forge/`) or to temp if unsaved, wires it into World without the live link.
* **Remove Bridge World** button restores the previous world.

**Maya**
* Same flow; target the Arnold `aiSkyDomeLight` file node (already created by the existing code). Write alternating file names (A/B) so Arnold always sees a path change and reloads. `executeDeferred` + `scriptJob` for main-thread work.
* **Orientation (measured):** Arnold's lat-long sky needs **`rotateY = 90°`**, no mirroring. Arnold renders aimed at two separate Forge lights are bright at 90° and nowhere else in a 15° scan; the +180° control fails (`bridge-core/tests/maya_orient_test.py`). Verified in Maya 2023.1 + Arnold.
* Arnold auto-TX is turned off on the live file node (it would convert every streamed map to a `.tx` cache); `live_*` files are purged on start and on stop.

**Done when:** editing a light in Forge updates Blender's viewport (Material Preview / Cycles) within ~300 ms at 256 px, refines to target resolution, and exported HDRI == live HDRI.

### Phase 2 — Live scene sync, DCC → Studio (automatic)
* Auto-push toggle with debounce (150–300 ms) driven by depsgraph updates (Blender) / scriptJobs (Maya).
* **Delta protocol:** hash geometry; transform-only changes send matrices, not GLB. Lights/cameras always cheap.
* Selection-aware or whole-scene mode; ignore hidden objects; option to include the active camera and follow it.
* Units and axis settings (Blender metric scale, Maya linear unit) applied once, shown in the panel.
* **Done when:** moving a car in Blender moves it in Forge with no button press and no GLB re-export.

### Phase 3 — Two-way lights (Forge-authored rigs become real DCC lights)
* "Send lights to Blender/Maya": creates real Area/Spot/Point lights (and Arnold area lights in Maya) from the Forge rig, tagged and updatable in place.
* **Textured area lights:** the Forge pack export (EXR + placement JSON, already verified) → Blender emissive plane with image texture / Maya `aiAreaLight` with texture.
* Intensity mapping table (nits ↔ W, per renderer) documented and unit-tested.
* **Done when:** a LightPaint edit in Forge moves the matching real light in the DCC.

### Phase 4 — Renderer awareness
* Presets per renderer: Cycles / Eevee (Blender), Arnold (Maya) first; then V-Ray, Redshift, Octane, RenderMan, Corona via the same adapter interface.
* Color management: map exposure and view transform (Standard / AgX / ACES) so DCC and Forge agree.
* Camera ray visibility toggle for the dome, shadow-catcher helper for product shots.

### Phase 5 — Workflow polish
* Reference photo match: consume the existing `/up-events` gain messages and apply the exposure/white-balance gain to the DCC world.
* Looks / presets sync, region render preview, multi-DCC at once (Blender and Maya both attached).
* In-app **Bridge Setup** wizard in Forge: detects installed Blender/Maya, installs/updates addons, shows live connection status.
* Packaging: Blender extension `.zip`, Maya `.mod` module + drag-and-drop installer, auto version check and "update available" banner.
* Diagnostics: copyable log panel, "Test connection", firewall hint on failure.

### Phase 6 — More DCCs
Cinema 4D, Houdini, 3ds Max reuse `forge_link_core.py` plus a ~150-line adapter each.

## 5. Quality and testing

* **Contract tests (Node):** mock bridge, assert `/status` shape, version bumps, progressive passes.
* **Core tests (Python):** mock HTTP server for discovery, reconnect/backoff, partial download, atomic swap, cancel.
* **Blender live tests:** a Blender MCP is connected in this environment, so the Blender path can be driven and screenshot-verified end to end (this is how the area-light bridge bug was caught).
* **Maya:** no Maya here, so ship with a manual checklist and keep adapter code minimal and syntax-checked.
* **Golden-image check:** render a known rig in Forge and in the DCC, compare mean radiance within tolerance.
* **Performance budget:** first pass ≤ 300 ms (256 px), no main-thread stall > 16 ms, idle CPU ≈ 0 when nothing changes, memory bounded (single in-flight map).
* **Soak test:** 30 min of continuous edits, no leaks, no stuck states.

## 6. Risks and open questions

| Risk | Mitigation |
|---|---|
| Axis/rotation mismatch (Maya especially) | Derive per-DCC, verify with a known sun marker; keep rotation offset as an explicit, documented constant. |
| Large maps freeze the DCC | Progressive passes already exist; big passes wait for the edit to settle (existing `SETTLE_BEFORE_BIG_MS`). |
| Desktop vs dev ports | Scan 5173–5180 and match `app` name; show which instance is connected. |
| Firewall / loopback blocks | Loopback only; failure message names the port and suggests the fix. |
| Python version drift | Core is stdlib-only, Py3.7+; Blender 4.0+ and Maya 2022+ as the support floor. |
| Reload not picked up (Arnold) | A/B alternating filenames. |

## 7. Suggested build order for today

1. Phase 0 core + `/status` capabilities (small, unblocks everything).
2. Phase 1 on **Blender** (testable live through the Blender MCP): Live HDRI toggle, World wiring, orientation check, one-shot Import, Remove. **Done and verified.**
3. Port the same adapter shape to **Maya** (aiSkyDome A/B swap); ship with the manual checklist.
4. If time remains: Phase 2 auto-push (transform-only fast path first).

Stretch for the same day: Phase 1 polish (status UI, reconnect, Remove Bridge World), then installer packaging.

## 8. Success metrics
* Time from install to first live HDRI in the DCC: under 60 seconds, zero typed settings.
* Edit-to-visible latency in the DCC: under 300 ms first pass.
* Zero main-thread stalls, zero orphaned nodes after "Remove".
