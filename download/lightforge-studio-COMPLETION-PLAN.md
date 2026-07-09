# LightForge Studio — Product Completion Plan

## Product Rename: LightStudio → LightForge Studio

### Files requiring name change

| # | File | Location of current name | What to change |
|---|------|-------------------------|----------------|
| 1 | `package.json` | `"name": "lightstudio"` | `"name": "lightforge-studio"` |
| 2 | `index.html` | `<title>` tag | "LightForge Studio" |
| 3 | `components/Layout/AppLayout.tsx` | Status bar version text | "LightForge Studio" |
| 4 | `components/Toolbar/TopMenubar.tsx` | Help → About menu label | "LightForge Studio" |
| 5 | `components/Toolbar/LeftToolbar.tsx` | Any tooltip/title references | "LightForge Studio" |
| 6 | `components/Viewport/Viewport.tsx` | Drag-drop overlay text | "LightForge Studio" |
| 7 | `components/Settings/RenderSettingsPanel.tsx` | Modal title | "LightForge Studio" |
| 8 | `components/Export/ExportDialog.tsx` | Dialog title | "LightForge Studio" |
| 9 | `components/Lights/PresetBrowser.tsx` | Any branding text | "LightForge Studio" |
| 10 | `vite.config.ts` | `base` path if set | Update if needed |
| 11 | `README.md` | Title and references | "LightForge Studio" |
| 12 | All component files | Code comments mentioning "LightStudio" | "LightForge Studio" |
| 13 | `store/sceneStore.ts` | Scene file format version/identifier | Update `.lightscene` or keep (user-facing name only) |
| 14 | Favicon / logo assets | If any exist | Replace with LightForge branding |

> **Note**: The `.lightscene` file extension and internal store IDs can stay as-is (they're not user-facing). Only change user-visible strings.

---

## COMPLETION PLAN — Ordered by Priority

### ~~PHASE A: Critical HDRI Fixes (Blocks core workflow)~~ ✅ COMPLETE

#### ~~A1. HDRI colored lights render as WHITE~~ ✅
- **Fixed**: Replaced all `MeshBasicMaterial` light proxies with a raw `ShaderMaterial` that outputs `vec4(hdrColor * brightness, 1.0)` directly, bypassing Three.js r165's internal color space management which was desaturating HDR colors toward white.
- **Result**: Red light → red hotspot, blue light → blue hotspot in exported HDRI.

#### ~~A2. HDRI not behaving as true HDR~~ ✅
- **Fixed**: Same root cause as A1. `MeshBasicMaterial` was clamping/desaturating values > 1.0 through its color space pipeline before the HalfFloat framebuffer. The raw `ShaderMaterial` now writes unclamped linear values (20–1000) directly into the HalfFloat RT. Added diagnostic console log showing max pixel value after capture.
- **Result**: Black pixels (0.0) stay black when exposure increases; only light source pixels respond.

#### ~~A3. CubeTexture sampling bug for custom HDRI export path~~ ✅
- **Verified**: Current code correctly uses `captureScene.background = texture` with `EquirectangularReflectionMapping` for custom .hdr files. CubeCamera renders this as a sky dome. Built-in presets correctly produce pure black (viewport-only). Path is correct.

---

### PHASE B: Broken Light Editing (Direct user impact)

#### B1. Light type change doesn't recreate 3D light
- **File**: `src/three/engine.ts` → LightManager (~line 799)
- **Problem**: Changing light type (e.g. Point → Spot) in UI leaves old light object in scene
- **Fix**: Detect type change in `syncLights()`, remove old light, create new one of correct type, re-add to scene
- **Deliverable**: Type dropdown instantly swaps the 3D light

#### B2. Spotlight angle & penumbra sliders are no-ops
- **File**: `src/components/Lights/LightProperties.tsx` (lines 248-261)
- **Problem**: `onChange={() => {}}` — values hardcoded at 45° and 50%, never written to store
- **Fix**: Connect to `updateLight()` store action with correct property paths (`spotAngle`, `spotPenumbra`)
- **Deliverable**: Sliders actually change spotlight cone angle and softness in real-time

#### B3. Area light width/height sliders are no-ops
- **File**: `src/components/Lights/LightProperties.tsx` (lines 268-269)
- **Problem**: `onChange={() => {}}` — dimensions never written to store or synced to 3D scene
- **Fix**: Connect sliders to store, AND fix `Viewport.tsx` `syncLights()` (~line 486) to read `areaWidth`/`areaHeight` from light data instead of hardcoded values
- **Deliverable**: Area light rectangles resize in real-time when sliders change

#### B4. Area light dimensions not synced from store to 3D
- **File**: `src/components/Viewport/Viewport.tsx` → `syncLights` (~line 486)
- **Problem**: Hardcodes `areaWidth` and `areaHeight` instead of reading from light store
- **Fix**: Read from `light.transform.areaWidth` / `light.transform.areaHeight`
- **Deliverable**: Area dimensions persist and render correctly

---

### PHASE C: Product Rename

#### C1. Rename LightStudio → LightForge Studio
- Update all 14+ files listed in the rename table above
- Scope: User-visible strings only (titles, status bar, about dialog, drag-drop text, comments)
- **Do NOT change**: Internal store IDs, file extensions, variable names, folder names
- **Deliverable**: App shows "LightForge Studio" everywhere user sees it

---

### PHASE D: Finishing / Render UI (Missing product surface)

#### D1. Final Render Panel (new component)
- **New file**: `src/components/Export/FinalRenderPanel.tsx`
- **Features**:
  - Large modal with render preview area
  - Resolution presets: 1080p, 2K, 4K, 8K, Custom
  - Format selection: PNG, JPEG, WebP, EXR, HDR
  - Quality slider (JPEG/WebP compression)
  - "Render" button with progress bar + estimated time + cancel
  - Full-screen preview of finished render before download
  - "Download" button after render completes
- **Trigger**: Menu → File → Final Render (Ctrl+Shift+E), or toolbar button

#### D2. Render Progress System
- **New file**: `src/three/RenderJob.ts`
- **Features**:
  - High-quality single-frame render at specified resolution
  - Progress callback (for progressive render or multi-pass)
  - Cancellation support
  - Renders to offscreen canvas at full resolution (not screen resolution)
- **Integration**: FinalRenderPanel calls RenderJob, shows progress bar

#### D3. Multi-Angle Export
- **New file**: `src/components/Export/MultiAngleExport.tsx` (or within FinalRenderPanel)
- **Features**:
  - One-click export from all saved camera bookmarks
  - Batch naming: `render_front.png`, `render_side.png`, `render_rear.png`
  - Optional: auto-create 4 standard angles (front, 3/4, side, rear) if no bookmarks saved
  - Progress: "Rendering 2/4 angles..."
  - ZIP download of all images

#### D4. Export History Panel (optional)
- **New file**: `src/components/Export/ExportHistory.tsx`
- **Features**:
  - Lists recent exports with timestamp, format, resolution
  - Thumbnail preview
  - Quick re-download
  - Stored in sessionStorage (cleared on session end)

---

### PHASE E: Export & Scene Bugs

#### E1. Transparent PNG export produces black background
- **File**: `src/three/ImageExporter.ts`
- **Problem**: Renderer created with `alpha: false`; workaround `compositeTransparent()` fails (async image load)
- **Fix**: Either recreate renderer with `alpha: true` for transparent exports, or use `toDataURL('image/png')` on a secondary canvas with proper alpha compositing
- **Deliverable**: PNG export with actual transparent background

#### E2. Camera bookmarks lost on scene save/load
- **File**: `src/three/SceneExporter.ts` (lines 228-231)
- **Problem**: `setBookmarks` method doesn't exist on sceneStore — bookmarks not serialized
- **Fix**: Add `bookmarks` to `SceneState`, add `setBookmarks` action to sceneStore, include in SceneExporter serialization/deserialization
- **Deliverable**: Bookmarks persist across save/load

#### E3. Auto-save timer not implemented
- **File**: `src/components/Settings/RenderSettingsPanel.tsx` + new store logic
- **Problem**: Toggle and interval exist in UI but no `setInterval` runs
- **Fix**: Add auto-save timer in Viewport or AppLayout that reads interval from render settings, saves to localStorage
- **Deliverable**: Toggle on → scene auto-saves at configured interval

---

### PHASE F: UI Polish & No-Op Fixes

#### F1. "Select All Lights" only selects first
- **File**: `src/components/Toolbar/TopMenubar.tsx` (lines 149-156)
- **Fix**: Iterate all lights, set all as selected

#### F2. "Keyboard Shortcuts" menu does nothing
- **File**: `src/components/Toolbar/TopMenubar.tsx` (line 202)
- **Fix**: Open a shortcuts reference modal/dialog

#### F3. `light.color` animation property not connected
- **File**: `src/components/Viewport/Viewport.tsx` animation callback (lines 179-206)
- **Fix**: Add case for `'light.color'` that lerps RGB

#### F4. HistoryPanel not rendered
- **File**: `src/components/Layout/AppLayout.tsx`
- **Fix**: Add HistoryPanel to the bottom panel area or as a dockable panel

#### F5. Clean up dead code
- Delete unused files: `SceneManager.ts`, `RenderPipeline.ts`, `LightManager.ts`, `Exporter.ts`
- Remove `@tweenjs/tween.js` from package.json
- Remove dead `LightTransform` fields: `maisleU`, `mendieV`, `smartGolly`, `dailyMultiplier`

---

### PHASE G: Feature Gaps (Production Readiness)

#### G1. Light gizmo/transform handles
- Visual handles in 3D viewport to drag lights by position/rotation
- Currently lights only movable via panel sliders
- Consider: TransformControls from Three.js examples

#### G2. Next-gen PBR material properties
- Add: Clearcoat, Clearcoat Roughness, Transmission, Sheen, Iridescence, Anisotropy
- File: `src/types/MaterialEditor.ts` + `src/components/Materials/MaterialEditorPanel.tsx`

#### G3. IES light profile support
- Currently IES lights are identical to PointLights
- Add `.ies` file upload, parse with Three.js IESLoader
- File: `src/three/engine.ts` LightManager

#### G4. Video export from animation timeline
- Record canvas frames → encode to WebM/MP4
- Use MediaRecorder API or ffmpeg.wasm

#### G5. TAA anti-aliasing implementation
- Currently falls back to SMAA
- Implement temporal jitter + accumulation buffer

#### G6. DOF (Depth of Field) post-processing
- BokehPass from Three.js examples
- Add controls: focal distance, aperture, max blur

---

## RECOMMENDED EXECUTION ORDER

```
Week 1:  A1 → A2 → A3          (HDRI working correctly)
Week 2:  B1 → B2 → B3 → B4     (All light controls functional)
Week 3:  C1                     (Rename to LightForge Studio)
Week 4:  D1 → D2 → D3          (Final Render Panel + progress)
Week 5:  E1 → E2 → E3          (Export & scene bugs)
Week 6:  F1 → F2 → F3 → F4 → F5 (UI polish + cleanup)
Week 7+: G1 → G2 → G3 → G4...  (Feature gaps, ongoing)
```

---

## FILES TO CREATE (New)

| File | Purpose |
|------|---------|
| `src/components/Export/FinalRenderPanel.tsx` | Main render dialog with preview + progress |
| `src/three/RenderJob.ts` | High-quality render job with progress/cancel |
| `src/components/Export/MultiAngleExport.tsx` | Batch angle export (or inside FinalRenderPanel) |
| `src/components/Export/ExportHistory.tsx` | Recent exports list (optional) |
| `src/components/Shortcuts/ShortcutsDialog.tsx` | Keyboard shortcuts reference |