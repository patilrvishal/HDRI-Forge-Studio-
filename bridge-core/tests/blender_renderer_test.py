"""
Headless Blender test for the renderer-aware controls of the HDRI Forge Bridge (Cycles and Eevee).

  blender -b --factory-startup --python bridge-core/tests/blender_renderer_test.py

No Forge needed: it writes its own uniform HDR sky and drives the add-on code directly. Every control is checked with
REAL Cycles renders (EXR, scene-linear), so a switch that does nothing, or the wrong thing, fails here:

  1. baseline            sky visible behind the objects, a diffuse sphere and a mirror sphere are lit by it
  2. Visible to camera   off -> the background goes black, the lit spheres do not change
  3. Lights the scene    off -> the diffuse sphere goes dark, the background and the mirror do not change
  4. In reflections      off -> the mirror sphere goes dark, the diffuse sphere and the background do not change
  5. Sky exposure        +1 EV -> sky and lit surfaces double
  6. Sampling presets    Cycles preview / final samples, Eevee samples
  7. Standard color      resets view transform, exposure and gamma
  8. Shadow catcher      adds a catcher with transparent film, renders shadow-only alpha, and removes cleanly
  9. Name shown in Forge includes the renderer
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "blender-addon")))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
import hdri_forge_bridge as hb  # noqa: E402

FAILS = []
TMP = tempfile.mkdtemp(prefix="forge_renderer_test_")
W, H = 48, 32


def check(cond, msg):
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        FAILS.append(msg)


def close(a, b, rel=0.06, floor=0.01):
    return abs(a - b) <= max(floor, rel * abs(b))


def make_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hb.register()
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = False
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'

    # camera looking straight down -X at two spheres side by side
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    cam.location = (8, 0, 0)
    cam.rotation_euler = (1.5707963, 0, 1.5707963)
    cam.data.lens = 35
    scene.camera = cam

    def sphere(name, y, metallic, roughness):
        mesh = bpy.data.meshes.new(name)
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.9)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        obj.location = (0, y, 0)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        b = mat.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = roughness
        b.inputs["Specular IOR Level"].default_value = 0.0 if metallic == 0 else 0.5
        obj.data.materials.append(mat)
        return obj

    sphere("Diffuse", -1.2, 0.0, 1.0)
    sphere("Mirror", 1.2, 1.0, 0.0)

    # a uniform sky of radiance 1.0, so every number below is easy to predict
    img = bpy.data.images.new("uniform_sky", 64, 32, float_buffer=True)
    px = np.ones(64 * 32 * 4, dtype=np.float32)
    img.pixels.foreach_set(px)
    path = os.path.join(TMP, "uniform_sky.hdr")
    img.filepath_raw = path
    img.file_format = 'HDR'
    img.save()
    world = hb._bridge_world(scene, hb.LIVE_KIND)
    hb._set_world_image(world, path, "uniform_sky_live")
    return scene, path


def render(scene, tag):
    out = os.path.join(TMP, "r_%s.exr" % tag)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out, check_existing=False)
    a = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(H, W, 4)


def sample(a):
    """(background corner, diffuse sphere centre, mirror sphere centre) as luminance."""
    lum = lambda p: float((p[0] + p[1] + p[2]) / 3)
    bg = lum(a[2, 2])
    # The camera looks down -X from +X with Z up, so its right-hand side is world +Y:
    # the Diffuse sphere (y = -1.2) is on the LEFT of the image, the Mirror sphere (y = +1.2) on the RIGHT.
    diffuse = lum(a[H // 2, int(W * 0.5 - W * 0.20)])
    mirror = lum(a[H // 2, int(W * 0.5 + W * 0.20)])
    return bg, diffuse, mirror


def main():
    print("Blender", bpy.app.version_string)
    scene, hdr_path = make_scene()
    s = scene.hdri_forge_sky

    base = render(scene, "base")
    bg0, dif0, mir0 = sample(base)
    print("baseline: background %.3f | diffuse sphere %.3f | mirror sphere %.3f" % (bg0, dif0, mir0))
    check(bg0 > 0.8 and close(bg0, 1.0, 0.1), "baseline: the sky is visible behind the objects (%.3f, expected ~1.0)" % bg0)
    check(dif0 > 0.4, "baseline: the diffuse sphere is lit by the sky (%.3f)" % dif0)
    check(mir0 > 0.5, "baseline: the mirror sphere reflects the sky (%.3f)" % mir0)

    # 2. Visible to camera
    s.show_background = False
    a = render(scene, "nobg")
    bg, dif, mir = sample(a)
    check(bg < 0.02, "Visible to camera OFF: the background is black (%.3f)" % bg)
    check(close(dif, dif0, 0.12) and close(mir, mir0, 0.12), "Visible to camera OFF: lighting and reflections are unchanged (%.3f / %.3f)" % (dif, mir))
    s.show_background = True

    # 3. Lights the scene
    s.light_scene = False
    a = render(scene, "nolight")
    bg, dif, mir = sample(a)
    check(dif < 0.1 * dif0, "Lights the scene OFF: the diffuse sphere goes dark (%.3f from %.3f)" % (dif, dif0))
    check(close(bg, bg0, 0.1) and close(mir, mir0, 0.15), "Lights the scene OFF: background and mirror are unchanged (%.3f / %.3f)" % (bg, mir))
    s.light_scene = True

    # 4. In reflections
    s.reflections = False
    a = render(scene, "norefl")
    bg, dif, mir = sample(a)
    check(mir < 0.1 * mir0, "In reflections OFF: the mirror sphere goes dark (%.3f from %.3f)" % (mir, mir0))
    check(close(bg, bg0, 0.1) and close(dif, dif0, 0.12), "In reflections OFF: background and diffuse sphere are unchanged (%.3f / %.3f)" % (bg, dif))
    s.reflections = True

    # 5. exposure
    s.exposure = 1.0
    a = render(scene, "ev1")
    bg, dif, mir = sample(a)
    check(close(bg, 2 * bg0, 0.08) and close(dif, 2 * dif0, 0.1), "Sky exposure +1 EV doubles the sky and the lit surface (%.3f / %.3f)" % (bg / bg0, dif / dif0))
    s.exposure = 0.0
    bgw = hb._bridge_worlds(hb.LIVE_KIND)[0].node_tree.nodes["Forge Background"].inputs["Strength"].default_value
    check(close(bgw, 1.0), "exposure back to 0 EV restores Strength 1.0 (%.3f)" % bgw)

    # a World made AFTER the settings were chosen starts with them applied
    s.show_background = False
    s.exposure = -1.0
    hb._restore_world(scene)
    w2 = hb._bridge_world(scene, hb.LIVE_KIND)
    check(w2.cycles_visibility.camera is False and close(w2.node_tree.nodes["Forge Background"].inputs["Strength"].default_value, 0.5),
          "a new live World starts with the chosen sky settings already applied")
    s.show_background = True
    s.exposure = 0.0
    hb._set_world_image(w2, hdr_path, "uniform_sky_live2")

    # 6. sampling presets
    s.quality = 'DRAFT'
    c = scene.cycles
    check(c.preview_samples == 32 and c.samples == 64 and c.use_preview_denoising and c.use_denoising,
          "Cycles Draft: preview %d / final %d samples, denoising on" % (c.preview_samples, c.samples))
    s.quality = 'FINAL'
    check(c.preview_samples == 512 and c.samples == 2048 and close(c.adaptive_threshold, 0.005, 0.01),
          "Cycles Final: preview %d / final %d samples, noise threshold %.3f" % (c.preview_samples, c.samples, c.adaptive_threshold))
    s.quality = 'KEEP'
    c.samples = 77
    s.quality = 'KEEP'
    check(c.samples == 77, "Keep my settings leaves the samples alone")
    scene.render.engine = 'BLENDER_EEVEE'
    s.quality = 'BALANCED'
    check(scene.eevee.taa_samples == 64 and scene.eevee.taa_render_samples == 128,
          "Eevee Balanced: viewport %d / render %d samples" % (scene.eevee.taa_samples, scene.eevee.taa_render_samples))
    check(hb._client_name(scene).endswith("(Eevee)"), "name shown in Forge with Eevee: %r" % hb._client_name(scene))
    scene.render.engine = 'CYCLES'
    s.quality = 'KEEP'
    check(hb._client_name(scene).endswith("(Cycles)") and hb._client_name(scene).startswith("Blender "),
          "name shown in Forge with Cycles: %r" % hb._client_name(scene))

    # 7. standard color
    vs = scene.view_settings
    vs.exposure, vs.gamma = 2.0, 1.4
    try:
        vs.view_transform = 'AgX'
    except TypeError:
        pass
    r = bpy.ops.hdribridge.standard_color()
    check('FINISHED' in r and vs.view_transform == 'Standard' and vs.exposure == 0.0 and vs.gamma == 1.0,
          "Standard color: view transform %s, exposure %.1f, gamma %.1f" % (vs.view_transform, vs.exposure, vs.gamma))

    # 8. shadow catcher over a transparent background
    film_before = scene.render.film_transparent
    r = bpy.ops.hdribridge.shadow_catcher()
    cats = hb._shadow_catchers()
    check('FINISHED' in r and len(cats) == 1 and cats[0].is_shadow_catcher, "Shadow catcher: a catcher plane exists and is flagged")
    check(scene.render.film_transparent is True, "Shadow catcher: the film is transparent")
    check(cats[0].visible_shadow is False, "Shadow catcher: the plane itself casts no shadow")

    # top-down view: spheres resting almost on the catcher, sky overhead (close objects cast the strongest contact shadow)
    cam = scene.camera
    cam.location = (0, 0, 9)
    cam.rotation_euler = (0, 0, 0)
    for o in bpy.data.objects:
        if o.name in ("Diffuse", "Mirror"):
            o.location.z = 0.95
    # a key light, as in any product shot: it throws a crisp shadow, which is exactly what the catcher exists to keep
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN'))
    sun.data.energy = 4.0
    sun.data.angle = 0.02
    sun.rotation_euler = (0.6, 0.0, 0.4)
    scene.collection.objects.link(sun)
    a = render(scene, "catcher")
    alpha = a[:, :, 3]
    # The spheres themselves are opaque (alpha 1). Look only at pixels away from them: that is the ground, where
    # alpha is the shadow strength.
    solid = alpha > 0.95
    near_solid = solid.copy()
    for _ in range(3):                                           # grow the mask so sphere edges are excluded too
        grown = near_solid.copy()
        grown[1:, :] |= near_solid[:-1, :]
        grown[:-1, :] |= near_solid[1:, :]
        grown[:, 1:] |= near_solid[:, :-1]
        grown[:, :-1] |= near_solid[:, 1:]
        near_solid = grown
    ground = alpha[~near_solid]
    far = float(alpha[1, 1])
    print("catcher alpha on the ground: far corner %.3f | strongest shadow %.3f | %d ground pixels, %d with shadow > 0.1"
          % (far, float(ground.max()), ground.size, int((ground > 0.1).sum())))
    check(far < 0.05, "Shadow catcher: an unshadowed ground pixel is transparent (alpha %.3f)" % far)
    check(float(ground.max()) > 0.4, "Shadow catcher: the shadow of the spheres shows on the ground as alpha (strongest %.3f)" % float(ground.max()))

    r = bpy.ops.hdribridge.shadow_catcher()                     # toggles off
    check(len(hb._shadow_catchers()) == 0 and scene.render.film_transparent == film_before,
          "Shadow catcher: removing it deletes the plane and restores the film setting")

    # 9. nothing leaks: the artist's own settings objects stay as they were
    hb.unregister()
    check(not hasattr(bpy.types.Scene, "hdri_forge_sky"), "unregister removes the scene settings")

    print("\n%d failed" % len(FAILS) if FAILS else "\nALL PASS")
    sys.exit(1 if FAILS else 0)


try:
    main()
except SystemExit:
    raise
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(2)
