"""
Headless Maya (mayapy) test for the renderer-aware controls of the HDRI Forge Bridge, with REAL Arnold renders.

    "C:\\Program Files\\Autodesk\\Maya2023\\bin\\mayapy.exe" bridge-core\\tests\\maya_renderer_test.py

No Forge needed: it writes its own uniform HDR sky and drives the plug-in's functions directly.

  1. baseline            the sky is visible behind the objects; a diffuse sphere and a mirror sphere are lit by it
  2. Visible to camera   off -> background black, the lit spheres unchanged
  3. Lights the scene    off -> the diffuse sphere goes dark, background and mirror unchanged
  4. In reflections      off -> the mirror sphere goes dark, background and diffuse sphere unchanged
  5. Sky exposure        -1 EV halves the sky and the lit surface
  6. A new dome starts with the chosen settings
  7. Sampling presets    Draft / Final write Arnold's real option values
  8. Name shown in Forge includes the renderer and follows a renderer switch
  9. Standard color      picks the Un-tone-mapped view transform
 10. Shadow catcher      aiShadowMatte plane, transparent where unshadowed, opaque in a shadow, removed cleanly
"""
import os
import struct
import sys
import tempfile
import traceback
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "maya-plugin"))
sys.path.insert(0, PLUGIN_DIR)

import maya.standalone  # noqa: E402
maya.standalone.initialize(name="python")
import maya.cmds as cmds  # noqa: E402

FAILS = []
TMP = tempfile.mkdtemp(prefix="forge_maya_renderer_test_")
W, H = 48, 32


def check(cond, msg):
    print(("PASS  " if cond else "FAIL  ") + msg, flush=True)
    if not cond:
        FAILS.append(msg)


def close(a, b, rel=0.12, floor=3.0):
    return abs(a - b) <= max(floor, rel * abs(b))


def write_uniform_hdr(path, w=64, h=32):
    """A flat Radiance .hdr whose every pixel is radiance 1.0 (RGBE 128,128,128,129)."""
    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + ("-Y %d +X %d\n" % (h, w)).encode())
        f.write(bytes([128, 128, 128, 129]) * (w * h))


def read_exr(path):
    """Minimal reader for the uncompressed scanline OpenEXR files Arnold writes here.
    Returns (width, height, {channel name: list of rows of floats}) in scene-linear values."""
    data = open(path, "rb").read()
    assert struct.unpack("<I", data[:4])[0] == 20000630, "not an OpenEXR file: %s" % path
    flags = struct.unpack("<I", data[4:8])[0] >> 8
    assert not (flags & 0x2), "tiled EXR: turn exrTiled off"
    pos, channels, window, compression = 8, [], None, None
    while data[pos] != 0:
        end = data.index(b"\x00", pos)
        name = data[pos:end].decode()
        pos = end + 1
        end = data.index(b"\x00", pos)
        typ = data[pos:end].decode()
        pos = end + 1
        size = struct.unpack("<i", data[pos:pos + 4])[0]
        pos += 4
        val = data[pos:pos + size]
        pos += size
        if name == "channels":
            q = 0
            while val[q] != 0:
                e = val.index(b"\x00", q)
                cname = val[q:e].decode()
                ptype = struct.unpack("<i", val[e + 1:e + 5])[0]
                channels.append((cname, ptype))
                q = e + 1 + 16
        elif name == "dataWindow":
            window = struct.unpack("<iiii", val)
        elif name == "compression":
            compression = val[0]
    pos += 1
    assert compression == 0, "EXR is compressed (%s): set exrCompression to none" % compression
    w, h = window[2] - window[0] + 1, window[3] - window[1] + 1
    pos += 8 * h                                   # the scanline offset table
    out = {c: [None] * h for c, _ in channels}
    for _ in range(h):
        y = struct.unpack("<i", data[pos:pos + 4])[0] - window[1]
        pos += 8                                   # y + payload size
        for cname, ptype in channels:
            if ptype == 1:                         # half
                row = list(struct.unpack("<%de" % w, data[pos:pos + 2 * w]))
                pos += 2 * w
            elif ptype == 2:                       # float
                row = list(struct.unpack("<%df" % w, data[pos:pos + 4 * w]))
                pos += 4 * w
            else:
                row = list(struct.unpack("<%dI" % w, data[pos:pos + 4 * w]))
                pos += 4 * w
            out[cname][y] = row
    return w, h, out


def render(cam, tag):
    """Arnold batch render (the real renderer, not Maya Software) at 48x32 to a linear EXR; returns the decoded image."""
    cmds.setAttr("defaultResolution.width", W)
    cmds.setAttr("defaultResolution.height", H)
    cmds.setAttr("defaultResolution.deviceAspectRatio", W / float(H))
    cmds.setAttr("defaultRenderGlobals.enableDefaultLight", 0)                 # Maya adds a headlight when no light is visible
    cmds.setAttr("defaultRenderGlobals.animation", 0)
    cmds.setAttr("defaultArnoldDriver.aiTranslator", "exr", type="string")
    cmds.setAttr("defaultArnoldDriver.exrCompression", 0)                      # none: the test reader is deliberately tiny
    cmds.setAttr("defaultArnoldDriver.exrTiled", 0)
    cmds.setAttr("defaultArnoldDriver.halfPrecision", 0)
    cmds.setAttr("defaultRenderGlobals.imageFilePrefix", os.path.join(TMP, "r_" + tag).replace("\\", "/"), type="string")
    cmds.setAttr("defaultArnoldRenderOptions.AASamples", 3)
    cmds.setAttr("defaultArnoldRenderOptions.GIDiffuseSamples", 2)
    cmds.setAttr("defaultArnoldRenderOptions.GISpecularSamples", 2)
    cmds.arnoldRender(cam=cam, width=W, height=H, batch=True)
    found = [f for f in os.listdir(TMP) if f.startswith("r_" + tag) and f.endswith(".exr")]
    if not found:
        raise RuntimeError("Arnold wrote no EXR for %s (%s)" % (tag, sorted(os.listdir(TMP))))
    return read_exr(os.path.join(TMP, found[0]))


def px(img, x, y):
    """Mean of R, G, B at a pixel, scene-linear, scaled so that radiance 1.0 reads 255."""
    w, h, ch = img
    return 255.0 * (ch["R"][y][x] + ch["G"][y][x] + ch["B"][y][x]) / 3.0


def alpha(img, x, y):
    w, h, ch = img
    return ch["A"][y][x] if "A" in ch else None


def sample(img):
    """(background corner, diffuse sphere centre, mirror sphere centre), 0-255. The camera looks down -X from +X;
    the Diffuse sphere is on the image LEFT and the Mirror sphere on the RIGHT, about 7 px either side of the centre."""
    return px(img, 2, 2), px(img, W // 2 - 7, H // 2), px(img, W // 2 + 7, H // 2)


def make_sphere(name, x, base, metal, rough):
    s = cmds.polySphere(name=name, radius=0.9, subdivisionsX=24, subdivisionsY=16, constructionHistory=False)[0]
    cmds.xform(s, translation=(x, 0, 0))
    shader = cmds.shadingNode("aiStandardSurface", asShader=True, name=name + "_mat")
    cmds.setAttr(shader + ".baseColor", base, base, base, type="double3")
    cmds.setAttr(shader + ".base", 1.0)
    cmds.setAttr(shader + ".metalness", metal)
    cmds.setAttr(shader + ".specular", 0.0 if metal == 0 else 1.0)
    cmds.setAttr(shader + ".specularRoughness", rough)
    sg = cmds.sets(renderable=True, noSurfaceShader=True, empty=True, name=name + "_SG")
    cmds.connectAttr(shader + ".outColor", sg + ".surfaceShader", force=True)
    cmds.sets(s, edit=True, forceElement=sg)
    return s


def main():
    print("Maya", cmds.about(version=True), flush=True)
    cmds.loadPlugin("mtoa", quiet=True)
    cmds.file(new=True, force=True)
    cmds.setAttr("defaultRenderGlobals.currentRenderer", "arnold", type="string")
    import mtoa.core as mtoa_core
    mtoa_core.createOptions()

    import hdri_forge_bridge_maya as hm
    hm._sky.update({"show_background": True, "light_scene": True, "reflections": True, "exposure": 0.0})

    hdr = os.path.join(TMP, "uniform_sky.hdr").replace("\\", "/")
    write_uniform_hdr(hdr)
    hm._set_dome_image(hm.LIVE_KIND, hdr)

    # camera 8 units along +X looking down -X; Diffuse sphere on image-left, Mirror on image-right
    cam, cam_shape = cmds.camera(name="testCam", focalLength=35)   # Maya may rename it (testCam1)
    cmds.xform(cam, translation=(8, 0, 0), rotation=(0, 90, 0))
    d = make_sphere("Diffuse", 0, 0.8, 0.0, 1.0)
    m = make_sphere("Mirror", 0, 1.0, 1.0, 0.0)
    cmds.xform(d, translation=(0, 0, 1.2))                      # +Z of a camera looking down -X with rotateY=90 is image-left
    cmds.xform(m, translation=(0, 0, -1.2))
    base = render(cam, "base")
    bg0, dif0, mir0 = sample(base)
    print("baseline (0-255): background %.0f | diffuse sphere %.0f | mirror sphere %.0f | channels %s" % (bg0, dif0, mir0, "".join(sorted(base[2]))), flush=True)
    check(bg0 > 200, "baseline: the sky is visible behind the objects (%.0f)" % bg0)
    check(dif0 > 100, "baseline: the diffuse sphere is lit by the sky (%.0f)" % dif0)
    check(mir0 > 100, "baseline: the mirror sphere reflects the sky (%.0f)" % mir0)

    # 1b. the dome must light the objects, not only show as a background. A light made with createNode is not in
    # Maya's default light set; before the fix the spheres stayed black while the sky showed behind them.
    xf0, shp0 = hm._bridge_domes(hm.LIVE_KIND)[0]
    check(xf0 in (cmds.sets("defaultLightSet", query=True) or []), "the bridge dome is linked into Maya's default light set")
    cmds.sets(xf0, remove="defaultLightSet")                     # what an older plug-in version left behind
    bg_u, dif_u, mir_u = sample(render(cam, "unlinked"))
    check(dif_u < 0.05 * dif0 and bg_u > 200, "control: an UNLINKED dome shows as background but lights nothing (sphere %.0f, sky %.0f)" % (dif_u, bg_u))
    hm.set_sky()                                                 # applying the sky settings repairs the link
    bg_r, dif_r, mir_r = sample(render(cam, "relinked"))
    check(close(dif_r, dif0) and close(mir_r, mir0), "applying the sky settings re-links a dome made by an older version (sphere %.0f)" % dif_r)

    # 2. Visible to camera
    hm.set_sky(show_background=False)
    bg, dif, mir = sample(render(cam, "nobg"))
    check(bg < 8, "Visible to camera OFF: the background is black (%.0f)" % bg)
    check(close(dif, dif0) and close(mir, mir0), "Visible to camera OFF: lighting and reflections are unchanged (%.0f / %.0f)" % (dif, mir))
    hm.set_sky(show_background=True)

    # 3. Lights the scene
    hm.set_sky(light_scene=False)
    bg, dif, mir = sample(render(cam, "nolight"))
    check(dif < 0.1 * dif0, "Lights the scene OFF: the diffuse sphere goes dark (%.0f from %.0f)" % (dif, dif0))
    check(close(bg, bg0) and close(mir, mir0, 0.15), "Lights the scene OFF: background and mirror are unchanged (%.0f / %.0f)" % (bg, mir))
    hm.set_sky(light_scene=True)

    # 4. In reflections
    hm.set_sky(reflections=False)
    bg, dif, mir = sample(render(cam, "norefl"))
    check(mir < 0.1 * mir0, "In reflections OFF: the mirror sphere goes dark (%.0f from %.0f)" % (mir, mir0))
    check(close(bg, bg0) and close(dif, dif0), "In reflections OFF: background and diffuse sphere are unchanged (%.0f / %.0f)" % (bg, dif))
    hm.set_sky(reflections=True)

    # 5. exposure: -1 EV halves the light (EXR values are scene-linear, so this is exact)
    hm.set_sky(exposure=-1.0)
    bg, dif, mir = sample(render(cam, "evm1"))
    ratio = (bg / bg0, dif / dif0)
    print("-1 EV: sky x%.3f, lit surface x%.3f" % ratio, flush=True)
    check(abs(ratio[0] - 0.5) < 0.03 and abs(ratio[1] - 0.5) < 0.03, "Sky exposure -1 EV halves the sky and the lit surface (x%.3f / x%.3f)" % ratio)
    hm.set_sky(exposure=0.0)

    # 6. a dome created AFTER the settings were chosen starts with them
    hm.set_sky(show_background=False, light_scene=False, reflections=False, exposure=-2.0)
    hm._remove_bridge_domes(hm.LIVE_KIND)
    hm._set_dome_image(hm.LIVE_KIND, hdr)
    xf, shp = hm._bridge_domes(hm.LIVE_KIND)[0]
    vals = (cmds.getAttr(shp + ".camera"), cmds.getAttr(shp + ".aiDiffuse"), cmds.getAttr(shp + ".aiSpecular"),
            cmds.getAttr(shp + ".transmission"), cmds.getAttr(shp + ".exposure"))
    check(vals == (0.0, 0.0, 0.0, 0.0, -2.0), "a new dome starts with the chosen sky settings already applied %s" % (vals,))
    hm.set_sky(show_background=True, light_scene=True, reflections=True, exposure=0.0)
    vals = (cmds.getAttr(shp + ".camera"), cmds.getAttr(shp + ".aiDiffuse"), cmds.getAttr(shp + ".aiSpecular"), cmds.getAttr(shp + ".exposure"))
    check(vals == (1.0, 1.0, 1.0, 0.0), "turning everything back on restores the dome %s" % (vals,))

    # 7. sampling presets
    o = "defaultArnoldRenderOptions"
    hm.apply_quality("DRAFT")
    check((cmds.getAttr(o + ".AASamples"), cmds.getAttr(o + ".GIDiffuseSamples"), cmds.getAttr(o + ".GISpecularSamples")) == (2, 1, 1),
          "Arnold Draft: AA 2 / diffuse 1 / specular 1")
    hm.apply_quality("FINAL")
    check((cmds.getAttr(o + ".AASamples"), cmds.getAttr(o + ".GIDiffuseSamples"), cmds.getAttr(o + ".GISpecularSamples")) == (8, 3, 3),
          "Arnold Final: AA 8 / diffuse 3 / specular 3")
    cmds.setAttr(o + ".AASamples", 5)
    check(hm.apply_quality("KEEP") is False and cmds.getAttr(o + ".AASamples") == 5, "Keep my settings leaves the samples alone")

    # 8. the name shown in Forge
    name = hm._client_name()
    check(name.endswith("(Arnold)") and name.startswith("Maya "), "name shown in Forge with Arnold: %r" % name)
    cmds.setAttr("defaultRenderGlobals.currentRenderer", "mayaSoftware", type="string")
    check(hm._client_name().endswith("(Maya Software)"), "the name follows a renderer switch: %r" % hm._client_name())
    cmds.setAttr("defaultRenderGlobals.currentRenderer", "arnold", type="string")

    # 9. standard color
    chosen = hm.standard_color()
    now = cmds.colorManagementPrefs(query=True, viewTransformName=True)
    check(chosen is not None and "un-tone-mapped" in now.lower(), "Standard color: view transform is %r" % now)

    # 10. shadow catcher
    key = cmds.directionalLight(intensity=2.0)
    cmds.xform(cmds.listRelatives(key, parent=True)[0], rotation=(-50, 20, 0))
    cmds.setAttr(key + ".aiAngle", 0.0)
    added = hm.toggle_shadow_catcher()
    cats = hm._shadow_catchers()
    check(added is True and len(cats) == 1, "Shadow catcher: a catcher plane exists")
    shape = cmds.listRelatives(cats[0], shapes=True)[0]
    sgs = cmds.listConnections(shape, type="shadingEngine") or []
    shaders = cmds.listConnections(sgs[0] + ".surfaceShader", source=True, destination=False) or []
    check(bool(shaders) and cmds.nodeType(shaders[0]) == "aiShadowMatte", "Shadow catcher: the plane uses an aiShadowMatte shader")
    check(cmds.getAttr(shape + ".castsShadows") == 0, "Shadow catcher: the plane itself casts no shadow")

    # top-down view: spheres resting on the catcher, a key light throwing a shadow
    cmds.xform(cam, translation=(0, 9, 0), rotation=(-90, 0, 0))
    cmds.xform(d, translation=(0.0, 0.92, 0.9))
    cmds.xform(m, translation=(0.0, 0.92, -0.9))
    cmds.xform(cats[0], translation=(0, 0, 0))
    a = render(cam, "catcher")
    w, h, chans = a
    if "A" in chans:
        far = alpha(a, 1, 1)
        ground = [alpha(a, x, y) for x in range(w) for y in range(h)]
        partial = sum(1 for v in ground if 0.1 < v < 0.95)
        print("catcher alpha: far corner %.3f | strongest %.3f | pixels with alpha 0.1-0.95: %d" % (far, max(ground), partial), flush=True)
        check(far < 0.05, "Shadow catcher: an unshadowed ground pixel is transparent (alpha %.3f)" % far)
        check(partial >= 10, "Shadow catcher: the shadow shows on the ground as partial alpha (%d pixels between 0.1 and 0.95)" % partial)
    else:
        check(False, "Shadow catcher: the render has no alpha channel (%s)" % sorted(chans))
    hm.toggle_shadow_catcher()
    check(len(hm._shadow_catchers()) == 0 and not cmds.objExists("HDRIForge_ShadowMatte") and not cmds.objExists("HDRIForge_ShadowMatteSG"),
          "Shadow catcher: removing it deletes the plane, shader and shading group")

    print("\n%d failed" % len(FAILS) if FAILS else "\nALL PASS", flush=True)


try:
    main()
except Exception:
    traceback.print_exc()
    FAILS.append("exception")
sys.stdout.flush()
os._exit(1 if FAILS else 0)
