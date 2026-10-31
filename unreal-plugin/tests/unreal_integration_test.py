"""
Runs INSIDE Unreal Editor (see run_unreal_test.py): drives the real bridge module against a mock HDRI Forge
Studio on a local port, with real texture imports, real actors, real camera maths and the real camera listener.

Results are written to the file named by the FORGE_TEST_OUT environment variable, then the editor quits.
"""
import json
import math
import os
import struct
import sys
import threading
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import unreal

OUT = os.environ.get("FORGE_TEST_OUT", "forge_unreal_test.txt")
PORT = 5179
results = []


def check(ok, msg):
    results.append(("PASS  " if ok else "FAIL  ") + msg)


def finish():
    summary = "ALL PASS" if all(r.startswith("PASS") for r in results) else "FAILED"
    with open(OUT, "w") as f:
        f.write("\n".join(results + [summary]))
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


# ── a recognisable 512x256 equirect .hdr, flat RGBE ───────────────────────
def rgbe(r, g, b):
    m = max(r, g, b)
    if m < 1e-32:
        return bytes((0, 0, 0, 0))
    f, e = math.frexp(m)
    s = f * 256.0 / m
    return bytes((int(r * s), int(g * s), int(b * s), e + 128))


def make_hdr(w, h, sun_x):
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            v = 1.0 - y / h
            sun = 40.0 if abs(x - sun_x) < 10 and abs(y - h // 4) < 10 else 0.0
            row += rgbe(0.2 + 0.5 * v + sun, 0.3 + 0.5 * v + sun, 0.6 * v + 0.2 + sun)
        rows.append(bytes(row))
    return b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (h, w) + b"".join(rows)


class MockForge(object):
    def __init__(self):
        self.state = {"version": 0, "hdr": None, "w": 0, "h": 0, "final": False, "pass": ""}
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
                    outer.clients = getattr(outer, "clients", []) + [self.headers.get("X-Forge-Client")]
                    body = {"ok": True, "app": "HDRI Forge Studio", "mode": "dev", "protocol": 1, "capabilities": [],
                            "version": s["version"], "forge": 1, "hasMap": s["hdr"] is not None, "w": s["w"], "h": s["h"],
                            "final": s["final"], "pass": s["pass"], "ms": 5}
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

    def push(self, w, h, sun_x, final=True):
        self.state.update(hdr=make_hdr(w, h, sun_x), w=w, h=h, final=final, **{"pass": "%dx%d" % (w, h)})
        self.state["version"] += 1

    def close(self):
        self.server.shutdown()
        self.server.server_close()


# ── the test, as a state machine advanced from the editor tick ────────────
state = {"step": 0, "t0": time.time(), "deadline": time.time() + 240, "handle": None, "mock": None, "bridge": None}
ctx = {}


def waiting(pred, timeout=40):
    """True once pred() holds; fails the run if it never does."""
    if pred():
        ctx.pop("wait_since", None)
        return True
    since = ctx.setdefault("wait_since", time.time())
    if time.time() - since > timeout:
        check(False, "timed out waiting at step %d" % state["step"])
        finish_all()
    return False


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


def get_cameras_over_http():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8977/__hdri_bridge_cameras", timeout=8) as r:
            ctx["http_cams"] = json.loads(r.read().decode())
    except Exception as e:
        ctx["http_cams"] = {"error": str(e)}


def step(_dt):
    try:
        _step()
    except Exception:
        tb = traceback.format_exc()
        for line in tb.splitlines():
            unreal.log_warning("[FORGE TEST] " + line)
        check(False, "exception: " + tb.splitlines()[-1])
        finish_all()


def _step():
    b = state["bridge"]
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    n = state["step"]
    if time.time() > state["deadline"]:
        check(False, "overall timeout")
        return finish_all()

    if n == 0:
        # an artist sky light that Live must put out of the way, and bring back
        ctx["artist"] = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 500))
        ctx["artist"].set_actor_label("ArtistSky")
        state["mock"].push(512, 256, 300)
        b.live_start(ports=[PORT])
        check(b.client_name().startswith("Unreal 5.8"), "client name %r" % b.client_name())
        state["step"] = 1
    elif n == 1:
        if waiting(lambda: actor_by_tag("HDRIForgeBridge:live") is not None):
            a = actor_by_tag("HDRIForgeBridge:live")
            check("HDRIBackdrop" in a.get_class().get_name(), "live map is shown on an HDRI Backdrop (%s)" % a.get_class().get_name())
            cube = a.get_editor_property("Cubemap")
            check(isinstance(cube, unreal.TextureCube) and "/Game/HDRIForge/Live/" in cube.get_path_name(),
                  "backdrop uses the imported TextureCube %s" % cube.get_path_name())
            ctx["slot1"] = cube.get_path_name()
            check(ctx["artist"].is_temporarily_hidden_in_editor(), "the artist's own Sky Light is put out of the way")
            check(abs(abs(a.get_actor_rotation().yaw) - 180.0) < 0.01, "map is turned half a turn to Forge's orientation")
            check(any("Unreal 5.8" in (c or "") for c in getattr(state["mock"], "clients", [])), "Forge sees the client name in its status poll")
            state["mock"].push(512, 256, 100)                    # a new map arrives while live
            state["step"] = 2
    elif n == 2:
        a = actor_by_tag("HDRIForgeBridge:live")
        cube = a.get_editor_property("Cubemap") if a else None
        if waiting(lambda: cube is not None and cube.get_path_name() != ctx["slot1"]):
            check(True, "a new map from Forge replaces the shown one (%s -> %s)" % (ctx["slot1"].split(".")[-1], cube.get_path_name().split(".")[-1]))
            check(len([x for x in eas.get_all_level_actors() if any(str(t) == "HDRIForgeBridge:live" for t in x.tags)]) == 1, "still exactly one live actor")
            b.set_sky(exposure_ev=1.0, yaw=10.0)
            check(abs(a.get_editor_property("Intensity") - 2.0) < 1e-6 and abs(a.get_actor_rotation().yaw - (-170.0)) < 0.01 or abs(a.get_actor_rotation().yaw - 190.0) < 0.01, "exposure +1 EV doubles intensity, yaw adds")
            b.live_stop()
            check(actor_by_tag("HDRIForgeBridge:live") is None, "Live off removes the bridge's actor")
            check(not ctx["artist"].is_temporarily_hidden_in_editor(), "...and shows the artist's sky again")
            check(not unreal.EditorAssetLibrary.does_directory_exist("/Game/HDRIForge/Live") or not unreal.EditorAssetLibrary.list_assets("/Game/HDRIForge/Live"), "...and removes the temporary live textures")
            state["step"] = 3
    elif n == 3:
        # Import keeps the map permanently (download on a background thread, import back on the main thread)
        b.import_hdri(ports=[PORT], done=lambda frame, err: ctx.update(imp=(frame, err)))
        state["step"] = 31
    elif n == 31:
        if not waiting(lambda: "imp" in ctx):
            return
        frame, err = ctx["imp"]
        check(err is None and frame is not None, "Import HDRI finishes without error (%s)" % err)
        a = actor_by_tag("HDRIForgeBridge:import")
        check(a is not None, "Import HDRI creates the import backdrop")
        cube = a.get_editor_property("Cubemap") if a else None
        check(cube is not None and "/Game/HDRIForge/Imported/forge_hdri" in cube.get_path_name(), "import is a saved asset %s" % (cube.get_path_name() if cube else None))
        check(frame is not None and os.path.exists(frame.path) and frame.path.endswith(".hdr"), "the .hdr is kept next to the project")
        check(frame is not None and bool(frame.ash_path) and os.path.exists(frame.ash_path), "...with its .ash")
        b.restore_sky()
        check(actor_by_tag("HDRIForgeBridge") is None, "Restore sky removes everything the bridge made")
        # cameras
        cam = eas.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(1000, 200, 150))
        cam.set_actor_label("ShotA")
        cam.set_actor_rotation(unreal.Rotator(0, 0, 90), False)             # yaw 90: looks along +Y (Forge's +X)
        ctx["cam"] = cam
        cams = b.gather_cameras()
        shot = next((c for c in cams if c["name"] == "ShotA"), None)
        check(shot is not None, "gather_cameras finds the Cine Camera")
        if shot:
            p, r = shot["position"], shot["rotation"]
            check(abs(p["x"] - 2.0) < 1e-6 and abs(p["y"] - 1.5) < 1e-6 and abs(p["z"] + 10.0) < 1e-6, "position cm -> Forge metres, axes mapped (%s)" % p)
            check(abs(r["y"] + 90.0) < 0.01 and abs(r["x"]) < 0.01 and abs(r["z"]) < 0.01, "yaw 90 turns the camera to Forge's +X (%s)" % {k: round(v, 3) for k, v in r.items()})
            check(0 < shot["fov"] < 180, "vertical field of view %.2f" % shot["fov"])
        threading.Thread(target=get_cameras_over_http, daemon=True).start()
        state["step"] = 4
    elif n == 4:
        if waiting(lambda: "http_cams" in ctx):
            j = ctx["http_cams"]
            check(j.get("ok") is True and any(c["name"] == "ShotA" for c in j.get("cameras", [])), "Forge can pull cameras from Unreal over HTTP (%s)" % (j.get("error") or "%d cameras" % len(j.get("cameras", []))))
            check(j.get("source") == "unreal", "camera reply is tagged source=unreal")
            menus = unreal.ToolMenus.get()
            check(menus.find_menu("LevelEditor.MainMenu.HDRIForgeBridge") is not None, "the HDRI Forge menu exists in the editor")
            finish_all()


def start():
    sys.path.insert(0, os.environ["FORGE_PLUGIN_PYTHON"])
    import hdri_forge_bridge_unreal as bridge
    state["bridge"] = bridge
    state["mock"] = MockForge()
    bridge.startup()
    state["handle"] = unreal.register_slate_post_tick_callback(step)


start()
