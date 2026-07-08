# LightStudio — 3D Car Lighting Studio

## Project State: Phase 9 Complete

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
| 8 | Post-Processing Pipeline (Bloom, SSAO, Vignette, Color Grading) | Done |
| **9** | **HDRI Environment Browser** | **Done** |

### Phase 9 Changes

**New Files:**
- `src/types/Environment.ts` — 12 built-in HDRI preset definitions (studio, outdoor, creative categories). Each preset defines a set of emissive light panels with position, size, rotation, color, and intensity. Includes `EnvPanel`, `HDRIPreset` interfaces and helper functions.
- `src/components/Environment/EnvironmentBrowser.tsx` — Full modal UI component for browsing, searching, and selecting environment presets.

**Enhanced Files:**
- `src/three/EnvironmentLoader.ts` — Rewrote with `generateFromPreset()` that builds a procedural Three.js scene from an `HDRIPreset`'s panel definitions, bakes it through `PMREMGenerator.fromScene()`, and caches the result. Supports rotation parameter. Also supports `loadHDRI()` for custom .hdr file upload.
- `src/types/Scene.ts` — Added `presetId: string` and `rotation: number` to `EnvironmentState`. Default preset is `'studio-neutral'`.
- `src/store/sceneStore.ts` — Added `setEnvironmentPreset(presetId)` and `setEnvironmentRotation(rotation)` actions with undo/redo support.
- `src/store/uiStore.ts` — Added `envBrowserModalOpen` state and `setEnvBrowserModal()` action.
- `src/components/Viewport/Viewport.tsx` — Added `EnvironmentLoader` instance, applies default preset on mount, and syncs `presetId`/`rotation`/`intensity` changes to the 3D scene via a new `useEffect`.
- `src/components/Layout/AppLayout.tsx` — Wired `EnvironmentBrowser` modal from UI store, updated version label to "Phase 9".
- `src/components/Toolbar/TopMenubar.tsx` — Added "Environment Browser..." menu item under Canvas menu.
- `src/three/SceneExporter.ts` — Added `presetId` and `rotation` to the scene file interface for save/load compatibility.

**Built-in Environment Presets (12 total):**
| Preset | Category | Description |
|--------|----------|-------------|
| Neutral Studio | Studio | Balanced 3-point lighting, neutral white tones |
| Warm Studio | Studio | Golden key light, amber fill |
| Cool Studio | Studio | Blue-tinted for metallic/silver finishes |
| Dramatic | Studio | High-contrast with deep shadows |
| Ring Light | Studio | Even front-facing beauty/product lighting |
| Golden Hour | Outdoor | Warm sunset with long golden shadows |
| Overcast | Outdoor | Soft even cloudy sky lighting |
| Night Street | Outdoor | Dark moody nighttime with colored city accents |
| Neon Glow | Creative | Vibrant neon colors on dark background |
| Soft Gradient | Creative | Gentle top-to-bottom for clean product renders |
| Warehouse | Creative | Industrial strip lights, high ceiling |
| None (Flat) | Studio | No environment map, direct lights only |

### Architecture

- **Framework**: Vite + React 18 + TypeScript
- **3D**: Three.js 0.165.0 with vanilla `EffectComposer` (no R3F)
- **State**: Zustand stores (sceneStore, lightsStore, uiStore, animationStore, historyStore, presetsStore)
- **Render Pipeline**: `src/three/engine.ts` → `RenderPipeline` class manages `EffectComposer` with chain: RenderPass → [SSAOPass] → [UnrealBloomPass] → [FXAA/SMAA] → [Vignette ShaderPass] → [ColorGrading ShaderPass]
- **Environment Pipeline (Phase 9)**: `src/three/EnvironmentLoader.ts` → Generates PMREM environment maps from procedural panel definitions. Cached per preset+rotation combo. Synced via `Viewport.tsx` useEffect.
- **UI Panels**: Left toolbar (light list), Right panel (properties/preview/material tabs), Bottom (timeline + presets), Modal (render settings, environment browser, export, about)