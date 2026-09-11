"""
HDRI Forge Bridge for Autodesk Maya
-------------------------------------
Push selected Maya lights, the active camera, and selected mesh objects to
HDRI Forge Studio in real time - the Maya-side counterpart to the Blender
addon of the same name (blender-addon/hdri_forge_bridge.py). Both send the
exact same JSON shape to the exact same endpoint, so the Studio side needs no
per-DCC special-casing beyond the mesh `format` field (Maya has no native
glTF exporter, so it sends OBJ instead of Blender's GLB).

Install: Windows > Settings/Preferences > Plug-in Manager > Browse, select
this file, and check "Loaded" (and "Auto load" to keep it enabled). A
"HDRI Forge Bridge" menu appears in Maya's main menu bar.

Tested against Maya's Python 3 API (Maya 2022+). Untested inside an actual
Maya session as of this writing - the rotation math is built on Maya's own
OpenMaya quaternion extraction (not hand-parsed matrices) specifically to
minimize that risk, but please verify a single light's position/orientation
against the Studio before relying on this for real work.
"""

import math
import json
import base64
import tempfile
import os
import urllib.request
import urllib.error

import maya.cmds as cmds
import maya.api.OpenMaya as om2


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

_state = {"url": None, "label": None}
_ui = {"status_text": None, "count_text": None}


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


# ─── Build + send the payload ───────────────────────────────────────────────
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

    # ── Lights ──
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

    if lights:
        payload['lights'] = lights

    # ── Camera (first renderable camera found) ──
    cams = cmds.ls(type='camera', long=True) or []
    render_cam_shape = next((c for c in cams if cmds.getAttr(c + '.renderable')), None)
    if render_cam_shape:
        cam_transform = cmds.listRelatives(render_cam_shape, parent=True, fullPath=True)[0]
        dag_path = _dag_path_for(cam_transform)
        quat = _world_quaternion(dag_path)
        try:
            hfov = cmds.camera(cam_transform, query=True, horizontalFieldOfView=True)
        except Exception:
            hfov = 50.0
        payload['camera'] = {
            'position': _world_translation(dag_path),
            'rotation': quat_to_euler_deg(quat),
            'fov': hfov,
        }

    # ── Mesh objects ──
    mesh_transforms = [
        n for n in selection
        if cmds.listRelatives(n, shapes=True, type='mesh', fullPath=True)
    ]
    if mesh_transforms:
        payload['mesh'] = _export_selected_meshes_obj(mesh_transforms)

    if not payload:
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


def show_ui(*_args):
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)

    window = cmds.window(WINDOW_NAME, title=PLUGIN_NAME, widthHeight=(320, 220), sizeable=False)
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

    # ── Tab 2: Blender (stub) ──
    blender_tab = cmds.columnLayout(adjustableColumn=True, rowSpacing=8)
    cmds.text(label="Blender <-> Maya direct connection", align='left', font='boldLabelFont')
    cmds.text(label="Not built yet - coming soon.", align='left')
    cmds.text(label="For now, push through the", align='left')
    cmds.text(label="HDRI Forge Studio tab from both apps.", align='left')
    cmds.setParent('..')  # end blender_tab

    cmds.tabLayout(
        tabs, edit=True,
        tabLabel=((studio_tab, 'HDRI Forge Studio'), (blender_tab, 'Blender')),
    )

    cmds.setParent('..')  # end tabs
    cmds.separator(height=4, style='none')
    cmds.showWindow(window)

    _refresh_status()
    # Keep the selection count fresh whenever Maya's selection changes while
    # this window is open. Tied to the window's lifetime via a scriptJob that
    # kills itself if the window has been closed.
    cmds.scriptJob(event=['SelectionChanged', _on_selection_changed], protected=True)


def _on_selection_changed(*_args):
    if not cmds.window(WINDOW_NAME, exists=True):
        return
    _refresh_selection_count()


# ─── Plug-in registration ───────────────────────────────────────────────────
def initializePlugin(plugin):
    vendor = "HDRI Forge Studio"
    version = "1.0.0"
    plugin_fn = om2.MFnPlugin(plugin, vendor, version)

    if cmds.menu(MENU_NAME, exists=True):
        cmds.deleteUI(MENU_NAME)
    cmds.menu(MENU_NAME, label=PLUGIN_NAME, parent='MayaWindow', tearOff=True)
    cmds.menuItem(label="Open HDRI Forge Bridge", command=show_ui, parent=MENU_NAME)


def uninitializePlugin(plugin):
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)
    if cmds.menu(MENU_NAME, exists=True):
        cmds.deleteUI(MENU_NAME)
