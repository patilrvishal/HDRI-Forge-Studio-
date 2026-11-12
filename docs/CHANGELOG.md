# HDRI Forge Studio - changelog

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
