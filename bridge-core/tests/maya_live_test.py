"""
Maya integration test for the Live HDRI link. Run it inside Maya (Script Editor, Python tab):

    exec(open(r"F:\\AI\\App_Development\\HDRI_Forge_Studio\\bridge-core\\tests\\maya_live_test.py").read())

HDRI Forge Studio must be running and streaming ("Erik Live" on, at least one light), and Arnold
(mtoa) must be available. It works in a scratch scene and cleans up after itself. Results are printed
and also written to maya_live_test.log next to this file's scratchpad (see LOG below).

Checks, against the REAL Forge stream and the REAL plug-in code:
  1. Start live       -> a separate bridge sky dome appears, the artist's dome is hidden, not edited
  2. The map arrives  -> the dome's file node points at a real downloaded .hdr
  3. No echo          -> Push-to-Forge reads the artist's dome, never ours
  4. Stop live        -> our nodes are gone and the artist's dome is visible again
  5. Import HDRI      -> .hdr + .ash saved, sky dome set, Restore puts the artist's dome back
  6. The panel        -> the UI builds and the Live tab refreshes without errors
"""
import os
import sys
import time

import maya.cmds as cmds

PLUG_DIR = os.path.join(os.path.expanduser("~"), "Documents", "maya", cmds.about(version=True)[:4], "plug-ins")
LOG = os.path.join(os.environ.get("TEMP", "."), "maya_live_test.log")
RESULTS = []
LINES = []


def out(s):
    print(s)
    LINES.append(s)


def check(cond, msg):
    out(("PASS  " if cond else "FAIL  ") + msg)
    RESULTS.append(bool(cond))


def pump(hm, until, seconds=20.0):
    """Stand-in for the QTimer, so the test is deterministic and does not depend on the event loop."""
    end = time.time() + seconds
    while time.time() < end:
        hm._live_tick()
        if until():
            return True
        time.sleep(0.05)
    return until()


def run():
    out("Maya %s" % cmds.about(version=True))
    if PLUG_DIR not in sys.path:
        sys.path.insert(0, PLUG_DIR)
    for m in ("hdri_forge_bridge_maya", "forge_link_core"):
        sys.modules.pop(m, None)
    import hdri_forge_bridge_maya as hm

    if not cmds.pluginInfo("mtoa", query=True, loaded=True):
        cmds.loadPlugin("mtoa", quiet=True)
    check(cmds.pluginInfo("mtoa", query=True, loaded=True), "Arnold (mtoa) is loaded")

    cmds.file(new=True, force=True)
    tmp = os.path.join(os.environ.get("TEMP", "."), "forge_maya_test")
    os.makedirs(tmp, exist_ok=True)

    # the artist's own sky dome, with its own HDR so "no echo" is a real test
    artist_hdr = os.path.join(tmp, "artist_sky.hdr")
    with open(artist_hdr, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n\x80\x80\x80\x81")
    shape = cmds.createNode("aiSkyDomeLight", name="ArtistSkyShape")
    artist = cmds.listRelatives(shape, parent=True)[0]
    f = cmds.shadingNode("file", asTexture=True, isColorManaged=True, name="ArtistSky_file")
    cmds.setAttr(f + ".fileTextureName", artist_hdr, type="string")
    cmds.connectAttr(f + ".outColor", shape + ".color", force=True)
    check(cmds.getAttr(artist + ".visibility") == 1, "setup: the artist's dome is visible")

    # 1. start ------------------------------------------------------------------------------------
    hm.live_start()
    check(hm._live["running"], "live link starts")
    got = pump(hm, lambda: bool(hm._bridge_domes(hm.LIVE_KIND)))
    check(got, "a map arrives from Forge within 20 s (is Forge running with Erik Live on?)")
    if not got:
        out("Link status: %s" % hm._live["link"].status())
        return

    xform, dshape = hm._bridge_domes(hm.LIVE_KIND)[0]
    check(xform != artist, "the live dome is a separate node from the artist's")
    check(cmds.getAttr(artist + ".visibility") == 0, "the artist's dome is hidden while live runs")
    fn = (cmds.listConnections(dshape + ".color", source=True, destination=False, type="file") or [None])[0]
    path = cmds.getAttr(fn + ".fileTextureName") if fn else ""
    check(path.endswith(".hdr") and os.path.exists(path), "the dome's file node points at a downloaded map (%s)" % os.path.basename(path))
    st = hm._live["link"].status()
    check(st["state"] == "streaming" and st["width"] >= 256, "link is streaming %dx%d" % (st["width"], st["height"]))
    check(abs(cmds.getAttr(xform + ".rotateY") - hm.FORGE_TO_MAYA_Y_ROTATION) < 1e-6, "dome rotation is the measured value (%.0f deg)" % hm.FORGE_TO_MAYA_Y_ROTATION)

    # 3. no echo ----------------------------------------------------------------------------------
    echo = hm._gather_world_arnold()
    check(echo is not None and echo.get("fileName") == "artist_sky.hdr", "Push to Forge reads the ARTIST's dome, not the live one (no echo)")

    # 6. the panel --------------------------------------------------------------------------------
    try:
        hm.show_ui()
        hm._refresh_live_ui()
        ok_ui = cmds.window(hm.WINDOW_NAME, exists=True)
        lbl = cmds.button(hm._ui["live_toggle"], query=True, label=True)
        check(ok_ui and lbl == "Stop live HDRI", "the panel builds and the Live tab shows Stop while running")
    except Exception as e:
        check(False, "the panel builds without errors (%r)" % e)

    # 4. stop -------------------------------------------------------------------------------------
    hm.live_stop()
    check(not hm._live["running"], "live link stops")
    check(not hm._bridge_domes(), "our sky dome is gone")
    check(not [n for n in (cmds.ls("HDRIForge*") or [])], "no HDRIForge* node left behind")
    check(cmds.getAttr(artist + ".visibility") == 1, "the artist's dome is visible again after Stop")
    try:
        lbl = cmds.button(hm._ui["live_toggle"], query=True, label=True)
        check(lbl == "Start live HDRI", "the panel button goes back to Start")
    except Exception as e:
        check(False, "panel refresh after stop (%r)" % e)

    # 5. import -----------------------------------------------------------------------------------
    real_ws = cmds.workspace
    cmds.workspace = lambda *a, **k: (tmp + "/") if k.get("rootDirectory") else real_ws(*a, **k)
    try:
        frame = hm.import_hdri()
    finally:
        cmds.workspace = real_ws
    check(frame is not None, "Import HDRI succeeds")
    if frame is not None:
        check(frame.path.endswith(".hdr") and os.path.exists(frame.path), "the .hdr was saved (%s)" % os.path.basename(frame.path))
        check(bool(frame.ash_path) and os.path.exists(frame.ash_path), "the matching .ash was saved next to it")
        imp = hm._bridge_domes(hm.IMPORT_KIND)
        check(len(imp) == 1, "the imported sky dome exists")
        check(cmds.getAttr(artist + ".visibility") == 0, "the artist's dome is hidden while the imported dome is active")
    hm.restore_sky()
    check(not hm._bridge_domes() and cmds.getAttr(artist + ".visibility") == 1, "Restore my sky puts the artist's dome back")

    try:
        if cmds.window(hm.WINDOW_NAME, exists=True):
            cmds.deleteUI(hm.WINDOW_NAME)
    except Exception:
        pass


try:
    run()
except Exception:
    import traceback
    out("EXCEPTION\n" + traceback.format_exc())
    RESULTS.append(False)

failed = RESULTS.count(False)
out("\n%d check(s) failed" % failed if failed else "\nALL %d CHECKS PASSED" % len(RESULTS))
try:
    with open(LOG, "w", encoding="utf-8") as fh:
        fh.write("\n".join(LINES))
except OSError:
    pass
