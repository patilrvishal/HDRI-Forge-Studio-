"""
HDRI Forge Bridge for Unreal Engine 5
-------------------------------------
The Unreal counterpart of the Blender and Maya add-ons, and of Erik Adjuster's live link:

  * Live HDRI    - HDRI Forge Studio streams its map and Unreal lights the level with it as you edit.
                   Progressive passes (256 -> 512 -> 1024 -> final) arrive on their own; newest wins.
  * Import HDRI  - saves the current map (and its .ash) next to the project and keeps it as a real TextureCube
                   asset on an HDRI Backdrop, permanently, unlike Live.
  * Cameras      - "Push cameras" sends the level's cameras (or the selected ones, or the viewport) to Forge, and
                   Forge's "Import cameras > Unreal Engine" pulls them back from this plug-in (port 8977).
  * Restore sky  - removes everything the bridge made and shows your own sky lights again.

Everything the bridge creates is tagged "HDRIForgeBridge" and removable in one click; nothing of yours is deleted.

Verified against Unreal Engine 5.8.4 (Python 3.11). Needs the Python Editor Script Plugin, Editor Scripting
Utilities and (for a visible background) the HDRI Backdrop plugin; without the last one a Sky Light is used.
"""

import inspect
import json
import math
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import unreal

# forge_link_core.py is the shared, DCC-agnostic half of the live link (discovery, background download, reconnect).
# It sits next to this file. Unreal keeps modules cached, so drop a stale copy or an update would never load.
try:
    _SELF = __file__
except NameError:
    _SELF = inspect.currentframe().f_code.co_filename
_HERE = os.path.dirname(os.path.abspath(_SELF))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
sys.modules.pop("forge_link_core", None)
try:
    import forge_link_core as _core
except ImportError:
    _core = None

VERSION = "1.0.0"
TAG = "HDRIForgeBridge"
CONTENT_DIR = "/Game/HDRIForge"
LIVE_KIND, IMPORT_KIND = "live", "import"
_LABELS = {LIVE_KIND: "HDRIForgeLive", IMPORT_KIND: "HDRIForgeImport"}
BACKDROP_CLASS = "/HDRIBackdrop/Blueprints/HDRIBackdrop.HDRIBackdrop_C"

# Same endpoints and port scheme as the Blender and Maya add-ons.
DEV_SERVER_URL = "http://localhost:5173/__hdri_bridge_push"
DESKTOP_APP_URL = "http://localhost:8973/__hdri_bridge_push"
CANDIDATES = [(DESKTOP_APP_URL, "Desktop App"), (DEV_SERVER_URL, "Dev Server")]
UNREAL_RECEIVE_PORT = 8977
CAMERAS_PATH = "/__hdri_bridge_cameras"
BRIDGE_PATH = "/__hdri_bridge_push"

# Orientation, derived from the engine's own long-lat -> cubemap code (TextureCompressorModule.cpp, LookupLongLat):
#   Unreal:  u = (1 + atan2(Wx, -Wy) / pi) / 2    -> the middle of the image faces Unreal's -Y, u grows to the viewer's right
#   Forge:   u = 0.5 at Forge's +X, which the camera conversion below maps to Unreal's +Y, u also grows to the right
# Neither is mirrored; they are the same picture seen from opposite sides, so the map is turned half a turn about Z.
FORGE_TO_UNREAL_YAW = 180.0

_live = {
    "link": None, "running": False, "renderer": "", "renderer_checked": 0.0,
    "slot": 0, "hidden": [], "last_status": None, "message": "Off",
}
_sky = {"exposure_ev": 0.0, "yaw": 0.0, "background": True}
_studio = {"url": None, "label": None}
_cam = {"snapshot": [], "wanted": threading.Event(), "ready": threading.Event(), "server": None, "thread": None}
_menu = {"built": False}
_jobs = queue.Queue()                  # work that must run on the editor's main thread, queued from other threads
_main = {"tick": None}


# ─── Small Unreal helpers ───────────────────────────────────────────────────
def _log(msg):
    unreal.log("[HDRI Forge Bridge] %s" % msg)


def _warn(msg):
    unreal.log_warning("[HDRI Forge Bridge] %s" % msg)


def _eas():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def _all_actors():
    return list(_eas().get_all_level_actors() or [])


def engine_version():
    """'5.8.4' from '5.8.4-58902052+++UE5+Release-5.8'."""
    try:
        return unreal.SystemLibrary.get_engine_version().split("-")[0]
    except Exception:
        return "5"


def renderer_label():
    """What is lighting the level: Lumen, screen-space GI, or no dynamic GI."""
    try:
        method = unreal.SystemLibrary.get_console_variable_int_value("r.DynamicGlobalIlluminationMethod")
    except Exception:
        return ""
    return {0: "No GI", 1: "Lumen", 2: "Screen Space GI", 3: "Plugin GI"}.get(method, "")


def client_name():
    """The name Forge shows for this app, e.g. 'Unreal 5.8.4 (Lumen)'."""
    gi = renderer_label()
    return "Unreal %s (%s)" % (engine_version(), gi) if gi else "Unreal %s" % engine_version()


def _has_tag(actor, tag):
    try:
        return any(str(t) == tag for t in (actor.tags or []))
    except Exception:
        return False


def _set_tags(actor, tags):
    actor.set_editor_property("tags", [unreal.Name(t) for t in tags])


def _bridge_actors(kind=None):
    out = []
    for a in _all_actors():
        for k in ((kind,) if kind else (LIVE_KIND, IMPORT_KIND)):
            if _has_tag(a, "%s:%s" % (TAG, k)):
                out.append((k, a))
                break
    return out


def _is_backdrop(actor):
    try:
        return "HDRIBackdrop" in actor.get_class().get_name()
    except Exception:
        return False


def _sky_light_component(actor):
    """The SkyLightComponent that lights the level for this bridge actor."""
    if _is_backdrop(actor):
        comps = actor.get_components_by_class(unreal.SkyLightComponent)
        return comps[0] if comps else None
    return actor.get_editor_property("light_component")


# ─── The actor the bridge owns ──────────────────────────────────────────────
def _spawn_actor(kind):
    """An HDRI Backdrop (visible background + lighting), or a plain Sky Light if that plug-in is not enabled."""
    eas = _eas()
    actor = None
    try:
        cls = unreal.load_class(None, BACKDROP_CLASS)
        if cls:
            actor = eas.spawn_actor_from_class(cls, unreal.Vector(0, 0, 0))
    except Exception:
        actor = None
    if actor is None:
        actor = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 200))
        if actor is not None:
            _warn("The HDRI Backdrop plug-in is not enabled, so only a Sky Light was created (lighting and "
                  "reflections, no visible background). Enable Edit > Plugins > HDRI Backdrop for the backdrop.")
    if actor is None:
        raise RuntimeError("could not spawn an HDRI Backdrop or Sky Light in the current level")
    actor.set_actor_label(_LABELS[kind])
    _set_tags(actor, [TAG, "%s:%s" % (TAG, kind)])
    return actor


def _bridge_actor(kind):
    """The actor we own for this kind, created on demand. Our own sky replaces the artist's while it is on."""
    existing = _bridge_actors(kind)
    if existing:
        return existing[0][1]
    actor = _spawn_actor(kind)
    _hide_artist_skies(actor)
    _apply_sky_settings(actor)
    return actor


def _hide_artist_skies(ours):
    """Two sky lights add up, so the artist's own are put out of the way while ours is on (and brought back after)."""
    for a in _all_actors():
        if a == ours or _has_tag(a, TAG):
            continue
        if isinstance(a, unreal.SkyLight) or _is_backdrop(a):
            try:
                if not a.is_temporarily_hidden_in_editor():
                    a.set_is_temporarily_hidden_in_editor(True)
                    _live["hidden"].append(a.get_path_name())
            except Exception:
                pass


def _show_artist_skies():
    if not _live["hidden"]:
        return
    by_path = {a.get_path_name(): a for a in _all_actors()}
    for path in _live["hidden"]:
        a = by_path.get(path)
        if a is not None:
            try:
                a.set_is_temporarily_hidden_in_editor(False)
            except Exception:
                pass
    _live["hidden"] = []


def _remove_bridge_actors(kind=None):
    for _k, actor in _bridge_actors(kind):
        try:
            _eas().destroy_actor(actor)
        except Exception as e:
            _warn("could not remove %s: %s" % (actor.get_name(), e))


# ─── Sky settings ───────────────────────────────────────────────────────────
def _apply_sky_settings(actor=None):
    """Exposure (EV) and turn-around, applied to every bridge actor (or just the one given)."""
    actors = [actor] if actor is not None else [a for _k, a in _bridge_actors()]
    for a in actors:
        yaw = FORGE_TO_UNREAL_YAW + _sky["yaw"]
        try:
            if _is_backdrop(a):
                a.set_editor_property("Intensity", 2.0 ** _sky["exposure_ev"])
                a.set_actor_rotation(unreal.Rotator(0.0, 0.0, yaw), False)
                mesh = a.get_component_by_class(unreal.StaticMeshComponent)
                if mesh is not None:
                    mesh.set_visibility(bool(_sky["background"]))
            else:
                comp = a.get_editor_property("light_component")
                comp.set_editor_property("intensity", 2.0 ** _sky["exposure_ev"])
                # SourceCubemapAngle samples the cube at a direction turned by +angle (ReflectionEnvironmentShaders.usf),
                # which shows the sky turned by -angle; yaw is the turn we want to see.
                comp.set_source_cubemap_angle(-yaw)
        except Exception as e:
            _warn("could not apply sky settings: %s" % e)


def set_sky(exposure_ev=None, yaw=None, background=None):
    """Exposure in EV (0 = as Forge made it), extra turn-around in degrees, background on/off."""
    if exposure_ev is not None:
        _sky["exposure_ev"] = float(exposure_ev)
    if yaw is not None:
        _sky["yaw"] = float(yaw)
    if background is not None:
        _sky["background"] = bool(background)
    _apply_sky_settings()


# ─── Importing a map ────────────────────────────────────────────────────────
def _import_hdr(path, dest_dir, name, save=False):
    """Import an equirect .hdr as a TextureCube (Unreal converts a 2:1 long-lat map itself). Returns the asset."""
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", dest_dir)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("replace_existing_settings", True)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", bool(save))
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths") or [])
    if not paths:
        raise RuntimeError("Unreal did not import %s" % os.path.basename(path))
    asset = unreal.load_asset(paths[0])
    if asset is None or not isinstance(asset, unreal.TextureCube):
        got = asset.get_class().get_name() if asset is not None else "nothing"
        raise RuntimeError("Unreal imported the map as %s, not a TextureCube (is it a 2:1 equirectangular .hdr?)" % got)
    return asset


def _show_cubemap(actor, cube):
    """Point the actor's lighting (and backdrop) at this cubemap and re-capture the sky."""
    if _is_backdrop(actor):
        actor.set_editor_property("Cubemap", cube)
    comp = _sky_light_component(actor)
    if comp is not None:
        if not _is_backdrop(actor):
            comp.set_editor_property("source_type", unreal.SkyLightSourceType.SLS_SPECIFIED_CUBEMAP)
            comp.set_editor_property("cubemap", cube)
        try:
            comp.recapture_sky()
        except Exception:
            pass


# ─── Live HDRI ──────────────────────────────────────────────────────────────
def _require_core():
    if _core is None:
        raise RuntimeError("forge_link_core.py is missing. Copy it next to hdri_forge_bridge_unreal.py (%s)." % _HERE)


def live_status():
    link = _live["link"]
    return link.status() if link is not None else {"state": "off", "message": "Off", "note": ""}


def _apply_frame(frame):
    """Main thread only: load the downloaded map into Unreal. Two slots alternate so the one on screen is never
    the one being re-imported."""
    slot = "A" if _live["slot"] == 0 else "B"
    _live["slot"] ^= 1
    cube = _import_hdr(frame.path, CONTENT_DIR + "/Live", "HDRIForgeLive_" + slot)
    actor = _bridge_actor(LIVE_KIND)
    _show_cubemap(actor, cube)


def _run_on_main(fn):
    """Queue `fn` to run on the editor's main thread (the only one allowed to touch assets and actors)."""
    _jobs.put(fn)


def _service_jobs():
    while True:
        try:
            fn = _jobs.get_nowait()
        except queue.Empty:
            return
        try:
            fn()
        except Exception as e:
            _warn("background job failed: %s" % e)


def _tick(_delta=0.0):
    """The one editor tick the bridge owns. Everything that must happen on the main thread is serviced from here."""
    _service_camera_requests()
    _service_jobs()
    _live_tick()


def _ensure_tick():
    if _main["tick"] is None:
        _main["tick"] = unreal.register_slate_post_tick_callback(_tick)


def _live_tick():
    link = _live["link"]
    if link is None or not _live["running"]:
        return
    try:
        now = time.time()
        if now - _live["renderer_checked"] > 1.0:               # the artist may change GI method at any time
            _live["renderer_checked"] = now
            label = client_name()
            if label != _live["renderer"]:
                _live["renderer"] = label
                if hasattr(link, "set_client_name"):
                    link.set_client_name(label)

        frame = link.take_frame()
        if frame is not None:
            try:
                _apply_frame(frame)
            except Exception as e:                               # never let a bad frame kill the tick
                _warn("could not apply frame: %s" % e)
                link._set(state=_core.ERROR, message=str(e))
            link.frame_applied(frame)

        st = link.status()
        key = (st["state"], st["message"], st["note"])
        if key != _live["last_status"]:
            _live["last_status"] = key
            _live["message"] = st["message"]
            _refresh_menu()
    except Exception as e:
        _warn("live tick failed: %s" % e)


def live_start(ports=None):
    _require_core()
    if _live["running"]:
        return
    _remove_bridge_actors(IMPORT_KIND)                           # an imported sky and the live one would add up
    kwargs = {"client_name": client_name()}
    if ports:
        kwargs["ports"] = ports
    link = _core.ForgeLink(**kwargs)
    _live["link"] = link
    _live["running"] = True
    _live["renderer"] = client_name()
    _live["renderer_checked"] = time.time()
    link.start()
    _ensure_tick()
    _refresh_menu()
    _log("Live HDRI on, looking for HDRI Forge Studio...")


def live_stop():
    _live["running"] = False
    link = _live["link"]
    if link is not None:
        link.stop()
        link.cleanup()
    _live["link"] = None
    _remove_bridge_actors(LIVE_KIND)
    _show_artist_skies()
    try:
        unreal.EditorAssetLibrary.delete_directory(CONTENT_DIR + "/Live")
    except Exception:
        pass
    _live["last_status"] = None
    _live["message"] = "Off"
    _refresh_menu()


def live_toggle():
    if _live["running"]:
        live_stop()
    else:
        try:
            live_start()
        except Exception as e:
            _warn(str(e))


# ─── Import (permanent) and restore ─────────────────────────────────────────
def import_hdri(ports=None, done=None):
    """Save Forge's current HDRI (and its .ash) next to the project and keep it as the level's sky.

    The download runs on a background thread (Unreal's main thread has a very small Python recursion budget, and a
    network call there would freeze the editor anyway); the import and the actor are done back on the main thread.
    `done(frame, error)` is called there when it finishes."""
    _require_core()
    if _live["running"]:
        live_stop()                                              # an imported dome replaces the live one
    _ensure_tick()
    dest = os.path.join(unreal.Paths.project_dir(), "HDRIForgeSource")
    kwargs = {"ports": ports} if ports else {}

    def finish(frame, error):
        if error is None:
            try:
                name = os.path.splitext(os.path.basename(frame.path))[0]
                cube = _import_hdr(frame.path, CONTENT_DIR + "/Imported", name, save=True)
                _remove_bridge_actors(IMPORT_KIND)
                actor = _bridge_actor(IMPORT_KIND)
                _show_cubemap(actor, cube)
                _log("Imported %s as %s/Imported/%s" % (frame.describe(), CONTENT_DIR, name))
            except Exception as e:
                error = e
        if error is not None:
            _warn("Import HDRI failed: %s" % error)
        if done is not None:
            done(frame if error is None else None, error)

    def work():
        try:
            frame = _core.fetch_latest(dest, name="forge_hdri", **kwargs)
        except Exception as e:
            _run_on_main(lambda: finish(None, e))
            return
        _run_on_main(lambda: finish(frame, None))

    _log("Importing the current HDRI from Forge...")
    threading.Thread(target=work, name="forge-import", daemon=True).start()


def restore_sky():
    """Stop everything the bridge is doing to the sky and show the artist's own sky lights again."""
    if _live["running"]:
        live_stop()
    _remove_bridge_actors()
    _show_artist_skies()
    _refresh_menu()


# ─── Cameras ────────────────────────────────────────────────────────────────
def _forge_vec(v):
    """Unreal (X forward, Y right, Z up, left-handed, cm) -> Forge/three (X right, Y up, -Z forward, right-handed)."""
    return (v.y, v.z, -v.x)


def rotation_to_euler_deg(right, up, forward):
    """Euler XYZ degrees (three.js order) for a camera whose Unreal basis vectors are given."""
    r = _forge_vec(right)
    u = _forge_vec(up)
    f = _forge_vec(forward)
    b = (-f[0], -f[1], -f[2])                                    # three cameras look down -Z, so +Z is "back"
    m11, m21, m31 = r
    m12, m22, m32 = u
    m13, m23, m33 = b
    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex = math.atan2(-m23, m33)
        ez = math.atan2(-m12, m11)
    else:
        ex = math.atan2(m32, m22)
        ez = 0.0
    return {"x": math.degrees(ex), "y": math.degrees(ey), "z": math.degrees(ez)}


def _vertical_fov_deg(cam_actor):
    """Forge wants the VERTICAL field of view."""
    try:
        comp = cam_actor.get_cine_camera_component() if isinstance(cam_actor, unreal.CineCameraActor) else None
        if comp is not None:
            fb = comp.get_editor_property("filmback")
            focal = float(comp.get_editor_property("current_focal_length"))
            sh = float(fb.get_editor_property("sensor_height"))
            if focal > 0 and sh > 0:
                return math.degrees(2.0 * math.atan(sh / (2.0 * focal)))
        comp = cam_actor.get_component_by_class(unreal.CameraComponent)
        h = math.radians(float(comp.get_editor_property("field_of_view")))
        aspect = float(comp.get_editor_property("aspect_ratio")) or (16.0 / 9.0)
        return math.degrees(2.0 * math.atan(math.tan(h / 2.0) / aspect))
    except Exception:
        return 40.0


def _camera_dict(cid, name, location, right, up, forward, vfov):
    s = 0.01                                                     # cm -> m
    p = _forge_vec(location)
    return {
        "id": cid, "name": name,
        "position": {"x": p[0] * s, "y": p[1] * s, "z": p[2] * s},
        "rotation": rotation_to_euler_deg(right, up, forward),
        "fov": vfov,
    }


def gather_cameras(only_id=None):
    """Cameras to send: the selected ones if any, else every camera in the level; plus the viewport. Main thread."""
    eas = _eas()
    cams = [a for a in (eas.get_selected_level_actors() or []) if isinstance(a, unreal.CameraActor)]
    if not cams:
        cams = [a for a in _all_actors() if isinstance(a, unreal.CameraActor)]
    out = []
    for a in cams:
        cid = a.get_path_name()
        if only_id and only_id not in (cid, a.get_actor_label()):
            continue
        out.append(_camera_dict(
            cid, a.get_actor_label(), a.get_actor_location(),
            a.get_actor_right_vector(), a.get_actor_up_vector(), a.get_actor_forward_vector(), _vertical_fov_deg(a)))
    if not only_id or only_id == "viewport":
        try:
            ok, loc, rot = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_level_viewport_camera_info()
            if ok:
                out.append(_camera_dict(
                    "viewport", "Editor Viewport", loc,
                    rot.get_right_vector(), rot.get_up_vector(), rot.get_forward_vector(), 60.0))
        except Exception:
            pass
    return out


def _service_camera_requests():
    """Forge pulls cameras over HTTP from a background thread; the actual reading happens here, on the main thread."""
    if _cam["wanted"].is_set():
        _cam["wanted"].clear()
        try:
            _cam["snapshot"] = gather_cameras()
        except Exception as e:
            _warn("could not read cameras: %s" % e)
            _cam["snapshot"] = []
        _cam["ready"].set()


class _BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, *_a):
        pass

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        if parsed.path == BRIDGE_PATH:
            self._send_json(200, {"ok": True, "app": "Unreal Engine", "mode": "unreal"})
        elif parsed.path == CAMERAS_PATH:
            only = parse_qs(parsed.query).get("id", [None])[0]
            _cam["ready"].clear()
            _cam["wanted"].set()
            if not _cam["ready"].wait(4.0):
                self._send_json(503, {"ok": False, "error": "Unreal is busy; try again in a moment."})
                return
            cams = [c for c in _cam["snapshot"] if not only or c["id"] == only or c["name"] == only]
            self._send_json(200, {"ok": True, "app": "Unreal Engine", "source": "unreal", "cameras": cams})
        else:
            self.send_response(404)
            self.end_headers()


def _start_listener():
    if _cam["server"] is not None:
        return
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", UNREAL_RECEIVE_PORT), _BridgeHandler)
    except OSError as e:
        _warn("could not listen on port %d for Forge's camera import: %s" % (UNREAL_RECEIVE_PORT, e))
        return
    t = threading.Thread(target=httpd.serve_forever, name="forge-unreal-cameras", daemon=True)
    t.start()
    _cam["server"], _cam["thread"] = httpd, t
    _ensure_tick()           # camera requests are answered from the editor's main thread, even when Live is off


def _stop_listener():
    httpd = _cam["server"]
    if httpd is not None:
        httpd.shutdown()
        httpd.server_close()
    _cam["server"] = None
    _cam["thread"] = None


def probe_studio():
    for url, label in CANDIDATES:
        try:
            with urllib.request.urlopen(url, timeout=0.35) as resp:
                if resp.status == 200:
                    _studio["url"], _studio["label"] = url, label
                    return True
        except Exception:
            continue
    _studio["url"] = _studio["label"] = None
    return False


def push_cameras_to_studio():
    """Send the level's cameras to HDRI Forge Studio. The cameras are read here, the network call runs off-thread."""
    cams = gather_cameras()
    if not cams:
        _warn("no cameras in the level (add a Cine Camera Actor, or select the ones to send)")
        return 0

    def send():
        if not probe_studio():
            _warn("no HDRI Forge Studio found running - open the app or start the dev server")
            return
        try:
            data = json.dumps({"source": "unreal", "cameras": cams}).encode("utf-8")
            req = urllib.request.Request(_studio["url"], data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
            _log("Pushed %d camera(s) to %s" % (len(cams), _studio["label"]))
        except Exception as e:
            _warn("Studio unreachable: %s" % e)

    threading.Thread(target=send, name="forge-push-cameras", daemon=True).start()
    return len(cams)


# ─── Menu ───────────────────────────────────────────────────────────────────
def _py(cmd):
    return "import hdri_forge_bridge_unreal as b; " + cmd


def _refresh_menu():
    try:
        _build_menu(force=True)
    except Exception:
        pass


def _build_menu(force=False):
    if _menu["built"] and not force:
        return
    menus = unreal.ToolMenus.get()
    main = menus.find_menu("LevelEditor.MainMenu")
    if main is None:
        return
    sub = menus.find_menu("LevelEditor.MainMenu.HDRIForgeBridge")
    if sub is None:
        sub = main.add_sub_menu("HDRIForgeBridge", "", "HDRIForgeBridge", "HDRI Forge")
    on = _live["running"]
    status = _live["message"] if on else "Off"
    items = [
        ("Live", ("Stop live HDRI" if on else "Start live HDRI") , "live_toggle()"),
        ("Status", "Live: %s" % status, "print(b.live_status())"),
        ("Import", "Import HDRI (keep this map)", "import_hdri()"),
        ("Restore", "Restore my sky", "restore_sky()"),
        ("Cameras", "Push cameras to Forge", "push_cameras_to_studio()"),
    ]
    for name, label, cmd in items:
        entry = unreal.ToolMenuEntry(name=name, type=unreal.MultiBlockType.MENU_ENTRY)
        entry.set_label(label)
        entry.set_string_command(unreal.ToolMenuStringCommandType.PYTHON, "", _py("b." + cmd if not cmd.startswith("print") else cmd))
        sub.add_menu_entry("HDRIForge", entry)
    menus.refresh_all_widgets()
    _menu["built"] = True


def startup():
    """Called once when the editor starts (init_unreal.py)."""
    try:
        _build_menu()
    except Exception as e:
        _warn("could not build the HDRI Forge menu: %s" % e)
    _start_listener()
    _log("HDRI Forge Bridge %s ready (%s)" % (VERSION, client_name()))


def shutdown():
    live_stop()
    _stop_listener()
    if _main["tick"] is not None:
        try:
            unreal.unregister_slate_post_tick_callback(_main["tick"])
        except Exception:
            pass
        _main["tick"] = None
