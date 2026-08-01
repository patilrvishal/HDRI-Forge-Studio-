# LightForge Studio — Session Handoff Notes

## Project
- **Path**: `/home/z/my-project/lightstudio/`
- **Stack**: Vite + React + Three.js r165 + Zustand + TypeScript
- **Archive**: `lightforge-studio-PHASE-A-COMPLETE.tar.gz` (173KB, excludes node_modules/.git/dist)

---

## ALL PHASES COMPLETE (A through G)

### Phase A — Critical HDRI Fixes ✅
**File**: `src/three/HDRIExporter.ts`

**Root cause of both A1 and A2**: `MeshBasicMaterial` in Three.js r165 applies internal color space management. Even with `renderer.outputColorSpace = LinearSRGBColorSpace`, the standard material's fragment shader pipeline was processing colors through color space conversion, which:
1. Desaturated HDR colors toward white (losing hue information)
2. Effectively clamped values > 1.0 before the HalfFloat framebuffer received them

**Fix**: Replaced all `MeshBasicMaterial` light proxy materials with a raw `ShaderMaterial` that:
- Takes a `hdrColor` uniform (vec3 with values 20–1000)
- Outputs `vec4(hdrColor * brightness, 1.0)` directly with NO color space conversion
- Includes a subtle facing-factor (`0.5 + 0.5 * |N·V|`) for angle-dependent brightness
- The shared material is created once in `captureSceneToHDRI()` and cloned per light

**Diagnostic added**: After pixel readback, logs max pixel value and non-black pixel count to console.

### Phase B — Broken Light Editing ✅ (completed in user's separate session)
### Phase C — LightForge Studio Rename ✅ (completed in user's separate session)
### Phase D — Final Render Panel ✅ (completed in user's separate session)
### Phase E — Export & Data Persistence ✅ (completed in user's separate session)
### Phase F — UI Polish & Dead Code ✅ (completed in user's separate session)
### Phase G — Advanced Features ✅ (completed in user's separate session)

---

## Key Technical Details

### HDRI Export Pipeline (current, working)
1. Renderer state: `NoToneMapping`, `exposure=1.0`, `LinearSRGBColorSpace`
2. Capture scene: pure black background + raw ShaderMaterial light proxies + optional custom .hdr as sky dome
3. CubeCamera renders 6 faces at `max(512, resolution)` into HalfFloatType CubeRenderTarget
4. Equirectangular projection via custom ShaderMaterial (`textureCube` sampling)
5. Pixel readback: `Uint16Array` → `halfToFloat()` → `Float32Array` (RGB, top-to-bottom)
6. Encoding: Radiance RGBE (.hdr, uncompressed) or OpenEXR (.exr, FLOAT channels, NO_COMPRESSION)

### Light Proxy Brightness
- Formula: `max(20, min(1000, intensity * 50))`
- intensity 0.1 → 20, intensity 1.0 → 50, intensity 5.0 → 250, intensity 50+ → 1000

### HDR Proxy Shader (key code)
```glsl
// Fragment shader — outputs unclamped linear HDR values
uniform vec3 hdrColor;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float facing = abs(dot(normalize(vWorldNormal), viewDir));
  float brightness = 0.5 + 0.5 * facing;
  gl_FragColor = vec4(hdrColor * brightness, 1.0);
}
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/three/HDRIExporter.ts` | Main HDRI/EXR export logic (capture + encode) — Phase A fixes applied |
| `src/three/engine.ts` | SceneManager, LightManager, ModelLoader |
| `src/three/EnvironmentLoader.ts` | Procedural HDRI presets, custom HDRI loading |
| `src/components/Toolbar/TopMenubar.tsx` | Export button handlers |
| `src/store/sceneStore.ts` | Environment state (presetId, rotation, etc.) |
| `src/types/Environment.ts` | EnvPanel interface, preset definitions |
| `src/types/Scene.ts` | SceneState, default `presetId: 'studio-neutral'` |