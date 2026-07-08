---
Task ID: 1
Agent: Main Agent
Task: Verify and fix PBR Material Editor + Custom HDRI persistence

Work Log:
- Audited all Phase 10 files: types/MaterialEditor.ts, materialEditorStore.ts, modelDataStore.ts, hdriDataStore.ts, MaterialManager.ts, MaterialEditorPanel.tsx, SceneExporter.ts, Viewport.tsx, AppLayout.tsx, EnvironmentBrowser.tsx, engine.ts, sceneStore.ts
- Fixed TS2503: Added `import * as THREE from 'three'` and proper `MaterialManager` type import in MaterialEditorPanel.tsx
- Fixed runtime bug: AppLayout was passing `sceneManagerRef` (SceneManager) as `sceneRef` (THREE.Scene). Created dedicated `sceneRef` and populated it in `handleViewportReady`
- Fixed critical scene-restore bug: Material states imported from scene file were being overwritten when model loaded. Added merge logic in Viewport.tsx that checks for saved material states and re-applies them after model extraction + rebuildMaterialMap
- Fixed async texture loading: `getOrCreateTexture()` was synchronous but `THREE.TextureLoader.load()` is async, always returning null on first call. Replaced with `loadTextureAsync()` returning Promise, with proper cache
- Fixed pre-existing TS error: `main.tsx` imported `App.tsx` with extension, changed to `App`
- Fixed `tsconfig.node.json`: TS 5.4 incompatible with `es2023` target and `erasableSyntaxOnly` option
- Fixed `vite.config.ts`: Added `css.postcss` path to prevent parent project's PostCSS config from leaking
- Verified: `tsc -b && vite build` compiles cleanly with zero errors
- Verified: All 116 modules transform, production build outputs correctly (4 chunks)

Stage Summary:
- PBR Material Editor: Fully functional with 8 texture map slots, color/roughness/metalness/emissive sliders, toggles (transparent, double-sided, flat shading), material list sidebar with color swatches
- Custom HDRI: Persistence via hdriDataStore (ArrayBuffer→base64 in scene file), proper Viewport restore effect with fallback
- Material save/load: Scene file includes material states, on restore merges saved edits over extracted defaults and applies to Three.js
- Build: Clean, zero TS errors, production-ready