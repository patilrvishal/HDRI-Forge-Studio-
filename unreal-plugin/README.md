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

## Use

| Menu item | What it does |
|---|---|
| **Start live HDRI** | Connects to HDRI Forge Studio (desktop app or dev server, found automatically) and shows its map on an HDRI Backdrop. Every edit in Forge arrives as progressive passes (256, 512, 1024, final); the newest always wins. Stop removes everything it made and shows your own Sky Lights again. |
| **Import HDRI** | Saves Forge's current map and its `.ash` to `<Project>/HDRIForgeSource/` and keeps it as a real TextureCube asset in `/Game/HDRIForge/Imported` on an HDRI Backdrop. Permanent, unlike Live. |
| **Restore my sky** | Removes every actor the bridge made and un-hides your own sky lights. |
| **Push cameras to Forge** | Sends the selected cameras (or all Camera / Cine Camera actors if none are selected) plus the editor viewport to Forge. |

In Forge, **Import cameras > Unreal Engine** pulls the same cameras from this plug-in (it listens on `127.0.0.1:8977`).

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
sun ends up in the wrong place for you, add a yaw with `set_sky(yaw=...)`.

## Tests

* `python -m unittest discover -s unreal-plugin/tests -v` - camera maths (no Unreal needed).
* `python unreal-plugin/tests/run_unreal_test.py "E:/UE4/UE_5.8"` - drives the real plug-in inside a headless Unreal Editor
  against a mock Forge: texture import, backdrop, hiding/restoring your sky, camera maths, the camera listener, the menu.

Keep `forge_link_core.py` identical across add-ons: edit `bridge-core/forge_link_core.py`, then run `python bridge-core/sync.py`.
