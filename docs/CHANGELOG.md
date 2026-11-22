# HDRI Forge Studio - changelog

## Unreleased

### High Key White, closer to its card
- Ceiling panels sized to the card (about 40% and 24% of the frame width) with a thin light tray instead of a dark housing; softboxes moved out to about 11% / 89% of the frame width, turned toward the centre, with their tripods standing under them.
- Charcoal ceiling (#1A1D20), thicker but softer wall rim glow, lower panel and softbox glow, and a gentler bloom set when the rig is applied so the white room is not washed out.
- Rig lights no longer show their wire outline boxes.

### Lighting preset card component
- New reusable `LightingPresetCard` (React + TypeScript + Tailwind, 560:352, 74% / 26% split, gold outline, hover lift, selected glow, keyboard accessible) and a small example grid, in `src/components/Presets/`.

### New Scene
- **Fix:** New Scene now clears everything: the studio rig (room, fixtures, shadow lights), HDRI layers and shapes, mesh objects, the loaded model (GLB or Erik) and its materials, imported cameras and the hierarchy state. Before, the last scene's studio set and layers stayed on screen.

## 0.1.30

### Reflections of picture lights
- The reflection of a light that shows a picture (a Lumi-Curve, a ring, an umbrella...) on the model now has the picture's shape; before it was always a small rectangle. The viewport puts the same composite the HDRI Preview and the Erik link use (HDRI layers, shapes, gradient and these lights) into the environment, scaled so the model gets the same overall light as before, and mutes the light's plain rectangle so it is not counted twice. Plain lights are unchanged, the real environment returns when no picture light is left, and the path tracer is left alone.

### Lumi-Curve Editor window
- New floating **Lumi-Curve Editor** (like HDR Light Studio's): the light drawn live on black with the curve over it, a tool column on the left (move point / tangent / glow handle, add point by click and drag, delete, move all, rotate, scale, flip, fix tangents, delete all) and a view column on the right (zoom, pan, fit, straighten, snap, preview).
- The selected point shows a **green** and a **blue** handle: drag them to set how far the glow reaches on each side; the light, the reflections and the Erik live link follow at once.
- Opens from the right-click menu of a Lumi-Curve light (Edit Lumi-Curve...), from the Light Appearance panel (Open Lumi-Curve Editor), and automatically after Draw Lumi-Curve on the Canvas.

## 0.1.29

### Viewport lights
- Library lights (softboxes, strips, octabox, umbrella, shape presets) show their icon in the viewport without the outline box.
- They also get the icon's metal frame and corner studs (viewport only; never part of the HDRI or the Erik live link).
- The viewport picture is sharper: 640 px instead of 192, with a higher glow cap so it is not faded.
- Lights added before this version have no frame data: delete and re-add them from the library.

## 0.1.28

### Rigs (Rig tab > Studio)
- **High Key White** re-matched to its card: ceiling panels, corner softboxes aimed inward, split left / back / right walls with their own glow, darker floor and lighter ceiling, and the viewport opens on the card's camera view.
- Ceiling panels are larger (3.4 x 1.7 m and 2.4 x 1.3 m) and the light sits inside a frame.

### Lights and presets
- **Umbrella** light looks like its icon in the viewport (eight-sided canopy, ribs, dimmer rim). New Ribs / Rim falloff / Rotation controls on Polygon content.
- **Octabox** has a flat top like its icon; polygon shape presets get the icon's dimmer rim.
- Lights added from the preset library show their picture in the viewport (viewport-only emitter, visible from both sides).
- **Fix:** library lights were kept out of the HDRI and the Erik live link (Area Light mode had been switched on); they are included again.

### Viewport controls
- **Click to select:** clicking a light selects it; clicking an object selects it and shows the Move gizmo; clicking opens its material.
- **G / R / S** switch the Move / Rotate / Scale tool (gizmo and toolbar follow) and start a Blender-style transform: type a value (S 1.5, G X 2, R Z 45), X / Y / Z lock an axis, Enter or click confirms, Esc cancels. Works on lights and objects.
- **Arrow keys** nudge the selection with the active tool: Move / Rotate use all four arrows (Shift = third axis), Scale uses Up / Down only. Alt = fine, Ctrl = coarse.
- **Delete / Backspace** removes the selected object.
- **Global / Local / View** orientation switch is always visible and drives the gizmo.
- **LightPaint:** Ctrl + left click / drag paints anywhere; **T** turns the LightPaint mode on and off, and the viewport does not rotate while it is on.
- **Right-click menus** per object type: lights (properties, G/R/S, aim, brightness, size, hide, isolate, duplicate, delete), mesh objects (mesh tools, **Subdivision Surface** levels 1-3, material, include in HDRI, hide, frame) and other parts (loaded meshes, rig pieces).
- **Fixes:** the gizmo no longer shows its hidden pick handles after Isolate / Show All; the viewport no longer rotates while a gizmo handle is dragged; submenus are no longer clipped.

### Erik Adjuster link
- **Import from Erik (selected HDRI):** New Layer / Create menu entry. Forge asks Erik for the HDRI selected in its Live Link panel, adds it as a Custom HDRI layer and starts the live link so edits stream back onto that HDRI. New bridge endpoints `request-erik-hdri` and `erik-hdri` (dev server and desktop app). Needs the matching `hdri-livelink.js` in Erik.
- **Default gradient light:** a one-click pill next to the Erik Live badge turns off the default grey Gradient background, which is baked into the HDRI sent to Erik.
