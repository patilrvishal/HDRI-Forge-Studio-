"""
Maya + Arnold orientation test for the Live HDRI sky. Run inside Maya (Script Editor, Python tab):

    exec(open(r"F:\\AI\\App_Development\\HDRI_Forge_Studio\\bridge-core\\tests\\maya_orient_test.py").read())

Before running, in a shell:   python bridge-core/tests/hdr_peak.py "%TEMP%\\forge_peak.json"
(it finds the brightest spot of Forge's streamed map and the direction Forge means by it).

The test renders what an Arnold camera aimed along that direction sees, with the live dome in place:
  * at the plug-in's FORGE_TO_MAYA_Y_ROTATION   -> the light must be centred (bright)
  * rotated 180 degrees from that               -> it must NOT be there (the control)
and it prints a scan over four dome rotations, so a wrong constant shows the right one.
"""
import json
import os
import sys
import time

import maya.api.OpenMaya as om
import maya.cmds as cmds

TEMP = os.environ.get("TEMP", ".")
PLUG_DIR = os.path.join(os.path.expanduser("~"), "Documents", "maya", cmds.about(version=True)[:4], "plug-ins")
LOG = os.path.join(TEMP, "maya_orient_test.log")
LINES, RESULTS = [], []


def out(s):
    print(s)
    LINES.append(s)


def check(cond, msg):
    out(("PASS  " if cond else "FAIL  ") + msg)
    RESULTS.append(bool(cond))


def aim(cam_xform, direction):
    """Point a camera at the origin along `direction` (a camera looks down its local -Z)."""
    q = om.MQuaternion(om.MVector(0, 0, -1), om.MVector(*direction).normal())
    e = q.asEulerRotation()
    cmds.xform(cam_xform, worldSpace=True, translation=(0, 0, 0), rotation=(
        om.MAngle(e.x).asDegrees(), om.MAngle(e.y).asDegrees(), om.MAngle(e.z).asDegrees()))


def render_luminance(cam_xform):
    """Arnold render at 16x16, written from the Render View as a PNG; mean of the centre pixels."""
    cmds.setAttr("defaultRenderGlobals.currentRenderer", "arnold", type="string")
    cmds.setAttr("defaultResolution.width", 16)
    cmds.setAttr("defaultResolution.height", 16)
    cmds.setAttr("defaultResolution.deviceAspectRatio", 1.0)
    cmds.setAttr("defaultRenderGlobals.imageFormat", 32)            # PNG
    if cmds.objExists("defaultArnoldRenderOptions"):
        cmds.setAttr("defaultArnoldRenderOptions.AASamples", 1)
    cmds.arnoldRender(cam=cam_xform, width=16, height=16)
    path = os.path.join(TEMP, "maya_orient_probe.png")
    if os.path.exists(path):
        os.remove(path)
    cmds.renderWindowEditor("renderView", edit=True, writeImage=path)
    try:
        from PySide2 import QtGui                                   # Maya 2022-2024
    except ImportError:
        from PySide6 import QtGui                                   # Maya 2025+
    img = QtGui.QImage(path)
    if img.isNull():
        raise RuntimeError("the Render View wrote no image to %s" % path)
    w, h = img.width(), img.height()
    total, n = 0.0, 0
    for y in range(h // 2 - 2, h // 2 + 2):
        for x in range(w // 2 - 2, w // 2 + 2):
            c = img.pixelColor(x, y)
            total += (c.red() + c.green() + c.blue()) / 3.0
            n += 1
    return total / n


def pump(hm, until, seconds=25.0):
    end = time.time() + seconds
    while time.time() < end:
        hm._live_tick()
        if until():
            return True
        time.sleep(0.05)
    return until()


def run():
    out("Maya %s" % cmds.about(version=True))
    with open(os.path.join(TEMP, "forge_peak.json")) as fh:
        peak = json.load(fh)
    direction = peak["direction"]
    out("target: Forge peak %.1f (mean %.2f) at pixel %s, direction (%.3f, %.3f, %.3f), map v%d"
        % (peak["peak"], peak["mean"], peak["pixel"], direction[0], direction[1], direction[2], peak["version"]))

    if PLUG_DIR not in sys.path:
        sys.path.insert(0, PLUG_DIR)
    for m in ("hdri_forge_bridge_maya", "forge_link_core"):
        sys.modules.pop(m, None)
    import hdri_forge_bridge_maya as hm

    if not cmds.pluginInfo("mtoa", query=True, loaded=True):
        cmds.loadPlugin("mtoa", quiet=True)
    cmds.file(new=True, force=True)

    hm.live_start()
    ok = pump(hm, lambda: hm._live["link"].status()["final"] and hm._live["link"].status()["version"] >= peak["version"]
              and bool(hm._bridge_domes(hm.LIVE_KIND)))
    check(ok, "the final map (v%d) is on the live dome" % peak["version"])
    if not ok:
        out("status: %s" % hm._live["link"].status())
        return
    xform, shape = hm._bridge_domes(hm.LIVE_KIND)[0]

    cam, cam_shape = cmds.camera(focalLength=200)                   # ~10 degree field of view
    rot = hm.FORGE_TO_MAYA_Y_ROTATION
    peaks = peak.get("peaks") or [{"pixel": peak["pixel"], "peak": peak["peak"], "direction": peak["direction"]}]
    out("using %d light(s); two well-separated lights rule out a mirrored sky, which one light cannot" % len(peaks))

    best_per_light = []
    for n, pk in enumerate(peaks):
        toward = pk["direction"]
        away = [-c for c in toward]
        scan = {}
        for ry in range(0, 360, 15):
            cmds.setAttr(xform + ".rotateY", ry)
            aim(cam, toward)
            scan[ry] = render_luminance(cam)
        plateau = [k for k, v in scan.items() if v >= 0.9 * max(scan.values())]
        # centre of the bright plateau, on a circle (angles wrap at 360)
        import math
        cx = sum(math.cos(math.radians(a)) for a in plateau)
        cy = sum(math.sin(math.radians(a)) for a in plateau)
        centre = math.degrees(math.atan2(cy, cx)) % 360
        best_per_light.append(centre)
        out("light %d at (%.2f, %.2f, %.2f): bright for rotateY in %s -> centre %.0f deg" % (n + 1, toward[0], toward[1], toward[2], plateau, centre))

        cmds.setAttr(xform + ".rotateY", rot)
        aim(cam, toward)
        l_toward = render_luminance(cam)
        aim(cam, away)
        l_away = render_luminance(cam)
        cmds.setAttr(xform + ".rotateY", rot + 180)
        aim(cam, toward)
        l_wrong = render_luminance(cam)
        out("  at rotateY=%g: toward %.0f | away %.0f | control (+180) %.0f" % (rot, l_toward, l_away, l_wrong))
        check(l_toward > 1.6 * max(l_away, 1.0) and l_toward > 180, "ORIENTATION light %d: Arnold shows the light where Forge put it (%.0f vs %.0f away)" % (n + 1, l_toward, l_away))
        check(l_wrong < 0.6 * l_toward, "CONTROL light %d: rotated 180 degrees it is NOT there (%.0f)" % (n + 1, l_wrong))

    if len(best_per_light) > 1:
        spread = abs((best_per_light[0] - best_per_light[1] + 180) % 360 - 180)
        check(spread <= 20, "no mirroring: both lights agree on the best rotation (%.0f vs %.0f deg)" % (best_per_light[0], best_per_light[1]))

    hm.live_stop()
    cmds.delete(cam)


try:
    run()
except Exception:
    import traceback
    out("EXCEPTION\n" + traceback.format_exc())
    RESULTS.append(False)

out("\n%d check(s) failed" % RESULTS.count(False) if False in RESULTS else "\nALL %d CHECKS PASSED" % len(RESULTS))
try:
    with open(LOG, "w", encoding="utf-8") as fh:
        fh.write("\n".join(LINES))
except OSError:
    pass
