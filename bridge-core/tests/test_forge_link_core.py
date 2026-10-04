"""
Tests for forge_link_core against a mock bridge that behaves like Forge's
/__erik_live endpoints. No DCC needed.

Run:  python -m unittest discover -s bridge-core/tests -v
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import forge_link_core as core  # noqa: E402


def hdr_bytes(w, h, fill=b"x"):
    """A tiny stand-in for a Radiance file: real header, junk body."""
    return b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (h, w) + fill * 16


class MockBridge(object):
    """One fake Forge instance on an ephemeral port."""

    def __init__(self, app=core.APP_NAME, forge=1, mode="dev", port=0, protocol=1):
        self.state = {"app": app, "forge": forge, "mode": mode, "protocol": protocol,
                      "version": 0, "hdr": None, "ash": "", "w": 0, "h": 0, "final": False, "pass": "", "ms": 5}
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
                if p == core.BASE_PATH + "/status":
                    body = {"ok": True, "app": s["app"], "mode": s["mode"], "protocol": s["protocol"],
                            "version": s["version"], "forge": s["forge"], "hasMap": s["hdr"] is not None,
                            "w": s["w"], "h": s["h"], "final": s["final"], "pass": s["pass"], "ms": s["ms"]}
                    self._send(200, json.dumps(body).encode(), "application/json")
                elif p == core.BASE_PATH + "/hdr":
                    if s["hdr"] is None:
                        self._send(404, b"no map yet")
                    else:
                        self._send(200, s["hdr"])
                elif p == core.BASE_PATH + "/ash":
                    if not s["ash"]:
                        self._send(404, b"no sh yet")
                    else:
                        self._send(200, s["ash"].encode(), "text/plain")
                else:
                    self._send(404, b"nf")

        class Srv(ThreadingHTTPServer):
            allow_reuse_address = True
            daemon_threads = True

        self.server = Srv(("127.0.0.1", port), H)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def push(self, w, h, final=False, ash="SH 1 2 3", label=""):
        self.state.update(hdr=hdr_bytes(w, h), w=w, h=h, final=final, ash=ash, **{"pass": label or "%dx%d" % (w, h)})
        self.state["version"] += 1

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def wait_for(pred, timeout=5.0, step=0.02):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(step)
    return pred()


class HdrSizeTests(unittest.TestCase):
    def test_parses_width_and_height(self):
        self.assertEqual(core.parse_hdr_size(hdr_bytes(1024, 512)), (1024, 512))

    def test_garbage_gives_zero(self):
        self.assertEqual(core.parse_hdr_size(b"not an hdr"), (0, 0))


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.servers = []

    def tearDown(self):
        for s in self.servers:
            s.close()

    def mk(self, **kw):
        s = MockBridge(**kw)
        self.servers.append(s)
        return s

    def test_ignores_other_apps_and_closed_ports(self):
        other = self.mk(app="Some Other Server")
        forge = self.mk()
        found = core.discover([other.port, forge.port, 1], timeout=0.4)
        self.assertEqual([f["port"] for f in found], [forge.port])

    def test_prefers_the_instance_forge_is_streaming_to(self):
        idle = self.mk(forge=0, mode="desktop")
        idle.push(256, 128)
        live = self.mk(forge=1, mode="dev")
        found = core.discover([idle.port, live.port], timeout=0.4)
        self.assertEqual(found[0]["port"], live.port)
        self.assertEqual(found[0]["mode"], "dev")

    def test_then_prefers_one_that_already_holds_a_map(self):
        empty = self.mk(forge=0)
        full = self.mk(forge=0)
        full.push(256, 128)
        found = core.discover([empty.port, full.port], timeout=0.4)
        self.assertEqual(found[0]["port"], full.port)

    def test_nothing_running_returns_empty(self):
        self.assertEqual(core.discover([1, 2], timeout=0.2), [])


class LinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="forge_link_test_")
        self.bridge = MockBridge()
        self.link = core.ForgeLink(cache_dir=self.tmp, ports=[self.bridge.port], poll_interval=0.02,
                                   probe_timeout=0.3, request_timeout=2.0)

    def tearDown(self):
        self.link.stop()
        try:
            self.bridge.close()
        except Exception:
            pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    def take(self, timeout=3.0):
        out = []
        wait_for(lambda: out.append(self.link.take_frame()) or out[-1] is not None, timeout, 0.01)
        return out[-1]

    def test_waits_until_forge_sends_a_map(self):
        self.link.start()
        self.assertTrue(wait_for(lambda: self.link.status()["state"] == core.WAITING))
        self.assertIn("Erik Live", self.link.status()["message"])

    def test_downloads_a_map_with_size_and_ash(self):
        self.bridge.push(512, 256, final=False, ash="SH 9 8 7")
        self.link.start()
        f = self.take()
        self.assertIsNotNone(f)
        self.assertEqual((f.width, f.height), (512, 256))
        self.assertFalse(f.final)
        self.assertEqual(f.ash_text, "SH 9 8 7")
        with open(f.path, "rb") as fh:
            self.assertEqual(fh.read(), hdr_bytes(512, 256))
        self.assertTrue(os.path.exists(f.ash_path))
        self.assertEqual(self.link.status()["state"], core.STREAMING)

    def test_final_pass_is_flagged(self):
        self.bridge.push(256, 128, final=False)
        self.link.start()
        self.take()
        self.link.frame_applied(core.Frame(width=256, height=128))
        self.bridge.push(1024, 512, final=True)
        f = self.take()
        self.assertTrue(f.final)
        self.assertIn("FINAL", self.link.status()["message"])

    def test_newest_wins_when_dcc_is_slow(self):
        self.bridge.push(256, 128)
        self.link.start()
        self.take()
        self.link.frame_applied(core.Frame(width=256, height=128))
        # Five quick passes while the DCC is "busy" (never takes a frame in between).
        for w in (256, 512, 1024, 1024, 2048):
            self.bridge.push(w, w // 2)
            time.sleep(0.01)
        self.assertTrue(wait_for(lambda: self.link.status()["width"] == 2048))
        f = self.take()
        self.assertEqual(f.width, 2048)
        self.assertIsNone(self.link.take_frame())       # nothing older is queued behind it

    def test_spaces_updates_by_map_size(self):
        self.bridge.push(256, 128)
        self.link.start()
        self.take()
        # The DCC just applied a 4 MP map, so the next update must wait ~0.46 s.
        self.link.frame_applied(core.Frame(width=2000, height=2000))
        t0 = time.time()
        self.bridge.push(256, 128)
        self.take(timeout=3.0)
        self.assertGreaterEqual(time.time() - t0, 0.3)

    def test_old_files_are_pruned(self):
        self.bridge.push(256, 128)
        self.link.start()
        for i in range(8):
            f = self.take()
            self.link.frame_applied(f)
            self.bridge.push(256 + i, 128)
            time.sleep(0.05)
        hdrs = [n for n in os.listdir(self.tmp) if n.endswith(".hdr")]
        self.assertLessEqual(len(hdrs), 3)
        self.assertFalse([n for n in os.listdir(self.tmp) if n.endswith(".part")])

    def test_start_purges_stale_files_and_cleanup_removes_renderer_caches(self):
        # A previous run that never got to clean up (DCC closed/crashed) must not leave maps behind forever,
        # and Arnold writes live_N.tx next to each map, which cleanup() has to remove too.
        for n in ("live_999.hdr", "live_999.ash", "live_999.tx", "live_5.hdr.part"):
            with open(os.path.join(self.tmp, n), "wb") as fh:
                fh.write(b"old")
        with open(os.path.join(self.tmp, "keep.txt"), "wb") as fh:
            fh.write(b"not ours")
        self.bridge.push(256, 128)
        self.link.start()
        f = self.take()
        self.assertFalse([n for n in os.listdir(self.tmp) if n.startswith("live_999") or n.endswith(".part")])
        tx = f.path[:-4] + ".tx"
        with open(tx, "wb") as fh:
            fh.write(b"arnold cache")
        self.link.stop()
        self.link.cleanup()
        self.assertFalse(os.path.exists(tx))
        self.assertFalse(os.path.exists(f.path))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "keep.txt")))   # never touches files that are not live_*

    def test_reconnects_after_forge_restarts(self):
        port = self.bridge.port
        self.bridge.push(256, 128)
        self.link.start()
        self.take()
        self.bridge.close()
        self.assertTrue(wait_for(lambda: self.link.status()["state"] in (core.SEARCHING, core.ERROR), 5))
        self.bridge = MockBridge(port=port)
        self.bridge.push(512, 256)
        f = self.take(timeout=8.0)
        self.assertIsNotNone(f)
        self.assertEqual(f.width, 512)

    def test_picks_up_a_map_when_forge_restarts_with_a_lower_version(self):
        # Forge restarting resets its counter. Without handling, "version 1" after "version 3" looks stale.
        for w in (256, 512, 1024):
            self.bridge.push(w, w // 2)
        self.link.start()
        self.take()
        self.link.frame_applied(core.Frame(width=1024, height=512))
        self.bridge.state["version"] = 0
        self.bridge.push(2048, 1024)              # version is now 1, lower than the 3 already taken
        f = self.take(timeout=4.0)
        self.assertIsNotNone(f)
        self.assertEqual(f.width, 2048)

    def test_warns_when_forge_is_newer_than_the_addon(self):
        self.bridge.state["protocol"] = core.PROTOCOL + 1
        self.link.start()
        self.assertTrue(wait_for(lambda: "Update the addon" in self.link.status()["note"]))

    def test_old_forge_without_protocol_still_works(self):
        self.bridge.state["protocol"] = 0
        self.bridge.push(256, 128)
        self.link.start()
        self.assertIsNotNone(self.take())
        self.assertEqual(self.link.status()["note"], "")

    def test_stop_goes_off_and_stops_the_thread(self):
        self.link.start()
        self.assertTrue(wait_for(lambda: self.link.status()["state"] != core.OFF))
        self.link.stop()
        self.assertEqual(self.link.status()["state"], core.OFF)
        self.assertFalse(self.link.running)

    def test_not_found_message_when_nothing_is_running(self):
        self.bridge.close()
        self.link.start()
        self.assertTrue(wait_for(lambda: self.link.status()["state"] == core.ERROR, 5))
        self.assertIn("not found", self.link.status()["message"])


class FetchLatestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="forge_fetch_test_")
        self.bridge = MockBridge()

    def tearDown(self):
        self.bridge.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_saves_hdr_and_ash_pair(self):
        self.bridge.push(1024, 512, final=True, ash="SH data")
        f = core.fetch_latest(self.tmp, "car", ports=[self.bridge.port])
        self.assertTrue(f.path.endswith("car_001.hdr"))
        self.assertTrue(f.ash_path.endswith("car_001.ash"))
        self.assertEqual((f.width, f.height), (1024, 512))
        with open(f.ash_path) as fh:
            self.assertEqual(fh.read(), "SH data")

    def test_never_overwrites(self):
        self.bridge.push(256, 128)
        a = core.fetch_latest(self.tmp, "car", ports=[self.bridge.port])
        b = core.fetch_latest(self.tmp, "car", ports=[self.bridge.port])
        self.assertNotEqual(a.path, b.path)
        self.assertTrue(b.path.endswith("car_002.hdr"))

    def test_no_map_yet_is_a_clear_error(self):
        with self.assertRaises(core.ForgeLinkError) as cm:
            core.fetch_latest(self.tmp, ports=[self.bridge.port])
        self.assertIn("Erik Live", str(cm.exception))

    def test_forge_not_running_is_a_clear_error(self):
        with self.assertRaises(core.ForgeLinkError) as cm:
            core.fetch_latest(self.tmp, ports=[1], probe_timeout=0.2)
        self.assertIn("not found", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
