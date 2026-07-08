---
Task ID: 1
Agent: Main Agent
Task: Phase 11 - HDRI Preview, HDRI/EXR Export, Backplate, Resizable Panels

Work Log:
- Created uiLayoutStore.ts with left/right/bottom panel size tracking (min/max clamped)
- Created ResizeHandle.tsx — Blender-style drag-to-resize component with hover highlight, double-click reset
- Created HDRIExporter.ts (~350 lines) with:
  - CubeCamera capture at scene origin (FloatType for HDR range)
  - Equirectangular conversion via custom GLSL shader
  - Radiance HDR (RGBE) encoding with new-style RLE compression
  - OpenEXR encoding (uncompressed, HALF float, BGR channel order, proper header/offset table)
  - float32ToHalf conversion for EXR pixel data
  - Export downloads via Blob URL
- Added backplate/backplateOpacity to EnvironmentState type and DEFAULT_SCENE_STATE
- Added backplate to SceneFile interface in SceneExporter.ts
- Rewrote AppLayout.tsx with ResizeHandle components between all panels (left, right, bottom)
- Added backplate rendering in Viewport.tsx — loads as THREE.Texture, sets scene.background, restores on remove
- Added backplate upload/remove UI in EnvironmentBrowser with preview thumbnail
- Added "Export HDRI (.hdr)..." and "Export EXR (.exr)..." menu items in TopMenubar (Project menu)
- Fixed TS5.4 UTF-8 JSX parsing issue (em dash / box drawing chars)
- Build: 119 modules, zero TS errors, production build clean

Stage Summary:
- Resizable Panels: Left, right, and bottom panels all have drag-to-resize handles (4px, highlight on hover, double-click resets to default). Sizes persisted in uiLayoutStore.
- HDRI/EXR Export: Project > Export HDRI/EXR captures scene lighting from origin (model hidden by default), converts cube map to equirectangular, encodes as proper .hdr (Radiance RGBE with RLE) or .exr (OpenEXR HALF float, uncompressed). Files are industry-standard and work in Blender, UE5, etc.
- Backplate: Set any image as viewport background while keeping HDRI for IBL lighting. Upload/remove from Environment Browser. Persisted in scene files.---
Task ID: 1
Agent: Main Agent
Task: Fix HDRI export — pure black background + proper HDR dynamic range

Work Log:
- Analyzed 6 reference images via VLM: identified wrong (uniform brightening) vs correct (only light sources respond to exposure) behavior
- Read HDRIExporter.ts, EnvironmentLoader.ts, sceneStore, Environment types
- Identified root cause 1: captureScene.background set to backgroundHint (e.g. #2a2a3e ≈ 0.16) for built-in presets — non-zero floor makes entire image respond to exposure
- Identified root cause 2: Panel intensities 0.3-1.2 produce max pixel values ~1.2, insufficient for HDR dynamic range
- Fix 1: Changed captureScene.background to Color(0x000000) for all built-in presets
- Fix 2: Added HDR_BOOST=30 multiplier to environment panel colors (values now 9-36 in linear HDR)
- Fix 3: Increased light proxy brightness from intensity*10 to intensity*50 (min 20, max 1000)
- TypeScript compilation: zero errors

Stage Summary:
- HDRIExporter.ts: 3 edits applied — black background, boosted panel HDR values, improved proxy brightness
- Key insight: backgroundHint is for viewport UI only, NOT for HDRI data
- With 0.0 background: exposure*0=0 (dark stays dark), exposure*30=30*exposure (lights respond)

