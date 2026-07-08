# LightStudio — 3D Car Lighting Studio

## Project State: Phase 8 Complete

`npx tsc --noEmit` = **0 errors**

### Phase Progression

| Phase | Description | Status |
|-------|-------------|--------|
| 1–2 | Scaffold, types, Zustand stores, UI layout | Done |
| 3 | 3D engine (Three.js scene, camera, lights, model loader) | Done |
| 4 | Lighting presets, material editor | Done |
| 5 | Animation system (keyframes, timeline, playback) | Done |
| 6 | Export system (image export, scene save/load) | Done |
| 7 | Undo/Redo history system | Done |
| **8** | **Post-Processing Pipeline (Bloom, SSAO, Vignette, Color Grading)** | **Done** |

### Phase 8 Changes

**Core: Real SSAO GPU Pass (`src/three/engine.ts`)**
- Replaced the Phase 7 ambient-light-intensity hack in `setAO()` with a real `SSAOPass` from `three/addons/postprocessing/SSAOPass.js`
- SSAO pass is added to the `EffectComposer` chain in `build()` after RenderPass and before Vignette
- Added `_ssaoPass` field, `_applyAOParams()` helper for radius/intensity mapping
- `kernelRadius` maps to the UI "Radius" slider
- `maxDistance` scales with UI "Intensity" slider for visible AO strength control
- SSAO enable/disable triggers a composer rebuild (structural change detection)
- SSAO resize handled in `resize()`
- SSAO disposed properly in `dispose()`

**Post-Processing Pipeline Summary (all 4 passes now real GPU passes):**
1. **Bloom** — `UnrealBloomPass` (was already working since Phase 6)
2. **SSAO** — `SSAOPass` (was a stub, now a real screen-space AO pass)
3. **Vignette** — Custom `ShaderPass` with VignetteShader (was already working)
4. **Color Grading** — Custom `ShaderPass` with ColorGradingShader (brightness/contrast/saturation) (was already working)

**Pre-existing TypeScript Error Fixes:**
- `TopMenubar.tsx`: Added missing `useMemo` import, fixed optional-before-required parameter order, typed `Object.values()` iterations with `as MenuItem` casts
- `animationStore.ts`: Added missing `advanceFrame()` method implementation
- `ImageExporter.ts`: Fixed `getAttribute('alpha')` → `getContextAttributes()?.alpha` with proper WebGL2 cast
- `SceneExporter.ts`: Added missing export-related fields to `SceneFile.renderSettings` interface, added `SceneState` import, used proper type assertion for import

**UI/Label Updates:**
- `RenderSettingsPanel.tsx`: Updated AO section note from "Full SSAO pass in Phase 6. Currently adjusts ambient light." → "Screen-space ambient occlusion (SSAO). Adds contact shadows in creases and corners."
- `AppLayout.tsx`: Version label updated from "Phase 7" → "Phase 8" (status bar + about modal)

### Architecture

- **Framework**: Vite + React 18 + TypeScript
- **3D**: Three.js 0.165.0 with vanilla `EffectComposer` (no R3F)
- **State**: Zustand stores (sceneStore, lightsStore, uiStore, animationStore, historyStore, presetsStore)
- **Render Pipeline**: `src/three/engine.ts` → `RenderPipeline` class manages `EffectComposer` with chain: RenderPass → [SSAOPass] → [UnrealBloomPass] → [FXAA/SMAA] → [Vignette ShaderPass] → [ColorGrading ShaderPass]
- **UI Panels**: Left toolbar (light list), Right panel (properties/preview/material tabs), Bottom (timeline + presets), Modal (render settings, export, about)