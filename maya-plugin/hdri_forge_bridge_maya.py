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

import sys

import maya.cmds as cmds
import maya.api.OpenMaya as om2
import maya.utils

# forge_link_core.py is the shared, DCC-agnostic half of the live HDRI link (discovery, background
# download, reconnect). It sits next to this plug-in file. Maya's Plug-in Manager executes a .py plug-in
# WITHOUT defining __file__, so the location comes from the code object (which carries the real path
# either way). Maya also keeps modules cached across unload/load, so drop any stale copy first or an
# updated core would never be picked up.
import inspect
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
    _LinkError = _core.ForgeLinkError
except ImportError:
    # Everything except Live HDRI keeps working; the Live tab explains what is missing.
    _core = None
    _LinkError = RuntimeError


def _require_core():
    if _core is None:
        raise RuntimeError("forge_link_core.py is missing. Copy it next to hdri_forge_bridge_maya.py (%s)." % _HERE)


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
    "live_status": None, "live_detail": None, "live_toggle": None, "live_restore": None,
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
            # groups=1 writes a 'g <objectName>' line per selected object -
            # without it (groups=0) multiple objects merge into one
            # undifferentiated vertex/face soup with no way to tell them
            # apart again (verified empirically: zero 'o'/'g' lines emitted
            # for a 2-object export with groups=0).
            options='groups=1;ptgroups=0;materials=0;smoothing=0;normals=1',
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
    # Skip the sky domes the live link made from Forge's own HDRI: pushing them back would feed
    # Forge its own output as if it were the artist's HDRI.
    domes = [d for d in (cmds.ls(type='aiSkyDomeLight') or []) if not _is_bridge_node(d)]
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
            if maya_type == 'areaLight':
                # Maya's areaLight shape is a unit (1x1) square; its real size comes from
                # the transform's scale, not a width/height attribute on the shape.
                try:
                    sx = abs(cmds.getAttr(node + '.scaleX'))
                    sy = abs(cmds.getAttr(node + '.scaleY'))
                except Exception:
                    sx = sy = 1.0
                entry['size'] = sx
                entry['size_y'] = sy
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


def _gather_all_or_selected_cameras():
    # If any cameras are selected, push only those; otherwise push every
    # camera in the scene - same selection-vs-all convention used by the
    # Blender addon's equivalent function.
    selection = cmds.ls(selection=True, long=True) or []
    selected_cam_transforms = [
        n for n in selection
        if cmds.listRelatives(n, shapes=True, type='camera', fullPath=True)
    ]
    if selected_cam_transforms:
        cam_transforms = selected_cam_transforms
    else:
        all_cam_shapes = cmds.ls(type='camera', long=True) or []
        cam_transforms = []
        for shape in all_cam_shapes:
            parents = cmds.listRelatives(shape, parent=True, fullPath=True)
            if parents:
                cam_transforms.append(parents[0])

    result = []
    for cam_transform in cam_transforms:
        dag_path = _dag_path_for(cam_transform)
        quat = _world_quaternion(dag_path)
        try:
            # Three.js's PerspectiveCamera.fov is always VERTICAL - querying
            # horizontalFieldOfView here (as this used to) sent the wrong
            # angle whenever the camera's aspect ratio isn't square, which is
            # always, making every pushed camera's framing wrong even with
            # correct position/rotation (same bug found and fixed on the
            # Blender side, where .angle is sensor_fit-dependent and silently
            # returns horizontal fov under the common AUTO fit).
            vfov = cmds.camera(cam_transform, query=True, verticalFieldOfView=True)
        except Exception:
            vfov = 40.0
        result.append({
            'id': cam_transform,
            'name': cam_transform.split('|')[-1],
            'position': _world_translation(dag_path),
            'rotation': quat_to_euler_deg(quat),
            'fov': vfov,
            'clipStart': cmds.getAttr(cam_transform + '.nearClipPlane'),
            'clipEnd': cmds.getAttr(cam_transform + '.farClipPlane'),
        })
    return result


# ─── Per-object OBJ import (direct-bridge mesh receiving) ──────────────────
# Maya's own OBJ importer merges every object in a file into a single mesh
# regardless of any option flag passed to it (verified empirically - 'mo=0',
# 'mo=1', and 'groups=1' all produced exactly one merged transform for a
# 2-object file). The only reliable way to get separate Maya objects back is
# to split the incoming OBJ ourselves and import each object from its own
# single-object file.
def _split_obj_by_object(obj_text):
    """Split a multi-object Wavefront OBJ (Blender's exporter writes one
    'o <name>' block per object, sharing one global v/vt/vn list) into
    {object_name: single_object_obj_text}, with face indices remapped to a
    fresh local v/vt/vn list per object."""
    lines = obj_text.splitlines()
    global_v, global_vt, global_vn = [], [], []
    objects = []
    current_name = None
    current_faces = []

    def flush():
        if current_name is not None:
            objects.append((current_name, current_faces))

    for line in lines:
        if line.startswith('v '):
            global_v.append(line)
        elif line.startswith('vt '):
            global_vt.append(line)
        elif line.startswith('vn '):
            global_vn.append(line)
        elif line.startswith('o '):
            flush()
            current_name = line[2:].strip()
            current_faces = []
        elif line.startswith('f '):
            if current_name is None:
                current_name = 'Object'
                current_faces = []
            current_faces.append(line)
    flush()

    result = {}
    for name, faces in objects:
        if not faces:
            continue
        v_used, vt_used, vn_used = set(), set(), set()
        for line in faces:
            for token in line.split()[1:]:
                parts = token.split('/')
                if len(parts) >= 1 and parts[0]:
                    v_used.add(int(parts[0]))
                if len(parts) >= 2 and parts[1]:
                    vt_used.add(int(parts[1]))
                if len(parts) >= 3 and parts[2]:
                    vn_used.add(int(parts[2]))

        v_map = {old: i + 1 for i, old in enumerate(sorted(v_used))}
        vt_map = {old: i + 1 for i, old in enumerate(sorted(vt_used))}
        vn_map = {old: i + 1 for i, old in enumerate(sorted(vn_used))}

        out_lines = ['o ' + name]
        out_lines.extend(global_v[old - 1] for old in sorted(v_used))
        out_lines.extend(global_vt[old - 1] for old in sorted(vt_used))
        out_lines.extend(global_vn[old - 1] for old in sorted(vn_used))

        for line in faces:
            new_tokens = ['f']
            for token in line.split()[1:]:
                parts = token.split('/')
                new_parts = [str(v_map[int(parts[0])]) if parts[0] else '']
                if len(parts) >= 2:
                    new_parts.append(str(vt_map[int(parts[1])]) if parts[1] else '')
                if len(parts) >= 3:
                    new_parts.append(str(vn_map[int(parts[2])]) if parts[2] else '')
                new_tokens.append('/'.join(new_parts) if len(new_parts) > 1 else new_parts[0])
            out_lines.append(' '.join(new_tokens))

        result[name] = '\n'.join(out_lines) + '\n'

    return result


def _import_single_object_obj(obj_text, final_name):
    """Import a single-object OBJ file and rename the resulting transform.
    Returns the new transform's name, or None if nothing came in."""
    fd, tmp_path = tempfile.mkstemp(suffix='.obj')
    os.close(fd)
    try:
        with open(tmp_path, 'w') as f:
            f.write(obj_text)
        before = set(cmds.ls(assemblies=True, long=True) or [])
        cmds.file(tmp_path, i=True, type='OBJ', ignoreVersion=True,
                  mergeNamespacesOnClash=False, preserveReferences=True)
        after = set(cmds.ls(assemblies=True, long=True) or [])
        new_transforms = [n for n in (after - before) if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)]
        if not new_transforms:
            return None
        return cmds.rename(new_transforms[0], final_name)
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


def _replace_mesh_geometry(existing_transform, obj_text):
    """Import obj_text into a throwaway transform, then move its mesh shape
    onto existing_transform and delete the throwaway - keeps the existing
    transform's name/identity intact (so repeated pushes update the same
    Maya object instead of piling up new ones) while swapping the geometry."""
    fd, tmp_path = tempfile.mkstemp(suffix='.obj')
    os.close(fd)
    try:
        with open(tmp_path, 'w') as f:
            f.write(obj_text)
        before = set(cmds.ls(assemblies=True, long=True) or [])
        cmds.file(tmp_path, i=True, type='OBJ', ignoreVersion=True,
                  mergeNamespacesOnClash=False, preserveReferences=True)
        after = set(cmds.ls(assemblies=True, long=True) or [])
        new_transforms = [n for n in (after - before) if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)]
        if not new_transforms:
            return False
        new_transform = new_transforms[0]
        new_shape = cmds.listRelatives(new_transform, shapes=True, type='mesh', fullPath=True)[0]

        old_shapes = cmds.listRelatives(existing_transform, shapes=True, type='mesh', fullPath=True) or []
        cmds.parent(new_shape, existing_transform, shape=True, relative=True)
        for s in old_shapes:
            if cmds.objExists(s):
                cmds.delete(s)
        if cmds.objExists(new_transform):
            cmds.delete(new_transform)
        return True
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


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

    # ── Mesh objects (Blender sends OBJ over the direct bridge, one 'o'
    # block per object) ──
    mesh_data = payload.get('mesh')
    if mesh_data and mesh_data.get('dataBase64'):
        try:
            if not cmds.pluginInfo('objExport', query=True, loaded=True):
                cmds.loadPlugin('objExport')
        except Exception:
            pass

        obj_text = base64.b64decode(mesh_data['dataBase64']).decode('utf-8', errors='replace')
        pieces = _split_obj_by_object(obj_text)

        group_name = "BlenderBridge_Meshes"
        if not cmds.objExists(group_name):
            cmds.group(empty=True, name=group_name)

        for obj_name, piece_text in pieces.items():
            node_name = f"BlenderBridge_{_sanitize_name(obj_name)}"
            if cmds.objExists(node_name) and cmds.listRelatives(node_name, shapes=True, type='mesh', fullPath=True):
                # Same name already exists - swap its geometry in place
                # instead of deleting and recreating the node, so the
                # transform's identity (and anything else attached to it
                # in Maya) survives repeated pushes.
                _replace_mesh_geometry(node_name, piece_text)
            else:
                new_transform = _import_single_object_obj(piece_text, node_name)
                if new_transform and cmds.objExists(group_name):
                    cmds.parent(new_transform, group_name)

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

    # Camera data is pushed exclusively via the dedicated "Push Camera(s)"
    # button (push_cameras_to_studio) - not bundled in here, so pushing
    # mesh/lights never silently overwrites whatever camera(s) the Studio
    # already has.

    world = _gather_world_arnold()
    if world:
        payload['world'] = world

    mesh_transforms = [
        n for n in selection
        if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)
    ]
    if mesh_transforms:
        payload['mesh'] = _export_selected_meshes_obj(mesh_transforms)

    if not (lights or world or mesh_transforms):
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


# ─── Build + send the payload (camera(s) only, to Studio) ──────────────────
def push_cameras_to_studio(*_args):
    probe_studio()
    studio_url = _state["url"]
    if not studio_url:
        cmds.warning("HDRI Forge Bridge: no HDRI Forge Studio found running - open the app or start the dev server")
        return

    cameras = _gather_all_or_selected_cameras()
    if not cameras:
        cmds.warning("HDRI Forge Bridge: no cameras in the scene")
        return

    payload = {'source': 'maya', 'cameras': cameras}

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
        print(f"[HDRI Forge Bridge] Pushed {len(cameras)} camera(s) to {_state['label']}")
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


# ══ Live HDRI: Forge -> Maya ═══════════════════════════════════════════════
# Forge streams the HDRI it renders to a local bridge (the same stream Erik Adjuster uses).
# forge_link_core downloads it on a background thread; this section applies each map to an Arnold
# aiSkyDomeLight on Maya's main thread, from a timer. The artist's own sky domes are never edited:
# the live HDRI goes into a separate tagged dome, the artist's domes are hidden while it runs, and
# Stop deletes ours and shows theirs again.

BRIDGE_ATTR = "hdriForgeBridge"        # string attribute on every node we create (value: live / import)
HIDDEN_ATTR = "hdriForgeHidden"        # on our dome: names of the artist's domes we hid
LIVE_KIND, IMPORT_KIND = "live", "import"
_DOME_NAMES = {LIVE_KIND: "HDRIForgeLive", IMPORT_KIND: "HDRIForgeImport"}

# Rotation (degrees) about Y that makes Arnold's lat-long sky agree with Forge's. Both are Y-up, but Arnold puts
# the centre of the image a quarter turn away from where Forge does, so this is measured, not assumed:
# bridge-core/tests/maya_orient_test.py renders with Arnold, aimed at two separate lights (so a mirrored sky
# could not pass), and keeps a +180 degree rotation as a control that must fail.
FORGE_TO_MAYA_Y_ROTATION = 90.0

_live = {"link": None, "running": False, "timer": None, "job": None, "last_status": None}


def _is_bridge_node(node):
    """True for a transform or shape that the live link / Import created."""
    xform = node
    if cmds.nodeType(node) != 'transform':
        parents = cmds.listRelatives(node, parent=True) or []
        xform = parents[0] if parents else node
    return cmds.attributeQuery(BRIDGE_ATTR, node=xform, exists=True)


def _bridge_domes(kind=None):
    out = []
    for shape in cmds.ls(type='aiSkyDomeLight') or []:
        parents = cmds.listRelatives(shape, parent=True) or []
        if not parents or not cmds.attributeQuery(BRIDGE_ATTR, node=parents[0], exists=True):
            continue
        if kind is None or cmds.getAttr(parents[0] + '.' + BRIDGE_ATTR) == kind:
            out.append((parents[0], shape))
    return out


def _ensure_arnold():
    if not cmds.pluginInfo('mtoa', query=True, loaded=True):
        try:
            cmds.loadPlugin('mtoa', quiet=True)
        except Exception:
            raise _LinkError("Arnold (mtoa) is not loaded. Load it in Windows > Settings/Preferences > Plug-in Manager.")


def _hide_artist_domes(our_transform):
    """Arnold lights every aiSkyDomeLight at once, so the artist's own must be off while ours is on."""
    hidden = []
    for shape in cmds.ls(type='aiSkyDomeLight') or []:
        parents = cmds.listRelatives(shape, parent=True) or []
        if not parents or cmds.attributeQuery(BRIDGE_ATTR, node=parents[0], exists=True):
            continue
        if cmds.getAttr(parents[0] + '.visibility'):
            cmds.setAttr(parents[0] + '.visibility', 0)
            hidden.append(parents[0])
    if hidden:
        if not cmds.attributeQuery(HIDDEN_ATTR, node=our_transform, exists=True):
            cmds.addAttr(our_transform, longName=HIDDEN_ATTR, dataType='string')
        cmds.setAttr(our_transform + '.' + HIDDEN_ATTR, json.dumps(hidden), type='string')


def _show_artist_domes(our_transform):
    if not cmds.attributeQuery(HIDDEN_ATTR, node=our_transform, exists=True):
        return
    try:
        names = json.loads(cmds.getAttr(our_transform + '.' + HIDDEN_ATTR) or "[]")
    except ValueError:
        names = []
    for n in names:
        if cmds.objExists(n):
            cmds.setAttr(n + '.visibility', 1)


def _bridge_dome(kind):
    """The sky dome we own for this kind, created on demand. Returns (transform, shape, file_node)."""
    _ensure_arnold()
    existing = _bridge_domes(kind)
    if existing:
        xform, shape = existing[0]
    else:
        shape = cmds.createNode('aiSkyDomeLight', name=_DOME_NAMES[kind] + "Shape")
        xform = (cmds.listRelatives(shape, parent=True) or [shape])[0]
        xform = cmds.rename(xform, _DOME_NAMES[kind])
        shape = (cmds.listRelatives(xform, shapes=True) or [shape])[0]
        cmds.addAttr(xform, longName=BRIDGE_ATTR, dataType='string')
        cmds.setAttr(xform + '.' + BRIDGE_ATTR, kind, type='string')
        try:
            cmds.setAttr(shape + '.format', 2)              # lat-long
        except Exception:
            pass
        cmds.setAttr(shape + '.intensity', 1.0)             # Forge already bakes exposure into the map
        cmds.setAttr(xform + '.rotateY', FORGE_TO_MAYA_Y_ROTATION)
        _hide_artist_domes(xform)
    conns = cmds.listConnections(shape + '.color', source=True, destination=False, type='file') or []
    if conns:
        file_node = conns[0]
    else:
        file_node = cmds.shadingNode('file', asTexture=True, isColorManaged=True, name=_DOME_NAMES[kind] + "_file")
        try:
            cmds.setAttr(file_node + '.colorSpace', 'Raw', type='string')   # HDR data is already scene-linear
        except Exception:
            pass
        try:
            # Arnold would otherwise convert every streamed map to a .tx cache before using it: slow, and
            # a new multi-megabyte file per update. Live maps are used once and thrown away.
            cmds.setAttr(file_node + '.aiAutoTx', 0)
        except Exception:
            pass
        cmds.connectAttr(file_node + '.outColor', shape + '.color', force=True)
    return xform, shape, file_node


def _set_dome_image(kind, path):
    xform, shape, file_node = _bridge_dome(kind)
    cmds.setAttr(file_node + '.fileTextureName', path, type='string')
    return xform, shape, file_node


def _remove_bridge_domes(kind=None):
    """Delete the domes/files we made and show the artist's own again."""
    for xform, shape in _bridge_domes(kind):
        _show_artist_domes(xform)
        files = cmds.listConnections(shape + '.color', source=True, destination=False, type='file') or []
        cmds.delete(xform)
        for f in files:
            # Only ever our own file node (named by _bridge_dome). A guard like "nothing uses its output"
            # is wrong: Maya keeps a colour-management connection on every file node, so it never passes.
            if cmds.objExists(f) and f.startswith("HDRIForge"):
                cmds.delete(f)


def _live_tick(*_args):
    """Main-thread timer: apply the newest map the background thread has downloaded."""
    link = _live["link"]
    if link is None or not _live["running"]:
        return
    frame = link.take_frame()
    if frame is not None:
        try:
            _set_dome_image(LIVE_KIND, frame.path)
        except Exception as e:                       # never let a bad frame kill the timer
            cmds.warning("HDRI Forge Bridge: could not apply frame: %s" % e)
            link._set(state=_core.ERROR, message=str(e))
        link.frame_applied(frame)
    st = link.status()
    key = (st["state"], st["message"], st["note"])
    if key != _live["last_status"]:
        _live["last_status"] = key
        _refresh_live_ui()


def _start_timer():
    if _live["timer"] is not None or _live["job"] is not None:
        return
    QtCore = None
    for name in ("PySide2", "PySide6"):                  # Maya 2022-2024 / 2025+
        try:
            QtCore = __import__(name, fromlist=["QtCore"]).QtCore
            break
        except ImportError:
            continue
    if QtCore is not None:
        t = QtCore.QTimer()
        t.setInterval(100)
        t.timeout.connect(_live_tick)
        t.start()
        _live["timer"] = t
    else:                                               # no Qt: Maya's idle event is the next best main-thread hook
        _live["job"] = cmds.scriptJob(event=['idle', _live_tick], protected=False)


def _stop_timer():
    if _live["timer"] is not None:
        _live["timer"].stop()
        _live["timer"] = None
    if _live["job"] is not None:
        if cmds.scriptJob(exists=_live["job"]):
            cmds.scriptJob(kill=_live["job"], force=True)
        _live["job"] = None


def live_start(*_args):
    _require_core()
    _ensure_arnold()
    if _live["link"] is None:
        _live["link"] = _core.ForgeLink(cache_dir=os.path.join(tempfile.gettempdir(), "hdri_forge_live_maya_%d" % os.getpid()),
                                        client_name="Maya " + cmds.about(version=True))
    _live["running"] = True
    _live["link"].start()
    _start_timer()
    _refresh_live_ui()


def live_stop(*_args):
    _live["running"] = False
    _stop_timer()
    link = _live["link"]
    if link is not None:
        link.stop()
        link.cleanup()
    _remove_bridge_domes(LIVE_KIND)
    _live["last_status"] = None
    _refresh_live_ui()


def live_toggle(*_args):
    if _live["running"]:
        live_stop()
    else:
        try:
            live_start()
        except _LinkError as e:
            cmds.warning("HDRI Forge Bridge: %s" % e)


def import_hdri(*_args):
    """Save Forge's current HDRI (and its .ash) into the project and use it as the sky. Permanent, unlike Live."""
    try:
        _require_core()
        _ensure_arnold()
        root = cmds.workspace(query=True, rootDirectory=True)
        dest = os.path.join(root, "sourceimages", "hdri_forge") if root else os.path.join(tempfile.gettempdir(), "hdri_forge_import")
        frame = _core.fetch_latest(dest, name="forge_hdri")
    except _LinkError as e:
        cmds.warning("HDRI Forge Bridge: %s" % e)
        return None
    if _live["running"]:
        live_stop()                                      # an imported dome replaces the live one
    _remove_bridge_domes(IMPORT_KIND)
    _set_dome_image(IMPORT_KIND, frame.path)
    cmds.inViewMessage(amg="Imported <hl>%s</hl> to %s" % (frame.describe(), frame.path), pos='midCenter', fade=True)
    _refresh_live_ui()
    return frame


def restore_sky(*_args):
    """Stop everything the bridge is doing to the sky and show the artist's own domes again."""
    if _live["running"]:
        live_stop()
    _remove_bridge_domes()
    _refresh_live_ui()


def _refresh_live_ui():
    ui = _ui
    if not (ui.get("live_status") and cmds.text(ui["live_status"], exists=True)):
        return
    link = _live["link"]
    if _live["running"] and link is not None:
        st = link.status()
        cmds.text(ui["live_status"], edit=True, label=st["message"])
        detail = ""
        if st["state"] == _core.STREAMING:
            detail = "%d x %d  -  %d ms to render  -  %s :%d" % (st["width"], st["height"], st["ms"], st["mode"], st["port"])
        if st["note"]:
            detail = (detail + "   " if detail else "") + st["note"]
        cmds.text(ui["live_detail"], edit=True, label=detail)
    else:
        cmds.text(ui["live_status"], edit=True, label='In Forge, turn on "Erik Live", then Start.')
        cmds.text(ui["live_detail"], edit=True, label="")
    cmds.button(ui["live_toggle"], edit=True, label="Stop live HDRI" if _live["running"] else "Start live HDRI")
    cmds.button(ui["live_restore"], edit=True, enable=bool(_bridge_domes()))


def show_ui(*_args):
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)

    window = cmds.window(WINDOW_NAME, title=PLUGIN_NAME, widthHeight=(360, 300), sizeable=False)
    cmds.columnLayout(adjustableColumn=True, rowSpacing=6, columnAttach=('both', 12))
    cmds.separator(height=8, style='none')

    tabs = cmds.tabLayout(innerMarginWidth=8, innerMarginHeight=8)

    # ── Tab 0: Live HDRI (Forge -> Maya) ──
    live_tab = cmds.columnLayout(adjustableColumn=True, rowSpacing=8)
    _ui["live_toggle"] = cmds.button(label="Start live HDRI", height=32, command=live_toggle)
    _ui["live_status"] = cmds.text(label='In Forge, turn on "Erik Live", then Start.', align='left', font='boldLabelFont')
    _ui["live_detail"] = cmds.text(label="", align='left')
    cmds.separator(height=4, style='in')
    cmds.text(label="Import saves the current HDRI + .ash into sourceimages/hdri_forge.", align='left')
    cmds.button(label="Import HDRI", height=28, command=import_hdri)
    _ui["live_restore"] = cmds.button(label="Restore my sky", height=28, command=restore_sky, enable=False)
    cmds.setParent('..')  # end live_tab

    # ── Tab 1: HDRI Forge Studio ──
    studio_tab = cmds.columnLayout(adjustableColumn=True, rowSpacing=8)
    row = cmds.rowLayout(numberOfColumns=2, adjustableColumn=1, columnAttach=(1, 'both', 0))
    _ui["status_text"] = cmds.text(label="Not connected", align='left')
    cmds.button(label="Refresh", width=70, command=_refresh_status)
    cmds.setParent('..')  # end row
    cmds.separator(height=4, style='in')
    _ui["count_text"] = cmds.text(label="Selected: 0 lights, 0 meshes", align='left')
    cmds.button(label="Push to HDRI Forge Studio", height=32, command=push_to_studio)
    cmds.separator(height=4, style='in')
    cmds.text(label="Cameras: pushes selected, or all if none selected", align='left')
    cmds.button(label="Push Camera(s)", height=28, command=push_cameras_to_studio)
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
        tabLabel=((live_tab, 'Live HDRI'), (studio_tab, 'HDRI Forge Studio'), (blender_tab, 'Blender')),
    )

    cmds.setParent('..')  # end tabs
    cmds.separator(height=4, style='none')
    cmds.showWindow(window)

    _refresh_status()
    _refresh_blender_status()
    _refresh_live_ui()
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
    version = "1.2.0"
    plugin_fn = om2.MFnPlugin(plugin, vendor, version)

    if cmds.menu(MENU_NAME, exists=True):
        cmds.deleteUI(MENU_NAME)
    cmds.menu(MENU_NAME, label=PLUGIN_NAME, parent='MayaWindow', tearOff=True)
    cmds.menuItem(label="Open HDRI Forge Bridge", command=show_ui, parent=MENU_NAME)

    _start_direct_server()


def uninitializePlugin(plugin):
    try:
        live_stop()
    except Exception:
        pass
    _stop_direct_server()
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)
    if cmds.menu(MENU_NAME, exists=True):
        cmds.deleteUI(MENU_NAME)
