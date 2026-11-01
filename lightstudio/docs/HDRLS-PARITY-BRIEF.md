# HDRI Forge Studio — HDR Light Studio Parity Brief

Use this as the prompt/spec when asking a Claude Code (or any AI coding) session to
continue closing the gap with HDR Light Studio 8. It records what the live survey
found, what's already shipped, and exactly what's left — with file:line precision so
no re-investigation is needed. Everything here is built from **our own code**: no
Lightmap source was read or copied, only their public UI (via official Demo Mode)
and published help docs were used as a functional reference.

## Context

HDRI Forge Studio (`lightstudio/`, package `lightforge-studio`) is a from-scratch
competitor to Lightmap's HDR Light Studio 8, built independently:
- Canvas, Composites, Looks tree, LightPaint, Lumi-Curve, Material editor, Modeling
  subsystem, Blender live bridge, and a built-in GPU path tracer (`three-gpu-pathtracer`)
  that HDR Light Studio has no equivalent of — already at or beyond parity.
- Sky model: Hosek-Wilkie (SIGGRAPH 2012, public research), not Lightmap's proprietary
  sky. Scrim: an original physically-plausible model, not their closed algorithm.
- See `[[project-hdrils-feature-parity-run]]` memory for the full history.

A follow-up live UI survey (HDR Light Studio 8.2.6, official Demo Mode) plus a direct
code read found four concrete, narrower gaps than "most things are missing":

## Shipped this pass

**Named appearance-content quick-create light types** — HDR Light Studio's Create
menu has 8 discrete named types (Round, Rect, Scrim, Box Grad, Gradient, Picture,
Dark, Sun Shade). Our app had the underlying capability (the Light Appearance content
system: `src/appearance/types.ts`'s `ContentType` already covers bulb/flat/gradient/
boxgrad/image/scrim) but no one-click way to create a light pre-loaded with one.

Added:
- 8 new `LIGHT_TEMPLATES` entries in `src/types/Light.ts` (`roundLight`, `rectLight`,
  `scrimLight`, `boxGradLight`, `gradientLight`, `pictureLight`, `darkLight`,
  `sunShadeLight`), each an Area light pre-loaded via `newAppearance(contentType, name)`
  from `src/appearance/content.ts` — the same factory the Appearance editor itself uses.
- `darkLight` and `sunShadeLight` use `blendMode: 'subtract'` / `'multiply'` on a
  black master, since that's what "darkens the environment beneath it" means in our
  existing per-light blend system (`HDRIExporter.ts:942-953`) — an original design,
  not reverse-engineered from Lightmap's Dark/Sun Shade Light internals (closed).
- New "Lights (Appearance)" submenu in `src/components/Toolbar/TopMenubar.tsx`'s
  Create menu, next to the existing engine-type-keyed "Lights" submenu.
- Verified live: `tsc --noEmit` 0 errors, `oxlint` 0 new errors, and a Scrim Light
  created through the real UI in the dev server renders its correct appearance
  content, thumbnail, and transform panel.

**Flat Background** — confirmed this already exists and works
(`EnvironmentState.background` + `showBackground`, `EnvironmentBrowser.tsx:196-206`,
rendered via `SceneManager.ts:205`/`engine.ts:383`). No code change needed — it's
just not framed as an explicit "Background Type" selector like HDR Light Studio's
Create menu does. Low priority; see below if picked up.

## Shipped in the follow-up pass

**Per-light compositing controls** (Light properties > Blend). Both are optional fields on `Light`
(`src/types/Light.ts`), flow through `Viewport.tsx` -> `engine.ts` userData -> `extractLightsFromScene`
and are applied in `HDRIExporter.ts`. Unset behaves exactly as before (tested).
- **Blend channel** (`blendChannel`: all / red / green / blue): the light writes only to that channel of
  the map; the other two stay as they were. Works with every blend mode. Our own semantic, chosen
  because our compositing carries (r,g,b) only.
- **Mapping** (`mapping`: perspective / plane): `perspective` is the previous gnomonic projection;
  `plane` drops the perspective divide and uses sin instead of tan for the half-extents, i.e. a parallel
  (orthographic) projection onto the light's plane. Large lights keep an even footprint and texture
  instead of stretching toward their edges. Small lights look the same either way.
- Tests: `npm run test:hdri` (`tests/hdri/light-compositing.test.ts`) bakes real THREE scenes through
  `generateAnalyticalHDRI` and checks channel isolation, mapping and that unset == default.

**Preset Library groups + tag filter** (`PresetBrowser.tsx`, `presetsStore.ts`, `types/Preset.ts`).
- New optional `Preset.group` (`rig | env | light | content | element | effect`) next to the untouched
  `category`. `presetGroup()` derives it for every existing preset: studio/outdoor/spotlight/sidelights
  = rig, light profiles = light, custom = rig if it has several lights else light. Saved presets and
  export/import keep working; an explicit `group` is round-tripped.
- A group tab bar (All + only the groups that actually hold presets) sits above the category tabs;
  the category tabs narrow to the categories present in the chosen group.
- A multi-select **Tags** filter next to the search box (a preset must carry every picked tag),
  built from the tags in the current group and category.
- Env / Content / Element / Effect have no built-in presets yet, so their tabs stay hidden until a
  preset carries that `group`.

## Preset Library upgrade (thumbnails, content, audition)

- **Baked thumbnails** (`src/three/presetBake.ts`): every preset card shows the real 2:1 equirect map its
  lights produce, from the same `generateAnalyticalHDRI` bake the HDRI Preview uses, tone-mapped with a log
  curve and a small glow so pinpoint lights stay visible. Saving a custom preset bakes its thumbnail too.
- **Original library** (`src/data/presetsExtra.ts`): 32 new rigs (studio, outdoor, spotlight, sidelights) and
  16 new single lights, all designed for this app's own light model. Nothing copied from any other product.
- **Audition** button in the Presets tab: arrow keys step through the shown presets (your lights + the
  preset, never stacking), Enter keeps the one on screen, Esc puts your lights back. Clicking a card while
  auditioning steps to it; double-click keeps it.
- **Bug fixed on the way**: the HDRI bake read a spot/directional light's own +Z facing instead of its target,
  so every sun landed in the same place and spots were invisible in the map. `aimDirection()` in
  `HDRIExporter.ts` now aims from the target (tested in `npm run test:hdri`).

## LightPaint v2 (precision and feel)

- **Picking** (`src/three/PaintPicker.ts`): clicks resolve against a BVH per mesh instead of three's brute-force
  raycast. On a ~1M-triangle mesh a pick takes ~0.01 ms against ~32 ms before, so dragging no longer stalls on
  heavy cars. BVHs are built a few at a time when LightPaint is switched on.
- **Only what is drawn counts**: hidden meshes (and children of hidden groups), helpers/proxies and fully
  transparent materials can no longer take the click. Before, a hidden variant mesh in front of the car stole
  it and the light landed somewhere the user never pointed.
- **Normals**: smooth, correct for non-uniformly scaled meshes (inverse transpose), and always turned to face
  the viewer so a back face cannot put the light inside the model.
- **Any camera**: the reflection is solved from the cursor ray itself, so it is exact for orthographic cameras too.
- **Feel**: a ring follows the cursor (bright over the model, faint over nothing), the whole stroke is one undo
  step, and Esc during a drag puts the light back.
- Tests: `npm run test:paint`.

## Decided not to build

- **Preserve Alpha**: the baked map is always opaque (alpha is written as 1 in `generateAnalyticalHDRI`),
  so there is no alpha channel to preserve. A checkbox would be a no-op. Revisit only if the map ever
  carries real alpha.
- **Area Light checkbox**: `Light.areaLight` is derived from `type` (`LightProperties.tsx:262`) and read
  by presets, the Blender bridge and `objectLightApi.ts`. Exposing it raw would let it drift out of
  sync with the type, so it is intentionally redundant with Light type and not exposed.

## Ground rules for whoever picks this up

- Never read or reference Lightmap/HDR Light Studio source, binaries, or
  reverse-engineered internals — only their public UI (Demo Mode) and published docs.
- Every new field/behavior needs its own original semantic for *this* renderer's
  actual compositing model — don't assume HDR Light Studio's internal meaning
  transfers; design it fresh and document the decision in a comment, same style as
  the existing `darkLight`/`sunShadeLight` comments in `Light.ts`.
- Verify through the real UI (dev server, actual clicks), not just store calls —
  this project's own history shows that gap (gizmo gave wrong deltas, shapes
  silently vanished from export) more than once.
- Run `npx tsc -p tsconfig.app.json --noEmit` (the root `tsc --noEmit` checks nothing: the root tsconfig only has project references) and `npx oxlint` clean before calling anything done.
