"""
Runs INSIDE a rendering Unreal Editor (see run_unreal_render_test.py): the bridge shows a map with coloured markers at
known Forge directions, scene-capture cameras look in four directions, and the pictures say where each marker really
landed. That checks the map orientation (which no headless run can) and that a new map from Forge shows up in the
rendered level straight away.

Forge directions (three.js axes: X right, Y up, Z toward the viewer) and where they must appear in Unreal
(x_u = -z, y_u = x, z_u = y):  white +X -> Unreal +Y, red -Z -> Unreal +X, green +Z -> Unreal -X, all 30 degrees up.
"""
import json
import math
import os
import struct
import sys
import threading
import time
import traceback
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import unreal

OUT = os.environ.get("FORGE_TEST_OUT", "forge_render_test.txt")
PNG_DIR = os.environ.get("FORGE_TEST_PNG", os.path.dirname(OUT))
PORT = 5179
results = []


def check(ok, msg):
    results.append(("PASS  " if ok else "FAIL  ") + msg)


def finish():
    summary = "ALL PASS" if results and all(r.startswith("PASS") for r in results) else "FAILED"
    text = "\n".join(results + [summary])
    for line in text.splitlines():
        unreal.log("[FORGE RENDER] " + line)
    try:
        with open(OUT, "w") as f:
            f.write(text)
    except Exception as e:
        unreal.log_warning("[FORGE RENDER] could not write %s: %s" % (OUT, e))
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


# ── maps with markers at Forge directions ─────────────────────────────────
def rgbe(r, g, b):
    m = max(r, g, b)
    if m < 1e-32:
        return bytes((0, 0, 0, 0))
    f, e = math.frexp(m)
    s = f * 256.0 / m
    return bytes((int(r * s), int(g * s), int(b * s), e + 128))


def direction(u, v):
    """Forge's pixelToDirection: u,v in 0..1 -> unit vector in three.js axes."""
    th = (u - 0.5) * 2 * math.pi
    ph = v * math.pi
    return (math.sin(ph) * math.cos(th), math.cos(ph), math.sin(ph) * math.sin(th))


def make_hdr(w, h, markers):
    """markers: list of (direction vector, (r,g,b)). Background is a faint grey."""
    elev = math.radians(30)
    rows = []
    cos_lim = math.cos(math.radians(12))
    for y in range(h):
        row = bytearray()
        for x in range(w):
            d = direction((x + 0.5) / w, (y + 0.5) / h)
            col = (0.02, 0.02, 0.02)
            for md, mc in markers:
                if d[0] * md[0] + d[1] * md[1] + d[2] * md[2] > cos_lim:
                    col = mc
            row += rgbe(*col)
        rows.append(bytes(row))
    return b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (h, w) + b"".join(rows)


def up30(theta_deg):
    el = math.radians(30)
    th = math.radians(theta_deg)
    return (math.cos(el) * math.cos(th), math.sin(el), math.cos(el) * math.sin(th))


# bright enough to read clearly, dim enough that the tone mapper does not wash the colour out to white
WHITE, RED, GREEN = (3.0, 3.0, 3.0), (3.0, 0.0, 0.0), (0.0, 3.0, 0.0)
MAP1 = [(up30(0), WHITE), (up30(-90), RED), (up30(90), GREEN)]       # white +X, red -Z, green +Z
MAP2 = [(up30(180), WHITE), (up30(90), RED), (up30(-90), GREEN)]     # white moved to -X, red and green swapped
EXPECT1 = {"+X": "red", "+Y": "white", "-X": "green", "-Y": "none"}
EXPECT2 = {"+X": "green", "+Y": "none", "-X": "red", "-Y": "white"}
YAW = {"+X": 0.0, "+Y": 90.0, "-X": 180.0, "-Y": -90.0}


class MockForge(object):
    def __init__(self):
        self.state = {"version": 0, "hdr": None, "w": 0, "h": 0}
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body, ctype="application/octet-stream"):
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                s = outer.state
                p = self.path.split("?")[0]
                if p == "/__erik_live/status":
                    body = {"ok": True, "app": "HDRI Forge Studio", "mode": "dev", "protocol": 1, "capabilities": [],
                            "version": s["version"], "forge": 1, "hasMap": s["hdr"] is not None, "w": s["w"], "h": s["h"],
                            "final": True, "pass": "%dx%d" % (s["w"], s["h"]), "ms": 5}
                    self._send(200, json.dumps(body).encode(), "application/json")
                elif p == "/__erik_live/hdr" and s["hdr"]:
                    self._send(200, s["hdr"])
                elif p == "/__erik_live/ash":
                    self._send(200, b"SH 1 2 3", "text/plain")
                else:
                    self._send(404, b"nf")

        class Srv(ThreadingHTTPServer):
            allow_reuse_address = True
            daemon_threads = True

        self.server = Srv(("127.0.0.1", PORT), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def push(self, w, h, markers):
        self.state.update(hdr=make_hdr(w, h, markers), w=w, h=h)
        self.state["version"] += 1

    def close(self):
        self.server.shutdown()
        self.server.server_close()


# ── reading the capture back ──────────────────────────────────────────────
def read_png(path):
    data = open(path, "rb").read()
    pos, idat, w, h, ctype, bpp = 8, b"", 0, 0, 6, 4
    while pos < len(data):
        n, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            bpp = {2: 3, 6: 4}.get(ctype, 4)
        elif tag == b"IDAT":
            idat += body
        pos += 12 + n
    raw = zlib.decompress(idat)
    stride = w * bpp
    out, prev = [], bytearray(stride)
    i = 0
    for _ in range(h):
        ft = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ft == 1:
                line[x] = (line[x] + a) & 255
            elif ft == 2:
                line[x] = (line[x] + b) & 255
            elif ft == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out.append(line)
        prev = line
    return w, h, bpp, out


def classify(path):
    w, h, bpp, rows = read_png(path)
    r = g = b = 0.0
    n = 0
    for y in range(h // 2 - 24, h // 2 + 24):
        for x in range(w // 2 - 24, w // 2 + 24):
            px = rows[y][x * bpp:x * bpp + bpp]
            # BGRA or RGBA? Unreal's PNG export is RGBA; dominance tests below do not depend on it except red/blue
            r += px[0]; g += px[1]; b += px[2]; n += 1
    r, g, b = r / n / 255, g / n / 255, b / n / 255
    m = max(r, g, b)
    if m < 0.30:
        return "none", (r, g, b)
    if min(r, g, b) > 0.75 * m:
        return "white", (r, g, b)
    if r > 1.3 * max(g, b):
        return "red", (r, g, b)
    if g > 1.3 * max(r, b):
        return "green", (r, g, b)
    return "other", (r, g, b)


# ── state machine on the editor tick ──────────────────────────────────────
state = {"step": 0, "ticks": 0, "handle": None, "mock": None, "bridge": None, "deadline": time.time() + 1500}
ctx = {}


def finish_all():
    try:
        unreal.unregister_slate_post_tick_callback(state["handle"])
    except Exception:
        pass
    try:
        state["bridge"].shutdown()
    except Exception:
        pass
    if state["mock"]:
        state["mock"].close()
    finish()


def actor_by_tag(tag):
    for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        if any(str(t) == tag for t in a.tags):
            return a
    return None


def make_capture(world):
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    cap = eas.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(0, 0, 0))
    comp = cap.get_editor_property("capture_component2d")
    rt = unreal.RenderingLibrary.create_render_target2d(world, 256, 256, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    comp.set_editor_property("texture_target", rt)
    comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    comp.set_editor_property("fov_angle", 90.0)
    comp.set_editor_property("capture_every_frame", False)
    comp.set_editor_property("capture_on_movement", False)
    ctx.update(cap=cap, comp=comp, rt=rt, world=world)


def shoot(name):
    """One picture: point the camera, capture, write a PNG, say what is in the middle of it."""
    cap = ctx["cap"]
    cap.set_actor_rotation(unreal.Rotator(0, 30.0, YAW[name]), False)      # roll, pitch (up 30), yaw
    ctx["comp"].capture_scene()
    fname = "view_%s_%d.png" % (name.replace("+", "p").replace("-", "m"), int(time.time() * 1000))
    unreal.RenderingLibrary.export_render_target(ctx["world"], ctx["rt"], PNG_DIR, fname)
    path = os.path.join(PNG_DIR, fname)
    t0 = time.time()
    while not os.path.exists(path) and time.time() - t0 < 5:
        time.sleep(0.05)
    time.sleep(0.2)
    return classify(path)


def views_match(expect):
    got = {}
    for name in expect:
        got[name] = shoot(name)
    ctx["last_views"] = {k: (v[0], tuple(round(c, 2) for c in v[1])) for k, v in got.items()}
    return all(got[n][0] == expect[n] for n in expect)


def step(_dt):
    try:
        _step()
    except Exception:
        tb = traceback.format_exc()
        for line in tb.splitlines():
            unreal.log_warning("[FORGE RENDER] " + line)
        check(False, "exception: " + tb.splitlines()[-1])
        finish_all()


def _step():
    b = state["bridge"]
    n = state["step"]
    state["ticks"] += 1
    if time.time() > state["deadline"]:
        check(False, "overall timeout at step %d, last views %s" % (n, ctx.get("last_views")))
        return finish_all()

    if n == 0:
        world = unreal.EditorLevelLibrary.get_editor_world()
        make_capture(world)
        state["mock"].push(1024, 512, MAP1)
        b.live_start(ports=[PORT])
        check(ctx.get("cap") is not None, "scene capture camera created")
        tb = b._menu.get("toolbar")
        check(tb is not None, "one-click buttons are in the editor toolbar (%s)" % tb)
        state["step"], state["ticks"] = 1, 0
    elif n == 1:
        a = actor_by_tag("HDRIForgeBridge:live")
        if a is not None and state["ticks"] > 120 and state["ticks"] % 40 == 0:
            if views_match(EXPECT1):
                check(True, "map 1 lands where Forge says: %s" % ctx["last_views"])
                state["mock"].push(1024, 512, MAP2)
                state["step"], state["ticks"] = 2, 0
            elif state["ticks"] > 2400:
                check(False, "map 1 views never matched; last %s expected %s" % (ctx["last_views"], EXPECT1))
                finish_all()
    elif n == 2:
        if state["ticks"] > 60 and state["ticks"] % 40 == 0:
            if views_match(EXPECT2):
                check(True, "a new map from Forge is in the rendered level within %d frames: %s" % (state["ticks"], ctx["last_views"]))
                b.live_stop()
                state["step"], state["ticks"] = 3, 0
            elif state["ticks"] > 1600:
                check(False, "map 2 views never matched; last %s expected %s" % (ctx["last_views"], EXPECT2))
                finish_all()
    elif n == 3:
        if state["ticks"] > 20:
            check(actor_by_tag("HDRIForgeBridge") is None, "stopping removes the sky from the level")
            finish_all()


def start():
    sys.path.insert(0, os.environ["FORGE_PLUGIN_PYTHON"])
    import hdri_forge_bridge_unreal as bridge
    state["bridge"] = bridge
    state["mock"] = MockForge()
    bridge._settings.update(auto_start=False, override_lighting=False, auto_exposure=False)   # the pictures test the map itself
    bridge.startup()
    state["handle"] = unreal.register_slate_post_tick_callback(step)


start()
