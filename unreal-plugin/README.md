# HDRI Forge Bridge for Unreal Engine 5

The Unreal counterpart of the Blender and Maya bridges, built the same way as **Erik Adjuster's live link**:
HDRI Forge Studio streams its map to Unreal while you edit, Unreal lights the level with it, and cameras go both ways.

Built and tested against **Unreal Engine 5.8.4** (Python 3.11). It is a pure-Python editor plug-in: nothing to compile.

## Install

1. Copy the `HDRIForgeBridge` folder into your project's `Plugins` folder (create it if needed), or into
   `<UE>/Engine/Plugins/Marketplace` to have it in every project.
2. Open the project. If asked, enable **Python Editor Script Plugin** and **Editor Scripting Utilities**
   (the plug-in lists them as dependencies). Enable **HDRI Backdrop** too for a visible background.
3. An **HDRI Forge** menu appears in the main menu bar.

## Running it all the time

**Auto-start live** is on by default: every time the project opens, Live starts by itself a few seconds later, and because
Forge starts streaming as soon as an app links, opening Unreal and Forge is all it takes. It is remembered per project in
`<Project>/Saved/HDRIForgeBridge.json`. Turn it off or on from **HDRI Forge > Auto-start live** (or `b.set_auto_start(False)`).
Nothing is added to your level until a map actually arrives from Forge.

## Where to find it

After you restart the editor: the **HDRI Forge** menu at the end of the menu bar (after Help), and the **Forge Live** and
**Forge Import** buttons in the level editor toolbar (on a narrow window they sit under the three-dot overflow button at
the right of the Play buttons). Edit > Plugins, search "HDRI Forge", shows the plug-in itself.

## Use: the HDRI Forge control section

Everything lives in ONE place: the **HDRI Forge** drop-down button in the level editor toolbar (on a narrow window it is under
the three-dot overflow), and the same list under **HDRI Forge** in the menu bar. It is grouped:

| Group | Entries |
|---|---|
| **Connection** | Live status of the link (found Forge? which app/port? current map pass), and the outcome of the last send |
| **Live preview** | Start / stop the live preview (Forge starts streaming by itself) - Start automatically when the project opens - Show the HDRI as the level background - Brighter / Darker (+-0.5 EV) - Turn the sky +-15 degrees - Reset |
| **Import into the level** | **Import HDRI** keeps the current map as a saved TextureCube on an HDRI Backdrop, with its `.ash` in `<Project>/HDRIForgeSource/` - **Restore my own sky** removes everything the bridge made |
| **Send this scene to Forge** | **Everything** (cameras + lights + selected meshes), or **Cameras** only (selected, else all, plus the editor view), **Lights** only (point, spot, directional, rect), **Selected static meshes** only (exported as a `.glb` with Unreal's own glTF exporter) |
| **About** | Version and the name Forge shows for this connection |

The workflow is the same as with Erik Adjuster: start the live preview, edit in Forge and watch the level update, and when the
HDRI is right use **Import HDRI** to keep it in the level. In Forge, **Import cameras > Unreal Engine** also pulls the
cameras from this plug-in (it listens on `127.0.0.1:8977`).

Sending notes: positions are converted from Unreal (cm, Z up, left-handed) to Forge (metres, Y up); light brightness is mapped
with a starting-point factor (12 per candela, 20 per lux) because the units differ, so adjust brightness in Forge.

From the Python console you can also call, after `import hdri_forge_bridge_unreal as b`:
`b.set_sky(exposure_ev=0.5, yaw=15, background=True)` (exposure in EV, extra turn-around in degrees).

Forge shows the connection as **"Unreal 5.8.4 (Lumen)"** (it follows the level's GI method).

## What it creates

Everything is tagged `HDRIForgeBridge`: an `HDRIForgeLive` or `HDRIForgeImport` HDRI Backdrop actor (or a Sky Light if the
HDRI Backdrop plug-in is off) and textures under `/Game/HDRIForge`. Your own actors are never deleted; only hidden
temporarily while the bridge's sky is on.

## Coordinates

Unreal is left-handed, Z up, centimetres. The plug-in converts cameras to Forge's right-handed Y-up metres
(`x = Y/100, y = Z/100, z = -X/100`) before sending, so Forge needs no special handling. Forge's map is turned half a
turn about Z (derived from the engine's own long-lat code: Unreal's map centre faces -Y, Forge's faces what becomes +Y). If the
sun ends up in the wrong place for you, add a yaw with `set_sky(yaw=...)`. The orientation is confirmed by a rendered test:
markers placed at known Forge directions appear at the predicted Unreal directions.

## Tests

* `python -m unittest discover -s unreal-plugin/tests -v` - camera maths (no Unreal needed).
* `... run_unreal_test.py "E:/UE4/UE_5.8" --e2e` - against the REAL, running HDRI Forge Studio: Forge must start streaming by
  itself when Unreal links, and the map must arrive and show on the backdrop.
* `... run_unreal_test.py "E:/UE4/UE_5.8" --render` - a real rendering editor: scene captures prove where the map lands
  and that a new map from Forge appears in the rendered level straight away.
* `python unreal-plugin/tests/run_unreal_test.py "E:/UE4/UE_5.8"` - drives the real plug-in inside a headless Unreal Editor
  against a mock Forge: texture import, backdrop, hiding/restoring your sky, camera maths, the camera listener, the menu.

Keep `forge_link_core.py` identical across add-ons: edit `bridge-core/forge_link_core.py`, then run `python bridge-core/sync.py`.
