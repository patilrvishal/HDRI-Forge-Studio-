"""
HDRI Forge Bridge for Autodesk Maya
-------------------------------------
Push selected Maya lights, the active camera, selected mesh objects, and the
scene's Arnold sky dome HDRI to HDRI Forge Studio in real time - the
Maya-side counterpart to the Blender addon of the same name
(blender-addon/hdri_forge_bridge.py). Both send the exact same JSON shape to
the exact same endpoint, so the Studio side needs no per-DCC special-casing
beyond the mesh `format` field (Maya has no native glTF exporter, so it
sends OBJ instead of Blender's GLB).

World/HDRI push currently supports Arnold only: it looks for a scene
aiSkyDomeLight with a file texture connected to its Color input. Other
renderers (V-Ray, Redshift) are not read.

A second, direct Blender <-> Maya bridge (the "Blender" tab) bypasses the
Studio entirely: this plugin runs its own tiny HTTP listener so Blender can
push straight into the live Maya scene, and a "Push to Blender" button does
the reverse. See blender-addon/hdri_forge_bridge.py for the Blender side.

Install: Windows > Settings/Preferences > Plug-in Manager > Browse, select
this file, and check "Loaded" (and "Auto load" to keep it enabled). A
"HDRI Forge Bridge" menu appears in Maya's main menu bar.
"""

import math
import json
import base64
import tempfile
import os
import time
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

import maya.cmds as cmds
import maya.api.OpenMaya as om2
import maya.utils


def maya_useNewAPI():
    pass


PLUGIN_NAME = "HDRI Forge Bridge"
MENU_NAME = "hdriForgeBridgeMenu"
WINDOW_NAME = "hdriForgeBridgeWindow"

# Same two endpoints, same port numbers, as the Blender addon - the desktop
# app and the dev server can each run their own bridge without colliding.
DEV_SERVER_URL = "http://localhost:5173/__hdri_bridge_push"
DESKTOP_APP_URL = "http://localhost:8973/__hdri_bridge_push"
CANDIDATES = [
    (DESKTOP_APP_URL, "Desktop App"),
    (DEV_SERVER_URL, "Dev Server"),
]

# Direct Blender <-> Maya bridge (bypasses the Studio). Blender listens on
# BLENDER_RECEIVE_PORT, Maya listens on MAYA_RECEIVE_PORT - distinct from
# the Studio's ports so all three can run at once without colliding.
BLENDER_RECEIVE_PORT = 8975
MAYA_RECEIVE_PORT = 8976
BLENDER_DIRECT_URL = f"http://localhost:{BLENDER_RECEIVE_PORT}/__hdri_bridge_push"
BRIDGE_PATH = "/__hdri_bridge_push"

_state = {"url": None, "label": None}
_direct_state = {"blender_connected": False, "last_received": None}
_ui = {
    "status_text": None, "count_text": None,
    "blender_status_text": None, "blender_count_text": None, "blender_last_text": None,
}


# ─── Auto-detect ────────────────────────────────────────────────────────────
def _probe_one(url, timeout=0.35):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def probe_studio():
    for url, label in CANDIDATES:
        if _probe_one(url):
            _state["url"] = url
            _state["label"] = label
            return True
    _state["url"] = None
    _state["label"] = None
    return False


def probe_blender():
    _direct_state["blender_connected"] = _probe_one(BLENDER_DIRECT_URL)
    return _direct_state["blender_connected"]


# ─── Rotation: world quaternion (via Maya's own decomposition) -> Euler XYZ deg
# matching Three.js's Euler.setFromRotationMatrix('XYZ') exactly ────────────
def _world_quaternion(dag_path):
    """Maya's own MTransformationMatrix decomposition - not hand-parsed
    matrix math - so scale/shear on the node or its parents can't throw off
    the extracted rotation."""
    world_matrix = dag_path.inclusiveMatrix()
    t_matrix = om2.MTransformationMatrix(world_matrix)
    return t_matrix.rotation(asQuaternion=True)  # MQuaternion: x, y, z, w


def quat_to_euler_deg(q):
    x, y, z, w = q.x, q.y, q.z, q.w
    # Standard right-handed quaternion -> 3x3 rotation matrix. Maya's world
    # space is Y-up like Three.js, so - unlike the Blender addon - no axis
    # conversion is needed here; this matrix is used directly.
    m13 = 2 * (x * z + w * y)
    m23 = 2 * (y * z - w * x)
    m33 = 1 - 2 * (x * x + y * y)
    m11 = 1 - 2 * (y * y + z * z)
    m12 = 2 * (x * y - w * z)
    m32 = 2 * (y * z + w * x)
    m22 = 1 - 2 * (x * x + z * z)

    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex = math.atan2(-m23, m33)
        ez = math.atan2(-m12, m11)
    else:
        ex = math.atan2(m32, m22)
        ez = 0.0

    return {
        'x': round(math.degrees(ex), 4),
        'y': round(math.degrees(ey), 4),
        'z': round(math.degrees(ez), 4),
    }


def _dag_path_for(node_name):
    sel = om2.MSelectionList()
    sel.add(node_name)
    return sel.getDagPath(0)


def _world_translation(dag_path):
    world_matrix = dag_path.inclusiveMatrix()
    t_matrix = om2.MTransformationMatrix(world_matrix)
    v = t_matrix.translation(om2.MSpace.kWorld)
    return {'x': v.x, 'y': v.y, 'z': v.z}


# Blender's own outgoing payload sends RAW Blender-frame (Z-up) positions
# (only rotation is pre-converted addon-side) - so the receiver must apply
# the same Blender->Three conversion the Blender addon itself uses when
# pushing to the Studio: (bx, bz, -by).
def _blender_pos_to_maya(p):
    return (p.get('x', 0.0), p.get('z', 0.0), -p.get('y', 0.0))


def _sanitize_name(name):
    cleaned = ''.join(c if (c.isalnum() or c == '_') else '_' for c in str(name))
    return cleaned or 'Node'


# ─── Mesh export (Maya has no native glTF exporter, so: OBJ) ────────────────
LIGHT_SHAPE_TYPES = ('pointLight', 'spotLight', 'directionalLight', 'areaLight', 'ambientLight')


def _maya_type_to_bridge_type(maya_type):
    return {
        'pointLight': 'POINT',
        'spotLight': 'SPOT',
        'directionalLight': 'SUN',
        'areaLight': 'AREA',
        'ambientLight': 'POINT',
    }.get(maya_type, 'POINT')


BRIDGE_TYPE_TO_MAYA = {'POINT': 'pointLight', 'SPOT': 'spotLight', 'SUN': 'directionalLight', 'AREA': 'areaLight'}


def _export_selected_meshes_obj(selected_transforms):
    if not selected_transforms:
        return {'error': 'No mesh objects selected'}

    try:
        if not cmds.pluginInfo('objExport', query=True, loaded=True):
            cmds.loadPlugin('objExport')
    except Exception as e:
        return {'error': f'Could not load Maya\'s OBJ exporter: {e}'}

    prev_selection = cmds.ls(selection=True) or []
    tmp_path = None
    try:
        cmds.select(selected_transforms, replace=True)

        fd, tmp_path = tempfile.mkstemp(suffix='.obj')
        os.close(fd)

        cmds.file(
            tmp_path,
            force=True,
            options='groups=0;ptgroups=0;materials=0;smoothing=0;normals=1',
            type='OBJexport',
            preserveReferences=True,
            exportSelected=True,
        )

        with open(tmp_path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
        data = base64.b64encode(text.encode('utf-8')).decode('ascii')

        file_name = '_'.join(selected_transforms[:3]) + '.obj'
        return {
            'fileName': file_name,
            'dataBase64': data,
            'objectNames': list(selected_transforms),
            'format': 'obj',
        }
    except Exception as e:
        return {'error': str(e)}
    finally:
        if prev_selection:
            cmds.select(prev_selection, replace=True)
        else:
            cmds.select(clear=True)
        if tmp_path:
            try:
                os.remove(tmp_path)
            except Exception:
                pass


# ─── World / HDRI (Arnold aiSkyDomeLight) ───────────────────────────────────
def _gather_world_arnold():
    """Read the scene's Arnold sky dome light (if any) into the same
    {fileName, dataBase64, strength} shape the Blender addon sends for its
    World Background HDRI - the Studio-side listener is renderer-agnostic
    and doesn't care which DCC/renderer produced it."""
    domes = cmds.ls(type='aiSkyDomeLight')
    if not domes:
        return None
    dome = domes[0]

    conns = cmds.listConnections(dome + '.color', source=True, destination=False, type='file') or []
    if not conns:
        return None
    file_node = conns[0]

    raw_path = cmds.getAttr(file_node + '.fileTextureName')
    if not raw_path:
        return None
    resolved = cmds.workspace(expandName=raw_path)

    try:
        with open(resolved, 'rb') as f:
            raw = f.read()
    except Exception as e:
        return {'error': f'Could not read HDRI texture "{raw_path}": {e}'}

    intensity = cmds.getAttr(dome + '.intensity')
    exposure = cmds.getAttr(dome + '.exposure')
    # Arnold expresses brightness as intensity (linear multiplier) * 2^exposure
    # (stops) - collapse both into the single linear `strength` the Studio
    # expects, matching Blender's Background node "Strength" semantics.
    strength = intensity * (2 ** exposure)

    return {
        'fileName': os.path.basename(resolved),
        'dataBase64': base64.b64encode(raw).decode('ascii'),
        'strength': strength,
    }


# ─── Gather helpers (shared by push-to-Studio and push-to-Blender) ─────────
def _gather_lights(selection):
    lights = []
    for node in selection:
        shapes = cmds.listRelatives(node, shapes=True, type=LIGHT_SHAPE_TYPES, fullPath=True) or []
        for shape in shapes:
            maya_type = cmds.nodeType(shape)
            dag_path = _dag_path_for(node)
            quat = _world_quaternion(dag_path)

            color = cmds.getAttr(shape + '.color')[0]
            intensity = cmds.getAttr(shape + '.intensity')

            entry = {
                'id': node,
                'name': node.split('|')[-1],
                'type': _maya_type_to_bridge_type(maya_type),
                'color': {'r': color[0], 'g': color[1], 'b': color[2]},
                # Maya's light intensity is a unitless multiplier (~1.0
                # default) vs. Blender's watts (~1000 default) - scale up to
                # land in the Studio's 0-1000 brightness range.
                'energy': intensity * 200,
                'position': _world_translation(dag_path),
                'rotation': quat_to_euler_deg(quat),
            }
            if maya_type == 'spotLight':
                cone_deg = cmds.getAttr(shape + '.coneAngle')
                entry['spot_size'] = math.radians(cone_deg)
            lights.append(entry)
    return lights


def _gather_camera():
    cams = cmds.ls(type='camera', long=True) or []
    render_cam_shape = next((c for c in cams if cmds.getAttr(c + '.renderable')), None)
    if not render_cam_shape:
        return None
    cam_transform = cmds.listRelatives(render_cam_shape, parent=True, fullPath=True)[0]
    dag_path = _dag_path_for(cam_transform)
    quat = _world_quaternion(dag_path)
    try:
        hfov = cmds.camera(cam_transform, query=True, horizontalFieldOfView=True)
    except Exception:
        hfov = 50.0
    return {
        'position': _world_translation(dag_path),
        'rotation': quat_to_euler_deg(quat),
        'fov': hfov,
    }


# ─── Apply an incoming payload from Blender directly into the Maya scene ──
def _apply_payload_from_blender(payload):
    # ── Lights ──
    for entry in payload.get('lights', []) or []:
        base_name = _sanitize_name(entry.get('id', entry.get('name', 'Light')))
        node_name = f"BlenderBridge_{base_name}"
        maya_type = BRIDGE_TYPE_TO_MAYA.get(entry.get('type', 'POINT'), 'pointLight')

        existing = cmds.ls(node_name, long=True) or []
        transform = None
        if existing:
            transform = existing[0]
            shapes = cmds.listRelatives(transform, shapes=True, fullPath=True) or []
            if not shapes or cmds.nodeType(shapes[0]) != maya_type:
                cmds.delete(transform)
                transform = None

        if transform is None:
            shape = cmds.createNode(maya_type)
            transform = cmds.listRelatives(shape, parent=True, fullPath=True)[0]
            transform = cmds.rename(transform, node_name)

        shape = cmds.listRelatives(transform, shapes=True, fullPath=True)[0]

        color = entry.get('color', {})
        cmds.setAttr(shape + '.color', color.get('r', 1.0), color.get('g', 1.0), color.get('b', 1.0), type='double3')
        cmds.setAttr(shape + '.intensity', entry.get('energy', 200.0) / 200.0)

        pos = _blender_pos_to_maya(entry.get('position', {}))
        cmds.xform(transform, worldSpace=True, translation=pos)

        rot = entry.get('rotation', {})
        # Blender's addon pre-converts rotation into Three.js's Euler 'XYZ'
        # convention before sending. Maya's DEFAULT rotateOrder ('xyz') does
        # NOT reproduce the same matrix from those numbers for compound
        # rotations - verified numerically (dot=0.999 for a 2-axis case,
        # dot=0.991 for 3 axes). Maya's 'zyx' rotate order does match Three's
        # 'XYZ' exactly (dot=1.000000 across single- and multi-axis cases),
        # so the node must be set to rotateOrder='zyx' before the channels.
        cmds.setAttr(transform + '.rotateOrder', 5)  # zyx
        cmds.setAttr(transform + '.rotateX', rot.get('x', 0.0))
        cmds.setAttr(transform + '.rotateY', rot.get('y', 0.0))
        cmds.setAttr(transform + '.rotateZ', rot.get('z', 0.0))

        if maya_type == 'spotLight' and 'spot_size' in entry:
            cmds.setAttr(shape + '.coneAngle', math.degrees(entry['spot_size']))

    # ── Camera ──
    cam_data = payload.get('camera')
    if cam_data:
        node_name = "BlenderBridge_Camera"
        existing = cmds.ls(node_name, long=True) or []
        if existing:
            transform = existing[0]
        else:
            transform, _shape = cmds.camera()
            transform = cmds.rename(transform, node_name)

        pos = _blender_pos_to_maya(cam_data.get('position', {}))
        cmds.xform(transform, worldSpace=True, translation=pos)

        rot = cam_data.get('rotation', {})
        cmds.setAttr(transform + '.rotateOrder', 5)  # zyx - see light comment above
        cmds.setAttr(transform + '.rotateX', rot.get('x', 0.0))
        cmds.setAttr(transform + '.rotateY', rot.get('y', 0.0))
        cmds.setAttr(transform + '.rotateZ', rot.get('z', 0.0))

        fov = cam_data.get('fov')
        if fov:
            try:
                cmds.camera(transform, edit=True, horizontalFieldOfView=fov)
            except Exception:
                pass

    # ── Mesh objects (Blender sends OBJ over the direct bridge) ──
    mesh_data = payload.get('mesh')
    if mesh_data and mesh_data.get('dataBase64'):
        old_transforms = cmds.ls('BlenderBridge_*', long=True, type='transform') or []
        for node in old_transforms:
            if cmds.objExists(node) and cmds.listRelatives(node, shapes=True, type='mesh', fullPath=True):
                cmds.delete(node)

        raw = base64.b64decode(mesh_data['dataBase64'])
        fd, tmp_path = tempfile.mkstemp(suffix='.obj')
        os.close(fd)
        try:
            with open(tmp_path, 'wb') as f:
                f.write(raw)
            try:
                if not cmds.pluginInfo('objExport', query=True, loaded=True):
                    cmds.loadPlugin('objExport')
            except Exception:
                pass

            before = set(cmds.ls(assemblies=True, long=True) or [])
            cmds.file(tmp_path, i=True, type='OBJ', ignoreVersion=True,
                      mergeNamespacesOnClash=False, options='mo=0', preserveReferences=True)
            after = set(cmds.ls(assemblies=True, long=True) or [])

            for node in (after - before):
                if cmds.listRelatives(node, shapes=True, type='mesh', fullPath=True):
                    short = node.split('|')[-1]
                    try:
                        cmds.rename(node, f"BlenderBridge_{short}")
                    except Exception:
                        pass
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    # ── World / HDRI -> Arnold aiSkyDomeLight ──
    world_data = payload.get('world')
    if world_data and world_data.get('dataBase64') and 'error' not in world_data:
        raw = base64.b64decode(world_data['dataBase64'])
        file_name = world_data.get('fileName', 'BlenderBridge_World.hdr')
        tmp_path = os.path.join(tempfile.gettempdir(), f"blenderbridge_{file_name}")
        with open(tmp_path, 'wb') as f:
            f.write(raw)

        domes = cmds.ls(type='aiSkyDomeLight')
        dome = domes[0] if domes else None
        if dome is None:
            try:
                dome = cmds.createNode('aiSkyDomeLight')
            except Exception as e:
                cmds.warning(f"HDRI Forge Bridge: could not create aiSkyDomeLight (is Arnold/mtoa loaded?): {e}")
                dome = None

        if dome:
            conns = cmds.listConnections(dome + '.color', source=True, destination=False, type='file') or []
            if conns:
                file_node = conns[0]
            else:
                file_node = cmds.shadingNode('file', asTexture=True, isColorManaged=True)
                cmds.connectAttr(file_node + '.outColor', dome + '.color', force=True)

            cmds.setAttr(file_node + '.fileTextureName', tmp_path, type='string')
            cmds.setAttr(dome + '.intensity', world_data.get('strength', 1.0))
            cmds.setAttr(dome + '.exposure', 0.0)


# ─── Direct-bridge listener (receives pushes from Blender) ─────────────────
_direct_server = {"httpd": None, "thread": None}


def _consume_payload_from_blender(payload):
    try:
        _apply_payload_from_blender(payload)
        _direct_state["last_received"] = time.time()
    except Exception as e:
        cmds.warning(f"HDRI Forge Bridge: error applying push from Blender: {e}")
    _refresh_blender_status()


class _DirectBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # keep Maya's Script Editor quiet - errors are still cmds.warning'd

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == BRIDGE_PATH:
            self._send_json(200, {'ok': True, 'app': 'Maya', 'mode': 'maya'})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != BRIDGE_PATH:
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        # cmds/OpenMaya calls must happen on Maya's main thread -
        # executeDeferred hands the work back instead of running it here.
        maya.utils.executeDeferred(_consume_payload_from_blender, payload)
        self._send_json(200, {'ok': True})


def _start_direct_server():
    if _direct_server["httpd"] is not None:
        return
    try:
        httpd = HTTPServer(('127.0.0.1', MAYA_RECEIVE_PORT), _DirectBridgeHandler)
    except OSError as e:
        cmds.warning(f"HDRI Forge Bridge: could not start direct-bridge listener on port {MAYA_RECEIVE_PORT}: {e}")
        return
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    _direct_server["httpd"] = httpd
    _direct_server["thread"] = thread


def _stop_direct_server():
    httpd = _direct_server["httpd"]
    if httpd is not None:
        httpd.shutdown()
        httpd.server_close()
    _direct_server["httpd"] = None
    _direct_server["thread"] = None


# ─── Build + send the payload (to Studio) ───────────────────────────────────
def push_to_studio(*_args):
    up_axis = cmds.upAxis(query=True, axis=True)
    if up_axis != 'y':
        cmds.warning(
            f"HDRI Forge Bridge: scene up-axis is '{up_axis}', not 'y' - "
            "positions/rotations are only verified for a Y-up scene (Maya's default)."
        )

    # Always re-probe right before sending, rather than trusting a cached
    # result - the cache can go stale (e.g. the Desktop App was restarted
    # since the last check) and silently send the push to the wrong target.
    probe_studio()
    studio_url = _state["url"]
    if not studio_url:
        cmds.warning("HDRI Forge Bridge: no HDRI Forge Studio found running - open the app or start the dev server")
        return

    selection = cmds.ls(selection=True, long=True) or []
    payload = {'source': 'maya'}

    lights = _gather_lights(selection)
    if lights:
        payload['lights'] = lights

    camera = _gather_camera()
    if camera:
        payload['camera'] = camera

    world = _gather_world_arnold()
    if world:
        payload['world'] = world

    mesh_transforms = [
        n for n in selection
        if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)
    ]
    if mesh_transforms:
        payload['mesh'] = _export_selected_meshes_obj(mesh_transforms)

    if not (lights or camera or world or mesh_transforms):
        cmds.warning("HDRI Forge Bridge: nothing selected to push")
        return

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            studio_url,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        print(f"[HDRI Forge Bridge] Pushed to {_state['label']}: {list(payload.keys())}")
    except urllib.error.URLError as e:
        _state["url"] = None
        _state["label"] = None
        cmds.warning(f"HDRI Forge Bridge: Studio unreachable: {e}")
    except Exception as e:
        cmds.warning(f"HDRI Forge Bridge: {e}")


# ─── Build + send the payload (direct to Blender) ──────────────────────────
def push_to_blender(*_args):
    up_axis = cmds.upAxis(query=True, axis=True)
    if up_axis != 'y':
        cmds.warning(
            f"HDRI Forge Bridge: scene up-axis is '{up_axis}', not 'y' - "
            "positions/rotations are only verified for a Y-up scene (Maya's default)."
        )

    probe_blender()
    if not _direct_state["blender_connected"]:
        cmds.warning("HDRI Forge Bridge: no Blender bridge listener found - open Blender with the HDRI Forge Bridge addon enabled")
        return

    selection = cmds.ls(selection=True, long=True) or []
    payload = {'source': 'maya'}

    lights = _gather_lights(selection)
    if lights:
        payload['lights'] = lights

    camera = _gather_camera()
    if camera:
        payload['camera'] = camera

    world = _gather_world_arnold()
    if world:
        payload['world'] = world

    mesh_transforms = [
        n for n in selection
        if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)
    ]
    if mesh_transforms:
        payload['mesh'] = _export_selected_meshes_obj(mesh_transforms)

    if not (lights or camera or world or mesh_transforms):
        cmds.warning("HDRI Forge Bridge: nothing selected to push")
        return

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            BLENDER_DIRECT_URL,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        print(f"[HDRI Forge Bridge] Pushed to Blender: {list(payload.keys())}")
    except urllib.error.URLError as e:
        _direct_state["blender_connected"] = False
        cmds.warning(f"HDRI Forge Bridge: Blender unreachable: {e}")
    except Exception as e:
        cmds.warning(f"HDRI Forge Bridge: {e}")


# ─── UI ──────────────────────────────────────────────────────────────────────
def _refresh_status(*_args):
    found = probe_studio()
    if _ui["status_text"] and cmds.text(_ui["status_text"], exists=True):
        if found:
            cmds.text(_ui["status_text"], edit=True, label=f"Connected — {_state['label']}")
        else:
            cmds.text(_ui["status_text"], edit=True, label="Not connected")
    _refresh_selection_count()


def _refresh_selection_count(*_args):
    if not (_ui["count_text"] and cmds.text(_ui["count_text"], exists=True)):
        return
    selection = cmds.ls(selection=True, long=True) or []
    light_count = sum(
        1 for n in selection
        if cmds.listRelatives(n, shapes=True, type=LIGHT_SHAPE_TYPES, fullPath=True)
    )
    mesh_count = sum(
        1 for n in selection
        if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)
    )
    cmds.text(_ui["count_text"], edit=True, label=f"Selected: {light_count} lights, {mesh_count} meshes")


def _refresh_blender_status(*_args):
    found = probe_blender()
    if _ui["blender_status_text"] and cmds.text(_ui["blender_status_text"], exists=True):
        cmds.text(_ui["blender_status_text"], edit=True,
                   label="Connected — Blender" if found else "Not connected")
    if _ui["blender_last_text"] and cmds.text(_ui["blender_last_text"], exists=True):
        if _direct_state["last_received"]:
            age = time.time() - _direct_state["last_received"]
            cmds.text(_ui["blender_last_text"], edit=True, label=f"Last push received {age:.0f}s ago")
        else:
            cmds.text(_ui["blender_last_text"], edit=True, label="No push received yet")
    _refresh_blender_count()


def _refresh_blender_count(*_args):
    if not (_ui["blender_count_text"] and cmds.text(_ui["blender_count_text"], exists=True)):
        return
    selection = cmds.ls(selection=True, long=True) or []
    light_count = sum(
        1 for n in selection
        if cmds.listRelatives(n, shapes=True, type=LIGHT_SHAPE_TYPES, fullPath=True)
    )
    mesh_count = sum(
        1 for n in selection
        if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)
    )
    cmds.text(_ui["blender_count_text"], edit=True, label=f"Selected: {light_count} lights, {mesh_count} meshes")


def show_ui(*_args):
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)

    window = cmds.window(WINDOW_NAME, title=PLUGIN_NAME, widthHeight=(320, 260), sizeable=False)
    cmds.columnLayout(adjustableColumn=True, rowSpacing=6, columnAttach=('both', 12))
    cmds.separator(height=8, style='none')

    tabs = cmds.tabLayout(innerMarginWidth=8, innerMarginHeight=8)

    # ── Tab 1: HDRI Forge Studio ──
    studio_tab = cmds.columnLayout(adjustableColumn=True, rowSpacing=8)
    row = cmds.rowLayout(numberOfColumns=2, adjustableColumn=1, columnAttach=(1, 'both', 0))
    _ui["status_text"] = cmds.text(label="Not connected", align='left')
    cmds.button(label="Refresh", width=70, command=_refresh_status)
    cmds.setParent('..')  # end row
    cmds.separator(height=4, style='in')
    _ui["count_text"] = cmds.text(label="Selected: 0 lights, 0 meshes", align='left')
    cmds.button(label="Push to HDRI Forge Studio", height=32, command=push_to_studio)
    cmds.setParent('..')  # end studio_tab

    # ── Tab 2: Blender (direct connection) ──
    blender_tab = cmds.columnLayout(adjustableColumn=True, rowSpacing=8)
    row2 = cmds.rowLayout(numberOfColumns=2, adjustableColumn=1, columnAttach=(1, 'both', 0))
    _ui["blender_status_text"] = cmds.text(label="Not connected", align='left')
    cmds.button(label="Refresh", width=70, command=_refresh_blender_status)
    cmds.setParent('..')  # end row2
    cmds.separator(height=4, style='in')
    _ui["blender_last_text"] = cmds.text(label="No push received yet", align='left')
    cmds.text(label=f"Listening for Blender on port {MAYA_RECEIVE_PORT}", align='left')
    cmds.separator(height=4, style='in')
    _ui["blender_count_text"] = cmds.text(label="Selected: 0 lights, 0 meshes", align='left')
    cmds.button(label="Push to Blender", height=32, command=push_to_blender)
    cmds.setParent('..')  # end blender_tab

    cmds.tabLayout(
        tabs, edit=True,
        tabLabel=((studio_tab, 'HDRI Forge Studio'), (blender_tab, 'Blender')),
    )

    cmds.setParent('..')  # end tabs
    cmds.separator(height=4, style='none')
    cmds.showWindow(window)

    _refresh_status()
    _refresh_blender_status()
    # Keep the selection counts fresh whenever Maya's selection changes while
    # this window is open. Tied to the window's lifetime via a scriptJob that
    # kills itself if the window has been closed.
    cmds.scriptJob(event=['SelectionChanged', _on_selection_changed], protected=True)


def _on_selection_changed(*_args):
    if not cmds.window(WINDOW_NAME, exists=True):
        return
    _refresh_selection_count()
    _refresh_blender_count()


# ─── Plug-in registration ───────────────────────────────────────────────────
def initializePlugin(plugin):
    vendor = "HDRI Forge Studio"
    version = "1.1.0"
    plugin_fn = om2.MFnPlugin(plugin, vendor, version)

    if cmds.menu(MENU_NAME, exists=True):
        cmds.deleteUI(MENU_NAME)
    cmds.menu(MENU_NAME, label=PLUGIN_NAME, parent='MayaWindow', tearOff=True)
    cmds.menuItem(label="Open HDRI Forge Bridge", command=show_ui, parent=MENU_NAME)

    _start_direct_server()


def uninitializePlugin(plugin):
    _stop_direct_server()
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)
    if cmds.menu(MENU_NAME, exists=True):
        cmds.deleteUI(MENU_NAME)
