"""
Headless Blender integration test for the Live HDRI link.

Needs HDRI Forge Studio running and streaming ("Erik Live" on, at least one light).

  blender -b --factory-startup --python bridge-core/tests/blender_live_test.py

Checks, against the REAL Forge stream and the REAL addon code:
  1. Start live       -> a separate bridge World appears, the artist's World is untouched
  2. The map arrives  -> an image of the streamed size is wired through the Mapping node
  3. Orientation      -> a Cycles render aimed at the brightest spot of the map sees that spot,
                         and the same render rotated 180 degrees does not (the control)
  4. Stop live        -> the artist's World is back and nothing from the bridge is left behind
  5. Import HDRI      -> .hdr + .ash are saved, World is set, Restore puts the artist's World back
  6. No echo          -> Push-to-Forge ignores the bridge World
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "blender-addon"))
sys.path.insert(0, ADDON_DIR)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
import hdri_forge_bridge as hb  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        FAILS.append(msg)


def pump(until, seconds=15.0):
    """Stand-in for Blender's timer loop, which does not run in background mode."""
    end = time.time() + seconds
    while time.time() < end:
        hb._live_tick()
        if until():
            return True
        time.sleep(0.05)
    return until()


def live_world():
    return next(iter(hb._bridge_worlds(hb.LIVE_KIND)), None)


def read_pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4), w, h


def forge_dir_to_blender(px, py, w, h_total):
    """Map image pixel (row 0 = bottom, Blender's order) to the Blender direction Forge means by it."""
    top_row = h_total - 1 - py
    u = (px + 0.5) / w
    v = (top_row + 0.5) / h_total
    theta, phi = (u - 0.5) * 2 * math.pi, v * math.pi
    tx, ty, tz = math.sin(phi) * math.cos(theta), math.cos(phi), math.sin(phi) * math.sin(theta)   # Forge (three, Y-up)
    return (tx, -tz, ty)                                                                          # Blender (Z-up)


def render_center_luminance(scene, direction):
    """Cycles render of what a camera aimed along `direction` sees. World only, no objects."""
    cam_data = bpy.data.cameras.new("probe")
    cam_data.angle = math.radians(12)
    cam = bpy.data.objects.new("probe", cam_data)
    scene.collection.objects.link(cam)
    from mathutils import Vector
    cam.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 4
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = scene.render.resolution_y = 16
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    out = os.path.join(bpy.app.tempdir, "probe_render.exr")
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out, check_existing=False)
    arr, w, h = read_pixels(img)
    c = arr[h // 2 - 1:h // 2 + 1, w // 2 - 1:w // 2 + 1, :3].mean()
    bpy.data.images.remove(img)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
    return float(c)


# ── setup: register operators only (no direct-bridge server in a test) ─────────────────────
for cls in hb.classes:
    try:
        bpy.utils.register_class(cls)
    except Exception:
        pass

scene = bpy.context.scene
for ob in list(bpy.data.objects):          # the factory scene has a cube at the origin; the probe camera would sit inside it
    bpy.data.objects.remove(ob)
mine = bpy.data.worlds.new("MyWorld")
mine.use_nodes = True
mine.node_tree.nodes["Background"].inputs[0].default_value = (0.1, 0.2, 0.3, 1)
scene.world = mine

print("Blender", bpy.app.version_string)

# 1. start ------------------------------------------------------------------------------------
bpy.ops.hdribridge.live_toggle()
check(hb._live["running"], "live link starts")
got = pump(lambda: live_world() is not None)
check(got, "a map arrives from Forge within 15 s (is Forge running with Erik Live on?)")
if not got:
    print("Link status:", hb._live["link"].status())
    sys.exit(2)

lw = live_world()
check(scene.world is lw, "the scene World is the bridge World")
check(bpy.data.worlds.get("MyWorld") is mine, "the artist's World is still there, untouched")
check(scene.get(hb.PREV_WORLD_KEY) == "MyWorld", "the artist's World is remembered for Restore")

# 2. the map ----------------------------------------------------------------------------------
pump(lambda: hb._live["link"].status()["final"], seconds=15)
env = lw.node_tree.nodes["Forge Env"]
check(env.image is not None and env.image.size[0] >= 256, "an image is wired into the Environment Texture (%s)" % (tuple(env.image.size),))
mp = lw.node_tree.nodes["Forge Mapping"]
check(abs(mp.inputs['Rotation'].default_value[2] - hb.FORGE_TO_BLENDER_Z_ROTATION) < 1e-6, "Mapping node starts at the measured rotation (%.0f deg)" % math.degrees(hb.FORGE_TO_BLENDER_Z_ROTATION))
check(any(l.to_node.name == "Forge Background" for l in lw.node_tree.links), "Environment feeds the Background")

# 3. orientation (Cycles render, with a control) ------------------------------------------------
# Two lights at different azimuths: one light cannot tell a pure rotation from a mirrored sky.
arr, w, h = read_pixels(env.image)
lum = arr[..., :3].mean(axis=2)
mean = float(lum.mean())
order = np.argsort(lum.ravel())[::-1][: w * 40]
peaks = []
for idx in order:
    py, px = divmod(int(idx), w)
    d = forge_dir_to_blender(px, py, w, h)
    if all(sum(a * b for a, b in zip(d, q[2])) < math.cos(math.radians(25)) for q in peaks):
        peaks.append((px, py, d, float(lum[py, px])))
        if len(peaks) == 2:
            break
print("map %dx%d  mean %.4f  peaks: %s" % (w, h, mean, [(p[0], p[1], round(p[3], 1)) for p in peaks]))
check(len(peaks) == 2, "the streamed map has two separate bright lights to aim at (add two lights in Forge)")

for n, (bx, by, toward, pk) in enumerate(peaks, 1):
    away = tuple(-c for c in toward)
    check(pk > 20 * max(mean, 1e-6), "light %d is a distinct bright spot (peak %.1f vs mean %.4f)" % (n, pk, mean))
    mp.inputs['Rotation'].default_value = (0.0, 0.0, hb.FORGE_TO_BLENDER_Z_ROTATION)
    l_toward = render_center_luminance(scene, toward)
    l_away = render_center_luminance(scene, away)
    mp.inputs['Rotation'].default_value = (0.0, 0.0, math.pi)      # control: a half-turn must fail
    l_wrong = render_center_luminance(scene, toward)
    mp.inputs['Rotation'].default_value = (0.0, 0.0, hb.FORGE_TO_BLENDER_Z_ROTATION)
    print("light %d render luminance: toward %.3f | away %.3f | control(180deg) %.3f" % (n, l_toward, l_away, l_wrong))
    check(l_toward > 8 * max(l_away, 1e-6) and l_toward > 3 * mean, "ORIENTATION light %d: Cycles sees the light where Forge put it (%.3f vs %.3f away)" % (n, l_toward, l_away))
    check(l_wrong < 0.5 * l_toward, "CONTROL light %d: rotated 180 degrees it is NOT there (%.3f)" % (n, l_wrong))

# 6. no echo ----------------------------------------------------------------------------------
check(hb._gather_world(bpy.context) is None, "Push to Forge ignores the bridge World (no echo)")

# 4. stop -------------------------------------------------------------------------------------
bpy.ops.hdribridge.live_toggle()
check(not hb._live["running"], "live link stops")
check(scene.world is mine, "the artist's World is back after Stop")
check(not hb._bridge_worlds(), "no bridge World left behind")
check(not [i for i in bpy.data.images if i.get(hb.BRIDGE_TAG)], "no bridge image left behind")
check(hb.PREV_WORLD_KEY not in scene, "no bookkeeping left on the scene")

# 5. import -----------------------------------------------------------------------------------
res = bpy.ops.hdribridge.import_hdri()
check('FINISHED' in res, "Import HDRI succeeds")
iw = next(iter(hb._bridge_worlds(hb.IMPORT_KIND)), None)
check(iw is not None and scene.world is iw, "the imported World is active")
img = iw.node_tree.nodes["Forge Env"].image if iw else None
path = bpy.path.abspath(img.filepath) if img else ""
check(path.endswith(".hdr") and os.path.exists(path), "the .hdr was saved to disk (%s)" % os.path.basename(path))
check(os.path.exists(path[:-4] + ".ash"), "the matching .ash was saved next to it")
bpy.ops.hdribridge.restore_world()
check(scene.world is mine and not hb._bridge_worlds(), "Restore my World puts the artist's World back")

print("\n%d check(s) failed" % len(FAILS) if FAILS else "\nALL CHECKS PASSED")
sys.exit(1 if FAILS else 0)
