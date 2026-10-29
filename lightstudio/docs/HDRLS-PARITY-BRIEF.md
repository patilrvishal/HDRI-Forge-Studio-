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

## Scoped, not yet implemented

These need design decisions or touch rendering-critical paths (`HDRIExporter.ts`'s
per-pixel compositing, `evaluateLightRadiance`'s projection math) that deserve their
own focused session rather than a rushed bolt-on, given how much testing rigor this
project holds itself to (see the parity-run memory: every control re-verified via
real DOM clicks, not just store calls).

1. **Per-light compositing controls** — HDR Light Studio exposes, per individual
   light: Blend Channel, Preserve Alpha, Mapping (3D vs Infinite Plane), and an
   explicit Area Light checkbox. Today `src/types/Light.ts`'s `Light` interface only
   has `blendMode` + `blendInvert` (`LightProperties.tsx:538-547`'s "Blend" section).
   - **Blend Channel**: needs a defined semantic for this renderer specifically —
     today each light contributes `(r,g,b,coverage)` per pixel
     (`HDRIExporter.ts:937-960`); there's no separate alpha channel carried through
     the final composite to let a "Channel: Alpha only" option mean something
     precise. Decide: does it mask/multiply only `coverage` without touching RGB, or
     something else? Write the semantic down before implementing.
   - **Preserve Alpha**: same blocker — needs a defined meaning against this
     specific compositing model before it can do anything but exist as a no-op
     checkbox.
   - **Mapping (3D / Infinite Plane)**: changes how the light's appearance texture
     projects — real 3D angular projection (current, implicit) vs. parallel/infinite-
     plane projection. This is in `evaluateLightRadiance` (wherever it does its
     direction→UV mapping for area-type lights) — needs that function read in full
     before touching it; don't guess at the projection math.
   - **Area Light checkbox**: `Light.areaLight` already exists but is auto-derived
     from `type` (`LightProperties.tsx:262`: `areaLight: isAreaType`), not
     user-toggleable — intentionally left alone this pass, since exposing it raw
     risks desyncing from that derivation elsewhere (presets, Blender bridge,
     `objectLightApi.ts`). If genuinely wanted, it needs to become either a real
     independent flag with its own handling everywhere `isAreaType` currently gates,
     or explicitly documented as "redundant with light type, not exposed."

2. **Preset Library taxonomy** — HDR Light Studio has 6 tabs (Rig/Env/Light/Content/
   Element/Effect), each independently filterable by Type + Tag.
   `src/types/Preset.ts:28`'s `category` is a flat enum (`sidelights | studio |
   outdoor | spotlight | lightprofiles | custom`), rendered as flat tabs in
   `PresetBrowser.tsx:18-25`, with a free-text search only — `tags: string[]`
   (`Preset.ts:31`) exists on the data but isn't exposed as a facet filter.
   Suggested approach for a future pass: don't replace the existing category enum
   (it's load-bearing elsewhere); add a second, orthogonal `group` field
   (`'rig' | 'env' | 'light' | 'content' | 'element' | 'effect'`) that existing and
   new presets get tagged with, add a top-level group tab bar above the current
   category tabs, and wire the existing `tags` field into a real multi-select Tag
   filter dropdown next to the search box.

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
- Run `npx tsc --noEmit` and `npx oxlint` clean before calling anything done.
