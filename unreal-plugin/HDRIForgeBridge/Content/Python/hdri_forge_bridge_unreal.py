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

import base64
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

VERSION = "1.5.0"
TAG = "HDRIForgeBridge"
CONTENT_DIR = "/Game/HDRIForge"
LIVE_KIND, IMPORT_KIND = "live", "import"
_LABELS = {LIVE_KIND: "HDRIForgeLive", IMPORT_KIND: "HDRIForgeImport"}
BACKDROP_CLASS = "/HDRIBackdrop/Blueprints/HDRIBackdrop.HDRIBackdrop_C"

# Same endpoints and port scheme as the Blender and Maya add-ons.
DEV_SERVER_URL = "http://localhost:5173/__hdri_bridge_push"
DESKTOP_APP_URL = "http://localhost:8973/__hdri_bridge_push"
CANDIDATES = [(DESKTOP_APP_URL, "Desktop App"), (DEV_SERVER_URL, "Dev Server")]
UNREAL_RECEIVE_PORT = int(os.environ.get("FORGE_UNREAL_PORT", "8977"))   # the port Forge pulls cameras from; Forge expects 8977
CAMERAS_PATH = "/__hdri_bridge_cameras"
BRIDGE_PATH = "/__hdri_bridge_push"

# Orientation, derived from the engine's own long-lat -> cubemap code (TextureCompressorModule.cpp, LookupLongLat):
#   Unreal:  u = (1 + atan2(Wx, -Wy) / pi) / 2    -> the middle of the image faces Unreal's -Y, u grows to the viewer's right
#   Forge:   u = 0.5 at Forge's +X, which the camera conversion below maps to Unreal's +Y, u also grows to the right
# Neither is mirrored; they are the same picture seen from opposite sides, so the map is turned half a turn about Z.
FORGE_TO_UNREAL_YAW = 180.0

_live = {
    "isolated": [], "override": [], "note": "", "link": None, "running": False, "renderer": "", "renderer_checked": 0.0,
    "slot": 0, "hidden": [], "last_status": None, "message": "Off",
}
_sky = {"exposure_ev": 0.0, "yaw": 0.0, "background": True}
_studio = {"url": None, "label": None}
_cam = {"snapshot": [], "wanted": threading.Event(), "ready": threading.Event(), "server": None, "thread": None}
_menu = {"built": False, "toolbar": None, "toolbar_menu": None}
_settle = {"until": 0.0, "next": 0.0}   # after a new map: re-capture the sky a few times so late texture builds still show
_settings = {"auto_start": True, "override_lighting": True, "auto_exposure": True}       # remembered per project in Saved/HDRIForgeBridge.json
_auto = {"at": None, "done": False}    # when to start Live on its own after the editor opens
_jobs = queue.Queue()                  # work that must run on the editor's main thread, queued from other threads
_main = {"tick": None}


# ─── Settings (remembered per project) ──────────────────────────────────────
def _settings_path():
    return os.path.join(unreal.Paths.project_saved_dir(), "HDRIForgeBridge.json")


def _load_settings():
    try:
        with open(_settings_path(), "r", encoding="utf-8") as f:
            _settings.update(json.load(f))
    except Exception:
        pass                                     # first run, or an unreadable file: keep the defaults


def _save_settings():
    try:
        os.makedirs(os.path.dirname(_settings_path()), exist_ok=True)
        with open(_settings_path(), "w", encoding="utf-8") as f:
            json.dump(_settings, f)
    except Exception as e:
        _warn("could not save settings: %s" % e)


def set_auto_start(on):
    """Start Live by itself every time this project opens (on by default). Takes effect from the next editor start."""
    _settings["auto_start"] = bool(on)
    _save_settings()
    _log("Auto-start live is %s" % ("ON: it starts by itself whenever this project opens" if on else "OFF: use the Forge Live button"))
    _refresh_menu()


def _auto_start_now():
    """Start Live if the setting says so, and it is not already running."""
    _auto["done"] = True
    if not _live["running"]:
        _restore_scene_lighting()          # a crashed session may have left the scene's lights off
    if _settings.get("auto_start") and not _live["running"]:
        try:
            live_start()
        except Exception as e:
            _warn("could not start Live automatically: %s" % e)


# ─── Small Unreal helpers ───────────────────────────────────────────────────
def _log(msg):
    unreal.log("[HDRI Forge Bridge] %s" % msg)


def _warn(msg):
    unreal.log_warning("[HDRI Forge Bridge] %s" % msg)


def _console(cmd):
    try:
        unreal.SystemLibrary.execute_console_command(None, cmd)
    except Exception:
        pass


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


# ─── Forge's HDRI replaces the scene's own lighting while Live is on ─────────
# Forge's lights are painted INTO the HDRI, so Unreal's own lights on top of it would give a different picture from Forge's.
# While Live is on, every other light in the level is switched off and a post-process volume lets the exposure adapt to the
# HDRI-only lighting. Both are undone when Live stops, and the original states are written to disk first so a crash cannot
# leave a saved level with its lights off (they are put back the next time the project opens).
def _backup_path():
    return os.path.join(unreal.Paths.project_saved_dir(), "HDRIForgeLightsBackup.json")


def _scene_light_components():
    """(actor path, component name, component) for every light component that is not the bridge's own."""
    out = []
    for a in _all_actors():
        if _has_tag(a, TAG) or _is_backdrop(a):
            continue
        try:
            for comp in a.get_components_by_class(unreal.LightComponent):
                out.append((a.get_path_name(), comp.get_name(), comp))
        except Exception:
            continue
    return out


def _override_scene_lighting():
    if not _settings.get("override_lighting") or _live["override"]:
        return
    entries = []
    for apath, cname, comp in _scene_light_components():
        try:
            was = bool(comp.is_visible())
            if was:
                entries.append({"actor": apath, "component": cname, "was_visible": True})
                comp.set_visibility(False)
        except Exception as e:
            _warn("could not switch off light %s: %s" % (cname, e))
    _live["override"] = entries
    try:
        os.makedirs(os.path.dirname(_backup_path()), exist_ok=True)
        with open(_backup_path(), "w", encoding="utf-8") as f:
            json.dump(entries, f)
    except Exception as e:
        _warn("could not write the lights backup: %s" % e)
    if entries:
        _log("Forge's HDRI now lights the level: %d of this scene's own lights are switched off while Live is on" % len(entries))
    if _settings.get("auto_exposure"):
        _ensure_exposure_volume()
    _redraw()


def _restore_scene_lighting():
    """Switch back on every light the override switched off (also leftovers from an earlier session that crashed)."""
    entries = list(_live["override"])
    if not entries:
        try:
            with open(_backup_path(), "r", encoding="utf-8") as f:
                entries = json.load(f)
        except Exception:
            entries = []
    if entries:
        comps = {(a, c): comp for a, c, comp in _scene_light_components()}
        for e in entries:
            comp = comps.get((e["actor"], e["component"]))
            if comp is not None:
                try:
                    comp.set_visibility(bool(e.get("was_visible", True)))
                except Exception:
                    pass
    _live["override"] = []
    try:
        if os.path.exists(_backup_path()):
            os.remove(_backup_path())
    except Exception:
        pass
    _remove_exposure_volume()
    _redraw()


def _exposure_volume():
    for a in _all_actors():
        if _has_tag(a, "%s:exposure" % TAG):
            return a
    return None


def _ensure_exposure_volume():
    """An unbound post-process volume, above the scene's own, that lets the exposure adapt to HDRI-only lighting."""
    if _exposure_volume() is not None:
        return
    try:
        vol = _eas().spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
        vol.set_actor_label("HDRIForgeExposure")
        _set_tags(vol, [TAG, "%s:exposure" % TAG])
        vol.set_editor_property("unbound", True)
        vol.set_editor_property("priority", 1000.0)
        st = vol.get_editor_property("settings")
        st.set_editor_property("override_auto_exposure_method", True)
        st.set_editor_property("auto_exposure_method", unreal.AutoExposureMethod.AEM_HISTOGRAM)
        st.set_editor_property("override_auto_exposure_bias", True)
        st.set_editor_property("auto_exposure_bias", 0.0)
        vol.set_editor_property("settings", st)
    except Exception as e:
        _warn("could not create the exposure volume: %s" % e)


def _remove_exposure_volume():
    v = _exposure_volume()
    if v is not None:
        try:
            _eas().destroy_actor(v)
        except Exception:
            pass


def isolate_selection():
    """Show ONLY the selected objects (plus the bridge's own sky): every other mesh actor, such as a studio room or cyclorama
    that would block the HDRI, is hidden in the editor. Undo with restore_isolation(). Hidden-in-editor is not saved with the level."""
    eas = _eas()
    keep = {a.get_path_name() for a in (eas.get_selected_level_actors() or [])}
    if not keep:
        _warn("select the objects to keep first (for example the car), then isolate")
        _live["note"] = "Isolate: select the objects to keep first"
        return 0
    hidden = []
    for a in _all_actors():
        if a.get_path_name() in keep or _has_tag(a, TAG) or _is_backdrop(a):
            continue
        try:
            if a.get_components_by_class(unreal.MeshComponent) and not a.is_temporarily_hidden_in_editor():
                a.set_is_temporarily_hidden_in_editor(True)
                hidden.append(a.get_path_name())
        except Exception:
            continue
    _live["isolated"] = hidden
    _live["note"] = "Isolated %d selected object(s); %d other mesh actors hidden" % (len(keep), len(hidden))
    _log(_live["note"])
    _redraw()
    _refresh_menu()
    return len(hidden)


def restore_isolation():
    by_path = {a.get_path_name(): a for a in _all_actors()}
    for path in _live["isolated"]:
        a = by_path.get(path)
        if a is not None:
            try:
                a.set_is_temporarily_hidden_in_editor(False)
            except Exception:
                pass
    n = len(_live["isolated"])
    _live["isolated"] = []
    _live["note"] = "Showing everything again (%d actor(s) un-hidden)" % n
    _redraw()
    _refresh_menu()
    return n


def toggle_isolation():
    return restore_isolation() if _live["isolated"] else isolate_selection()


def set_override_lighting(on):
    """Whether Forge's HDRI replaces the scene's own lights while Live is on (on by default)."""
    _settings["override_lighting"] = bool(on)
    _save_settings()
    if _live["running"]:
        if on:
            _override_scene_lighting()
        else:
            _restore_scene_lighting()
    _log("Forge overrides the scene's own lighting: %s" % ("ON" if on else "OFF"))
    _refresh_menu()


def set_auto_exposure(on):
    _settings["auto_exposure"] = bool(on)
    _save_settings()
    if _live["running"] and _live["override"] is not None and _settings.get("override_lighting"):
        _ensure_exposure_volume() if on else _remove_exposure_volume()
    _refresh_menu()


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
def _import_hdr(path, dest_dir, name, save=False, live=False):
    """Import an equirect .hdr as a TextureCube (Unreal converts a 2:1 long-lat map itself). Returns the asset.

    `live` maps are built uncompressed (RGBA16F): Unreal's default BC6H encode of a 2048x1024 map takes seconds and runs
    in the background, so a recapture right after the import saw the OLD sky and nothing told the viewport to redraw."""
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
    if live:
        try:
            asset.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_HDR)
        except Exception as e:
            _warn("could not build the live map uncompressed (it will still work, only slower): %s" % e)
    return asset


def _redraw():
    """The editor viewport only redraws when something invalidates it; a new sky is not such a thing on its own."""
    try:
        unreal.EditorLevelLibrary.editor_invalidate_viewports()
    except Exception:
        try:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_invalidate_viewports()
        except Exception:
            pass


def _recapture_all():
    for _k, a in _bridge_actors():
        comp = _sky_light_component(a)
        if comp is not None:
            try:
                comp.recapture_sky()
            except Exception:
                pass
    _redraw()


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
    _redraw()
    _settle["until"] = time.time() + 2.5           # keep re-capturing for a moment in case the texture finishes late
    _settle["next"] = time.time() + 0.3


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
    cube = _import_hdr(frame.path, CONTENT_DIR + "/Live", "HDRIForgeLive_" + slot, live=True)
    actor = _bridge_actor(LIVE_KIND)
    _show_cubemap(actor, cube)
    if _settings.get("override_lighting") and not _live["override"]:
        _override_scene_lighting()                               # the first map is on screen: now take the scene's own lights away


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
    now = time.time()
    if _live.get("note") != _menu.get("note_shown"):          # a send finished (it runs off-thread): show its outcome in the menu
        _menu["note_shown"] = _live.get("note")
        _refresh_menu()
    if now < _settle["until"] and now >= _settle["next"]:
        _settle["next"] = now + 0.3
        _recapture_all()
    if not _auto["done"] and _auto["at"] is not None and time.time() >= _auto["at"]:
        _auto_start_now()                      # a few seconds after the editor opened, once the level exists
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
    _restore_scene_lighting()                                    # lights a crashed earlier session left switched off
    _remove_bridge_actors()                                      # a leftover from a saved level, or an imported sky: they would add up
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
    _console("Editor.AsyncTextureCompilation 0")                  # build each new map right away, so the sky is ready when captured
    _refresh_menu()
    _log("Live HDRI on, looking for HDRI Forge Studio...")


def live_stop():
    _live["running"] = False
    _console("Editor.AsyncTextureCompilation 1")                 # back to Unreal's normal background builds
    link = _live["link"]
    if link is not None:
        link.stop()
        link.cleanup()
    _live["link"] = None
    _remove_bridge_actors(LIVE_KIND)
    _show_artist_skies()
    _restore_scene_lighting()
    if _live["isolated"]:
        restore_isolation()
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


def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# Unreal's light units differ from Forge's 0-1000 brightness; these factors land a default light about where Forge's own
# defaults sit. They are a starting point: Forge's brightness is a slider, adjust it there.
ENERGY_PER_CANDELA = 12.0
ENERGY_PER_LUX = 20.0


def gather_lights(only_selected=False):
    """Point, spot, directional and rect lights of the level (or just the selected ones), in Forge's light format."""
    eas = _eas()
    pool = list(eas.get_selected_level_actors() or []) if only_selected else _all_actors()
    kinds = (
        (unreal.DirectionalLight, "SUN", ENERGY_PER_LUX),
        (unreal.SpotLight, "SPOT", ENERGY_PER_CANDELA),
        (unreal.RectLight, "AREA", ENERGY_PER_CANDELA),
        (unreal.PointLight, "POINT", ENERGY_PER_CANDELA),
    )
    out = []
    for a in pool:
        for cls, kind, factor in kinds:
            if isinstance(a, cls):
                break
        else:
            continue
        try:
            comp = a.get_component_by_class(unreal.LightComponent)
            col = comp.get_editor_property("light_color")
            entry = {
                "id": a.get_path_name(), "name": a.get_actor_label(), "type": kind,
                "color": {"r": _srgb_to_linear(col.r), "g": _srgb_to_linear(col.g), "b": _srgb_to_linear(col.b)},
                "energy": min(1000.0, float(comp.get_editor_property("intensity")) * factor),
            }
            cam = _camera_dict(a.get_path_name(), a.get_actor_label(), a.get_actor_location(),
                               a.get_actor_right_vector(), a.get_actor_up_vector(), a.get_actor_forward_vector(), 40.0)
            entry["position"], entry["rotation"] = cam["position"], cam["rotation"]
            if kind == "SPOT":
                entry["spot_size"] = math.radians(2.0 * float(comp.get_editor_property("outer_cone_angle")))
            if kind == "AREA":
                entry["size"] = float(comp.get_editor_property("source_width")) * 0.01
                entry["size_y"] = float(comp.get_editor_property("source_height")) * 0.01
            out.append(entry)
        except Exception as e:
            _warn("skipped light %s: %s" % (a.get_actor_label(), e))
    return out


def export_meshes():
    """The selected static-mesh actors as one .glb (Unreal's own glTF exporter), in Forge's mesh format, or None."""
    eas = _eas()
    actors = [a for a in (eas.get_selected_level_actors() or []) if isinstance(a, unreal.StaticMeshActor)]
    if not actors:
        return None
    path = os.path.join(unreal.Paths.project_saved_dir(), "HDRIForgeSource", "scene_to_forge.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    options = unreal.GLTFExportOptions()
    ok = unreal.GLTFExporter.export_to_gltf(unreal.EditorLevelLibrary.get_editor_world(), path, options, set(actors))
    if not ok or not os.path.exists(path):
        raise RuntimeError("Unreal's glTF exporter could not export the selection")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return {"fileName": "scene_to_forge.glb", "dataBase64": data, "format": "glb",
            "objectNames": [a.get_actor_label() for a in actors]}


def _post_to_studio(payload, what):
    if not probe_studio():
        _warn("no HDRI Forge Studio found running - open the app or start the dev server")
        _live["note"] = "Send failed: Forge not running"
        return
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(_studio["url"], data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
        _log("Sent %s to %s" % (what, _studio["label"]))
        _live["note"] = "Sent %s to Forge" % what
    except Exception as e:
        _warn("Studio unreachable: %s" % e)
        _live["note"] = "Send failed: %s" % e


def push_to_studio(cameras=True, lights=True, meshes=True, only_selected_lights=False):
    """Send the scene to HDRI Forge Studio: cameras, lights and the selected meshes. Read here (the main thread), sent off-thread."""
    payload = {"source": "unreal"}
    parts = []
    if cameras:
        cams = gather_cameras()
        if cams:
            payload["cameras"] = cams
            parts.append("%d camera(s)" % len(cams))
    if lights:
        lts = gather_lights(only_selected_lights)
        if lts:
            payload["lights"] = lts
            parts.append("%d light(s)" % len(lts))
    if meshes:
        try:
            mesh = export_meshes()
        except Exception as e:
            _warn("mesh export failed: %s" % e)
            mesh = None
        if mesh:
            payload["mesh"] = mesh
            parts.append("%d mesh object(s)" % len(mesh["objectNames"]))
    if len(payload) == 1:
        _warn("nothing to send: the level has no cameras or lights and no static mesh is selected")
        return None
    what = ", ".join(parts)
    threading.Thread(target=_post_to_studio, args=(payload, what), name="forge-send", daemon=True).start()
    return payload


def push_cameras_to_studio():
    return push_to_studio(cameras=True, lights=False, meshes=False)


# ─── Controls: one organised section, in the toolbar and in the menu bar ─────
def _py(cmd):
    return "import hdri_forge_bridge_unreal as b; " + cmd


def adjust_exposure(delta_ev):
    set_sky(exposure_ev=_sky["exposure_ev"] + delta_ev)
    _refresh_menu()


def adjust_yaw(delta_deg):
    set_sky(yaw=(_sky["yaw"] + delta_deg) % 360.0)
    _refresh_menu()


def reset_sky():
    set_sky(exposure_ev=0.0, yaw=0.0, background=True)
    _refresh_menu()


def toggle_background():
    set_sky(background=not _sky["background"])
    _refresh_menu()


def _box(on):
    return "[x]" if on else "[  ]"


def _connection_label():
    if not _live["running"]:
        return "Not connected. Start the live preview to link to HDRI Forge Studio"
    st = live_status()
    msg = st.get("message", "")
    port = st.get("port")
    where = " (%s, port %s)" % (st.get("mode"), port) if port else ""
    return "%s%s" % (msg, where)


def control_layout():
    """The whole control section as data: (section id, heading, [(entry name, label, command)])."""
    on = _live["running"]
    note = _live.get("note")
    sections = [
        ("HFStatus", "Connection", [
            ("Status", _connection_label(), "print(b.live_status())"),
        ] + ([("Note", note, "print(b._live.get('note'))")] if note else [])),
        ("HFLive", "Live preview", [
            ("Live", "Stop live preview" if on else "Start live preview  (Forge starts streaming by itself)", "live_toggle()"),
            ("Auto", "%s Start automatically whenever this project opens" % _box(_settings.get("auto_start")), "set_auto_start(not b._settings['auto_start'])"),
            ("Ovr", "%s Forge's HDRI replaces this scene's own lights while live" % _box(_settings.get("override_lighting")), "set_override_lighting(not b._settings['override_lighting'])"),
            ("AE", "%s Let the exposure adapt to the HDRI lighting" % _box(_settings.get("auto_exposure")), "set_auto_exposure(not b._settings['auto_exposure'])"),
            ("Iso", ("Show everything again (un-hide the studio)" if _live["isolated"] else "Isolate the selected objects (hide the studio room that blocks the HDRI)"), "toggle_isolation()"),
            ("Bg", "%s Show the HDRI as the level background" % _box(_sky["background"]), "toggle_background()"),
            ("ExpUp", "Brighter  (+0.5 EV)   now %+.1f EV" % _sky["exposure_ev"], "adjust_exposure(0.5)"),
            ("ExpDn", "Darker  (-0.5 EV)", "adjust_exposure(-0.5)"),
            ("YawR", "Turn the sky  +15 degrees   now %d" % round(_sky["yaw"]), "adjust_yaw(15)"),
            ("YawL", "Turn the sky  -15 degrees", "adjust_yaw(-15)"),
            ("Reset", "Reset exposure, turn and background", "reset_sky()"),
        ]),
        ("HFImport", "Import into the level", [
            ("Import", "Import HDRI (keep this map as a saved asset)", "import_hdri()"),
            ("Restore", "Restore my own sky (remove everything the bridge made)", "restore_sky()"),
        ]),
        ("HFSend", "Send this scene to Forge", [
            ("All", "Everything: cameras + lights + selected meshes", "push_to_studio()"),
            ("Cams", "Cameras (selected, else all) + the editor view", "push_to_studio(lights=False, meshes=False)"),
            ("Lights", "Lights (point, spot, directional, rect)", "push_to_studio(cameras=False, meshes=False)"),
            ("Meshes", "Selected static meshes", "push_to_studio(cameras=False, lights=False)"),
        ]),
        ("HFAbout", "About", [
            ("About", "HDRI Forge Bridge %s  |  %s" % (VERSION, client_name()), "print('HDRI Forge Bridge', b.VERSION)"),
        ]),
    ]
    return sections


def _populate(menu):
    for sec, heading, items in control_layout():
        menu.add_section(sec, heading)
        for name, label, cmd in items:
            entry = unreal.ToolMenuEntry(name="HFB_%s_%s" % (sec, name), type=unreal.MultiBlockType.MENU_ENTRY)
            entry.set_label(label)
            entry.set_string_command(unreal.ToolMenuStringCommandType.PYTHON, "", _py(cmd if cmd.startswith("print") else "b." + cmd))
            menu.add_menu_entry(sec, entry)


def _refresh_menu():
    try:
        _build_menu(force=True)
    except Exception:
        pass


# Where the HDRI Forge control goes: the level editor's main toolbar, with the first of these that exists.
TOOLBAR_CANDIDATES = ("LevelEditor.LevelEditorToolBar.User", "LevelEditor.LevelEditorToolBar.PlayToolBar",
                      "LevelEditor.LevelEditorToolBar")


def _build_toolbar():
    """ONE drop-down button in the toolbar, 'HDRI Forge', holding the whole organised control section."""
    menus = unreal.ToolMenus.get()
    for name in TOOLBAR_CANDIDATES:
        bar = menus.find_menu(name)
        if bar is None:
            continue
        sub_name = name + ".HDRIForgeControls"
        sub = menus.find_menu(sub_name)
        if sub is None:
            bar.add_section("HDRIForge")
            sub = bar.add_sub_menu("HDRIForgeBridge", "HDRIForge", "HDRIForgeControls", "HDRI Forge",
                                   "Live preview, import and send-to-Forge controls for HDRI Forge Studio")
        _populate(sub)
        _menu["toolbar"] = name
        _menu["toolbar_menu"] = sub_name
        return name
    return None


def _build_menu(force=False):
    if _menu["built"] and not force:
        return
    menus = unreal.ToolMenus.get()
    main = menus.find_menu("LevelEditor.MainMenu")
    if main is None:
        return
    _build_toolbar()
    sub = menus.find_menu("LevelEditor.MainMenu.HDRIForgeBridge")
    if sub is None:
        sub = main.add_sub_menu("HDRIForgeBridge", "", "HDRIForgeBridge", "HDRI Forge")
    _populate(sub)
    menus.refresh_all_widgets()
    _menu["built"] = True


def startup():
    """Called once when the editor starts (init_unreal.py)."""
    _load_settings()
    try:
        _build_menu()
    except Exception as e:
        _warn("could not build the HDRI Forge menu: %s" % e)
    _start_listener()
    if _settings.get("auto_start"):
        _auto["at"] = time.time() + 5.0
        _ensure_tick()
    _log("HDRI Forge Bridge %s ready (%s, auto-start %s)" % (VERSION, client_name(), "on" if _settings.get("auto_start") else "off"))


def shutdown():
    live_stop()
    _stop_listener()
    if _main["tick"] is not None:
        try:
            unreal.unregister_slate_post_tick_callback(_main["tick"])
        except Exception:
            pass
        _main["tick"] = None
