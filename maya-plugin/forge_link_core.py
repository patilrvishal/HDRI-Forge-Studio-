"""
forge_link_core - DCC-agnostic client for HDRI Forge Studio's live HDRI stream.

HDRI Forge Studio already streams the HDRI it renders (and its spherical
harmonics .ash) to a small local bridge for Erik Adjuster:

    GET /__erik_live/status   -> {app, version, hasMap, w, h, final, ms, protocol, ...}
    GET /__erik_live/hdr      -> Radiance RLE .hdr bytes (newest map only)
    GET /__erik_live/ash      -> text spherical harmonics (optional)

This module is the Blender / Maya / any-other-DCC side of that same link. It
does the parts that have nothing to do with a particular DCC:

  * find Forge (dev server or desktop app, any port 5173..5180) on its own
  * poll /status in a background thread and download new maps
  * newest-wins coalescing: if Forge sends five passes while the DCC is busy,
    the DCC sees only the latest one
  * space updates by map size, like Erik does, so a big map is never replaced
    mid-load
  * reconnect with backoff when Forge restarts, with a plain-English status
  * one-shot fetch for "Import HDRI"

It never touches a DCC API. The adapter (Blender: bpy.app.timers, Maya:
scriptJob) calls take_frame() on its own main thread and applies the frame.

Standard library only, Python 3.7+ (Maya 2022+ ships 3.7, Blender 4.x 3.10+).
Keep this file byte-identical in blender-addon/ and maya-plugin/ (see
bridge-core/sync.py).
"""
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request

PROTOCOL = 1                       # newest /status protocol this client understands
APP_NAME = "HDRI Forge Studio"
BASE_PATH = "/__erik_live"
# Probe both loopback families explicitly and in parallel. "localhost" is NOT used: on Windows it tries
# ::1 first, and a refused connect there takes ~2 s, so a perfectly healthy 127.0.0.1 server (the desktop
# app) would answer 2 s late. The desktop app binds 127.0.0.1; Vite may bind either, depending on Node.
HOSTS = ("127.0.0.1", "[::1]")
SCAN_PORTS = tuple(range(5173, 5181))

# Link states shown in the DCC panel.
OFF, SEARCHING, WAITING, STREAMING, ERROR = "off", "searching", "waiting", "streaming", "error"


class ForgeLinkError(Exception):
    """A problem with a plain-English message that is safe to show to the user."""


# ── small helpers ───────────────────────────────────────────────────────────

def _http_get(url, timeout, headers=None):
    h = {"Cache-Control": "no-store"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _get_json(url, timeout, headers=None):
    return json.loads(_http_get(url, timeout, headers).decode("utf-8"))


def _clean_client_name(name):
    """Header-safe, short, printable ASCII. Shown to the user in Forge's badge."""
    ok = "".join(c for c in str(name) if 32 <= ord(c) < 127)[:40].strip()
    return ok or "DCC"


def parse_hdr_size(data):
    """Return (width, height) from a Radiance .hdr header, or (0, 0) if it can't be read."""
    head = data[:512]
    m = re.search(rb"[-+]Y\s+(\d+)\s+[-+]X\s+(\d+)", head)
    if not m:
        return 0, 0
    return int(m.group(2)), int(m.group(1))


def _gap_seconds(last_megapixels):
    """Minimum time between applying two maps. Bigger maps need longer to ingest."""
    return 0.06 + 0.10 * last_megapixels


class Frame(object):
    """One downloaded map, ready for the DCC to apply."""
    __slots__ = ("version", "path", "ash_path", "ash_text", "width", "height",
                 "final", "ms", "label", "mode", "port", "download_s")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))

    @property
    def megapixels(self):
        return (self.width or 0) * (self.height or 0) / 1e6

    def describe(self):
        size = "%dx%d" % (self.width, self.height) if self.width else "map"
        return ("FINAL " + size) if self.final else ("preview " + size)


# ── discovery ───────────────────────────────────────────────────────────────

def _probe_port(port, timeout, host):
    """Ask one port for /status. Returns an instance dict, or None if it isn't Forge."""
    try:
        st = _get_json("http://%s:%d%s/status" % (host, port, BASE_PATH), timeout)
    except Exception:
        return None
    if not isinstance(st, dict) or st.get("app") != APP_NAME:
        return None
    return {
        "port": port,
        "host": host,
        "base": "http://%s:%d%s" % (host, port, BASE_PATH),
        "mode": st.get("mode", "dev"),
        "forge": int(st.get("forge", 0) or 0),        # Forge pages currently listening (Erik Live on)
        "hasMap": bool(st.get("hasMap")),
        "version": int(st.get("version", 0) or 0),
        "protocol": int(st.get("protocol", 0) or 0),
        "capabilities": list(st.get("capabilities", []) or []),
    }


def discover(ports=SCAN_PORTS, timeout=0.4, hosts=HOSTS):
    """
    Find every HDRI Forge Studio bridge, probing every port on every loopback family in
    parallel, and return them best first. "Best" means a Forge page is actively streaming
    (Erik Live on), then one that already holds a map, then the lowest port.
    """
    found = {}
    lock = threading.Lock()

    def run(p, host):
        inst = _probe_port(p, timeout, host)
        if inst:
            with lock:
                # a dual-stack server answers on both; keep the first host in HOSTS order
                prev = found.get(p)
                if prev is None or hosts.index(host) < hosts.index(prev["host"]):
                    found[p] = inst

    threads = [threading.Thread(target=run, args=(p, h), daemon=True) for p in ports for h in hosts]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout + 0.5)
    out = list(found.values())
    out.sort(key=lambda i: (-int(i["forge"] > 0), -int(i["hasMap"]), i["port"]))
    return out


# ── the live link ───────────────────────────────────────────────────────────

class ForgeLink(object):
    """
    Background poller. Typical use from a DCC adapter:

        link = ForgeLink()
        link.start()
        ...                                  # every ~100 ms, on the DCC main thread:
        frame = link.take_frame()
        if frame:
            apply(frame)                     # load frame.path into the DCC
            link.frame_applied(frame)
        ...
        link.stop()
    """

    def __init__(self, cache_dir=None, want_ash=True, poll_interval=0.2,
                 ports=SCAN_PORTS, probe_timeout=0.4, request_timeout=5.0, keep_files=3,
                 client_name="DCC"):
        self._ports = tuple(ports)
        # Sent with every /status poll so Forge can show "Blender 5.1 linked" instead of "waiting for Erik".
        self._client_headers = {"X-Forge-Client": _clean_client_name(client_name)}
        self._probe_timeout = probe_timeout
        self._request_timeout = request_timeout
        self._poll = poll_interval
        self._want_ash = want_ash
        self._keep = max(2, keep_files)
        self._dir = cache_dir or os.path.join(tempfile.gettempdir(), "hdri_forge_link_%d" % os.getpid())

        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._status = {"state": OFF, "message": "Off", "port": 0, "mode": "", "version": 0,
                        "width": 0, "height": 0, "final": False, "ms": 0, "frames": 0, "note": ""}
        self._pending = None            # newest frame the DCC has not taken yet
        self._last_version = 0
        self._applied_at = 0.0
        self._applied_mp = 0.0
        self._written = []              # files we created, oldest first
        self._log = []                  # last messages, for a diagnostics panel

    # ---- public API ------------------------------------------------------

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._last_version = 0
        self._purge_dir()                    # leftovers from a previous run that never got to clean up
        self._set(state=SEARCHING, message="Looking for HDRI Forge Studio...", frames=0, note="")
        self._thread = threading.Thread(target=self._run, name="forge-link", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        t = self._thread
        if t and t.is_alive() and t is not threading.current_thread():
            t.join(2.0)
        self._thread = None
        with self._lock:
            self._pending = None
        self._set(state=OFF, message="Off", port=0, mode="", width=0, height=0, final=False)

    @property
    def running(self):
        return bool(self._thread and self._thread.is_alive() and not self._stop.is_set())

    def status(self):
        with self._lock:
            return dict(self._status)

    def log_lines(self):
        with self._lock:
            return list(self._log)

    def take_frame(self):
        """Newest map the DCC has not seen yet, or None. Safe to call from any thread."""
        with self._lock:
            f, self._pending = self._pending, None
            return f

    def frame_applied(self, frame):
        """Tell the link the DCC finished loading this frame (drives update spacing)."""
        with self._lock:
            self._applied_at = time.time()
            self._applied_mp = frame.megapixels if frame else 0.0

    def cleanup(self):
        """Delete the temp files this link wrote, and any cache a renderer made next to them."""
        with self._lock:
            files, self._written = self._written, []
        for p in files:
            try:
                os.remove(p)
            except OSError:
                pass
        self._purge_dir()

    def _purge_dir(self):
        """Remove live_* files (maps, .ash, partial downloads, renderer .tx caches) from our cache folder."""
        try:
            names = os.listdir(self._dir)
        except OSError:
            return
        for n in names:
            if n.startswith("live_") and n.rsplit(".", 1)[-1] in ("hdr", "ash", "part", "tx"):
                try:
                    os.remove(os.path.join(self._dir, n))
                except OSError:
                    pass                          # still in use by the DCC: it will go on the next purge

    # ---- internals -------------------------------------------------------

    def _set(self, **kw):
        with self._lock:
            self._status.update(kw)
            msg = kw.get("message")
            if msg and (not self._log or self._log[-1][1] != msg):
                self._log.append((time.time(), msg))
                del self._log[:-50]

    def _wait(self, seconds):
        self._stop.wait(seconds)

    def _run(self):
        backoff = 0.5
        base = None
        inst = None
        while not self._stop.is_set():
            if base is None:
                self._set(state=SEARCHING, message="Looking for HDRI Forge Studio...")
                found = discover(self._ports, self._probe_timeout)
                if not found:
                    self._set(state=ERROR, port=0,
                              message="HDRI Forge Studio not found. Open the app (or run npm run dev).")
                    self._wait(backoff)
                    backoff = min(backoff * 2, 4.0)
                    continue
                inst = found[0]
                base = inst["base"]
                backoff = 0.5
                self._last_version = 0          # a restarted Forge counts versions from 0 again
                note = ""
                if inst["protocol"] > PROTOCOL:
                    note = "Forge is newer than this addon. Update the addon to keep every feature."
                self._set(port=inst["port"], mode=inst["mode"], note=note,
                          message="Connected to HDRI Forge Studio (%s, port %d)" % (inst["mode"], inst["port"]))

            try:
                st = _get_json(base + "/status", self._request_timeout, self._client_headers)
            except Exception:
                base = None
                self._set(state=SEARCHING, message="Lost connection to HDRI Forge Studio. Reconnecting...")
                self._wait(backoff)
                backoff = min(backoff * 2, 4.0)
                continue

            if st.get("app") != APP_NAME:
                base = None
                continue

            if not st.get("hasMap"):
                self._set(state=WAITING, message='Connected. In Forge, turn on "Erik Live" to start streaming.')
                self._wait(self._poll)
                continue

            version = int(st.get("version", 0) or 0)
            if version < self._last_version:
                self._last_version = 0          # Forge restarted between two polls: take the new map
            if version == self._last_version:
                self._wait(self._poll)
                continue

            # Space updates by the size of the last applied map so a big map is never replaced mid-load.
            with self._lock:
                wait = _gap_seconds(self._applied_mp) - (time.time() - self._applied_at)
            if wait > 0:
                self._wait(min(wait, 1.0))
                continue                      # re-read /status: the version may have moved on (newest wins)

            try:
                frame = self._download(inst, st, version)
            except Exception as e:
                self._set(state=ERROR, message="Update failed: %s" % e)
                self._wait(self._poll * 2)
                continue

            self._last_version = frame.version
            self._publish(frame)

    def _download(self, inst, st, version):
        t0 = time.time()
        base = inst["base"]
        data = _http_get(base + "/hdr", self._request_timeout)
        w, h = parse_hdr_size(data)
        ash_text = None
        if self._want_ash:
            try:
                ash_text = _http_get(base + "/ash", self._request_timeout).decode("utf-8", "replace")
            except Exception:
                ash_text = None                       # diffuse light is optional
        os.makedirs(self._dir, exist_ok=True)
        path = os.path.join(self._dir, "live_%d.hdr" % version)
        self._atomic_write(path, data)
        ash_path = None
        if ash_text:
            ash_path = os.path.join(self._dir, "live_%d.ash" % version)
            self._atomic_write(ash_path, ash_text.encode("utf-8"))
        return Frame(version=version, path=path, ash_path=ash_path, ash_text=ash_text,
                     width=w or int(st.get("w", 0) or 0), height=h or int(st.get("h", 0) or 0),
                     final=bool(st.get("final")), ms=int(st.get("ms", 0) or 0),
                     label=str(st.get("pass", "")), mode=inst["mode"], port=inst["port"],
                     download_s=time.time() - t0)

    def _atomic_write(self, path, data):
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        with self._lock:
            self._written.append(path)

    def _publish(self, frame):
        with self._lock:
            self._pending = frame
            frames = self._status["frames"] + 1
            self._status.update(state=STREAMING, version=frame.version, width=frame.width,
                                height=frame.height, final=frame.final, ms=frame.ms, frames=frames)
            self._status["message"] = ("Live: %s%s" % (frame.describe(), "" if frame.final else ", refining..."))
            self._log.append((time.time(), self._status["message"]))
            del self._log[:-50]
            stale = self._written[:-self._keep * 2]       # hdr + ash per version
            self._written = self._written[-self._keep * 2:]
        for p in stale:
            try:
                os.remove(p)
            except OSError:
                pass


# ── one-shot import ─────────────────────────────────────────────────────────

def fetch_latest(dest_dir, name="forge_hdri", want_ash=True, ports=SCAN_PORTS,
                 probe_timeout=0.4, request_timeout=15.0):
    """
    Download the newest map (and its .ash) once and save it as <dest_dir>/<name>_NNN.hdr.
    Never overwrites: each call gets the next free number. Returns a Frame.
    Raises ForgeLinkError with a message that is safe to show to the user.
    """
    found = discover(ports, probe_timeout)
    if not found:
        raise ForgeLinkError("HDRI Forge Studio not found. Open the app (or run npm run dev).")
    inst = found[0]
    try:
        st = _get_json(inst["base"] + "/status", request_timeout)
    except Exception as e:
        raise ForgeLinkError("Could not read HDRI Forge Studio: %s" % e)
    if not st.get("hasMap"):
        raise ForgeLinkError('Forge has not sent a map yet. Turn on "Erik Live" in Forge first.')
    try:
        data = _http_get(inst["base"] + "/hdr", request_timeout)
    except Exception as e:
        raise ForgeLinkError("Could not download the map: %s" % e)
    ash_text = None
    if want_ash:
        try:
            ash_text = _http_get(inst["base"] + "/ash", request_timeout).decode("utf-8", "replace")
        except Exception:
            ash_text = None

    os.makedirs(dest_dir, exist_ok=True)
    n = 1
    while os.path.exists(os.path.join(dest_dir, "%s_%03d.hdr" % (name, n))):
        n += 1
    path = os.path.join(dest_dir, "%s_%03d.hdr" % (name, n))
    with open(path, "wb") as f:
        f.write(data)
    ash_path = None
    if ash_text:
        ash_path = os.path.join(dest_dir, "%s_%03d.ash" % (name, n))
        with open(ash_path, "w", encoding="utf-8") as f:
            f.write(ash_text)
    w, h = parse_hdr_size(data)
    return Frame(version=int(st.get("version", 0) or 0), path=path, ash_path=ash_path, ash_text=ash_text,
                 width=w, height=h, final=bool(st.get("final")), ms=int(st.get("ms", 0) or 0),
                 label=str(st.get("pass", "")), mode=inst["mode"], port=inst["port"], download_s=0.0)
