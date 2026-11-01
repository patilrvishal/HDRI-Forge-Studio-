"""
End to end against the REAL HDRI Forge Studio (desktop app or dev server must be running): one call to live_start(), and
Forge has to start streaming on its own (auto-link), the map has to arrive, and Unreal has to show it on an HDRI Backdrop.

Runs inside Unreal Editor (see run_unreal_test.py --e2e).
"""
import json
import os
import sys
import threading
import time
import traceback
import urllib.request

import unreal

OUT = os.environ.get("FORGE_TEST_OUT", "forge_e2e_test.txt")
results = []
state = {"step": 0, "t0": time.time(), "handle": None, "bridge": None}
ctx = {}


def check(ok, msg):
    results.append(("PASS  " if ok else "FAIL  ") + msg)


def finish():
    summary = "ALL PASS" if results and all(r.startswith("PASS") for r in results) else "FAILED"
    text = "\n".join(results + [summary])
    for line in text.splitlines():
        unreal.log("[FORGE E2E] " + line)
    try:
        with open(OUT, "w") as f:
            f.write(text)
    except Exception as e:
        unreal.log_warning("[FORGE E2E] could not write %s: %s" % (OUT, e))
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def finish_all():
    try:
        unreal.unregister_slate_post_tick_callback(state["handle"])
    except Exception:
        pass
    try:
        state["bridge"].shutdown()
    except Exception:
        pass
    finish()


def forge_status():
    """Forge's own view of the link, read from a background thread."""
    for port in range(5173, 5181):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/__erik_live/status" % port, timeout=2) as r:
                j = json.loads(r.read().decode())
                if j.get("app") == "HDRI Forge Studio":
                    ctx["forge"] = j
                    return
        except Exception:
            continue
    ctx["forge"] = {"error": "Forge not found"}


def actor_by_tag(tag):
    for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        if any(str(t) == tag for t in a.tags):
            return a
    return None


def step(_dt):
    try:
        _step()
    except Exception:
        tb = traceback.format_exc()
        for line in tb.splitlines():
            unreal.log_warning("[FORGE E2E] " + line)
        check(False, "exception: " + tb.splitlines()[-1])
        finish_all()


def _step():
    b = state["bridge"]
    n = state["step"]
    if time.time() - state["t0"] > 150:
        check(False, "timed out at step %d; link status %s" % (n, b.live_status()))
        return finish_all()
    if n == 0:
        b.live_start()                       # default ports: finds the real Forge by itself
        state["step"] = 1
    elif n == 1:
        a = actor_by_tag("HDRIForgeBridge:live")
        st = b.live_status()
        if a is not None:
            cube = a.get_editor_property("Cubemap")
            ok = isinstance(cube, unreal.TextureCube) and "/Game/HDRIForge/Live/" in cube.get_path_name()
            check(ok, "Forge streamed a map and Unreal shows it on the backdrop (%s, %s)" % (cube.get_path_name().split(".")[-1], st.get("message")))
            check(st.get("mode") in ("desktop", "dev"), "linked to the real Forge (%s, port %s)" % (st.get("mode"), st.get("port")))
            threading.Thread(target=forge_status, daemon=True).start()
            state["step"] = 2
    elif n == 2:
        if "forge" in ctx:
            f = ctx["forge"]
            names = [v.get("name") for v in f.get("viewers", [])]
            check(any("Unreal 5.8" in (x or "") for x in names), "Forge lists this Unreal as linked: %s" % names)
            check(f.get("hasMap") is True and f.get("version", 0) >= 1, "Forge started streaming without anyone touching it (version %s)" % f.get("version"))
            b.live_stop()
            check(actor_by_tag("HDRIForgeBridge") is None, "stopping removes the sky from the level")
            finish_all()


def start():
    sys.path.insert(0, os.environ["FORGE_PLUGIN_PYTHON"])
    import hdri_forge_bridge_unreal as bridge
    state["bridge"] = bridge
    bridge.startup()
    state["handle"] = unreal.register_slate_post_tick_callback(step)


start()
