bl_info = {
    "name":     "HDRI Forge Bridge",
    "author":   "HDRI Forge Studio",
    "version":  (1, 2, 0),
    "blender":  (4, 0, 0),
    "location": "View3D > Sidebar > HDRI Bridge",
    "description": "Push selected Blender objects to HDRI Forge Studio in real time",
    "category": "3D View",
}

import bpy, math, json, base64, tempfile, os, time, threading
import urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from mathutils import Quaternion
from bpy.props import StringProperty, BoolProperty, EnumProperty

# Dev server (npm run dev) listens on 5173; the installed desktop app's own
# listener (src-tauri/src/lib.rs) listens on 8973 - kept distinct so both
# can run at once without colliding. The addon auto-detects whichever one is
# actually running, so nobody has to know these numbers exist.
DEV_SERVER_URL = "http://localhost:5173/__hdri_bridge_push"
DESKTOP_APP_URL = "http://localhost:8973/__hdri_bridge_push"
CANDIDATES = [
    (DESKTOP_APP_URL, "Desktop App"),
    (DEV_SERVER_URL, "Dev Server"),
]

# Direct Blender <-> Maya bridge (bypasses the Studio entirely). Each DCC
# runs its own tiny listener; Blender's is BLENDER_RECEIVE_PORT, Maya's is
# MAYA_RECEIVE_PORT - distinct from the Studio's ports so all three can run
# at once without colliding.
BLENDER_RECEIVE_PORT = 8975
MAYA_RECEIVE_PORT = 8976
MAYA_DIRECT_URL = f"http://localhost:{MAYA_RECEIVE_PORT}/__hdri_bridge_push"
BRIDGE_PATH = "/__hdri_bridge_push"

# Cached result of the last auto-detect probe, shared by the panel (read-only,
# fast) and the probing/push operators (the only things allowed to update it).
_state = {"url": None, "label": None}
_direct_state = {"maya_connected": False, "last_received": None}


def _probe_one(url, timeout=0.35):
    """GET the bridge endpoint - a real listener answers 200 with no side effects."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def probe_studio():
    """Check both known endpoints and cache whichever answers first (desktop app preferred)."""
    for url, label in CANDIDATES:
        if _probe_one(url):
            _state["url"] = url
            _state["label"] = label
            return True
    _state["url"] = None
    _state["label"] = None
    return False


def probe_maya():
    _direct_state["maya_connected"] = _probe_one(MAYA_DIRECT_URL)
    return _direct_state["maya_connected"]


def get_studio_url(context):
    prefs = context.preferences.addons[__name__].preferences
    if not prefs.auto_detect and prefs.manual_url:
        return prefs.manual_url
    return _state["url"]


class HDRIBRIDGE_AddonPreferences(bpy.types.AddonPreferences):
    bl_idname = __name__

    auto_detect: BoolProperty(
        name="Auto-detect Studio",
        description="Automatically find whichever HDRI Forge Studio is running "
                    "(desktop app or dev server). Turn off to set the address manually.",
        default=True,
    )
    manual_url: StringProperty(
        name="Manual Studio URL",
        description="Only used when Auto-detect is off",
        default=DESKTOP_APP_URL,
    )
    active_tab: EnumProperty(
        name="Tab",
        items=[
            ('STUDIO', "HDRI Forge Studio", "Push selected objects to HDRI Forge Studio"),
            ('MAYA', "Maya", "Direct Blender <-> Maya connection"),
        ],
        default='STUDIO',
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "auto_detect")
        col = layout.column()
        col.enabled = not self.auto_detect
        col.prop(self, "manual_url")


# ─── Auto-detect on load, then keep it fresh in the background ─────────────
def _background_probe():
    probe_studio()
    probe_maya()
    for area in getattr(bpy.context, 'screen', None).areas if bpy.context.screen else []:
        area.tag_redraw()
    return 4.0  # reschedule every 4s - cheap (one GET, ~0.35s worst case) and keeps status live


# Quaternion that re-expresses a Blender (Z-up) orientation in Three.js's
# (Y-up) world. This is a left-compose, NOT a conjugation/sandwich - an
# "unrotated" object already points a different physical direction in each
# engine (Blender's local -Z is world-down in a Z-up world; Three.js's local
# -Z is horizontal in a Y-up world), so conjugating (which only re-expresses
# a rotation in a new world basis) can't fix that mismatch - composing does.
# Verified against Blender's own ground-truth forward vector
# (cam.matrix_world @ Vector((0,0,-1))), not just internal round-trips.
_CONV_Q = Quaternion((1, 0, 0), math.radians(-90))
_CONV_Q_INV = _CONV_Q.inverted()

# Maya is already Y-up like Three.js, so the "Three-frame" position/rotation
# the Studio uses and the position/rotation Maya's own bridge sends are the
# same frame - the direct bridge reuses that fact both ways.


# ── Rotation conversion (outgoing: Blender -> Three/Maya frame) ────────────
def convert_rotation_to_euler_deg(q_blender: Quaternion) -> dict:
    """
    Converts a Blender quaternion to Three.js Euler XYZ degrees using the same
    asin/atan2 formula as Three.js's Euler.setFromRotationMatrix, so the
    decomposition matches exactly on the Studio side (and, since Maya shares
    the same Y-up frame, on the direct Maya bridge too).
    """
    q3 = _CONV_Q @ q_blender
    m = q3.to_matrix()
    m11, m12, m13 = m[0][0], m[0][1], m[0][2]
    m21, m22, m23 = m[1][0], m[1][1], m[1][2]
    m31, m32, m33 = m[2][0], m[2][1], m[2][2]

    y = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        x = math.atan2(-m23, m33)
        z = math.atan2(-m12, m11)
    else:
        x = math.atan2(m32, m22)
        z = 0.0

    return {
        'x': round(math.degrees(x), 4),
        'y': round(math.degrees(y), 4),
        'z': round(math.degrees(z), 4),
    }


# ── Rotation conversion (incoming: Three/Maya frame -> Blender quaternion) ─
def _three_euler_deg_to_quat(rx, ry, rz) -> Quaternion:
    """Three.js Quaternion.setFromEuler for order 'XYZ', hand-implemented
    (not via mathutils' own Euler, whose convention isn't guaranteed to
    match) - this exact formula was verified against Maya's own ground
    truth (dot=1.0 across 7 rotation cases) while building the Maya-side
    bridge, so reusing it here keeps both directions on the same math."""
    ex, ey, ez = math.radians(rx), math.radians(ry), math.radians(rz)
    cx, sx = math.cos(ex / 2), math.sin(ex / 2)
    cy, sy = math.cos(ey / 2), math.sin(ey / 2)
    cz, sz = math.cos(ez / 2), math.sin(ez / 2)
    qx = sx * cy * cz + cx * sy * sz
    qy = cx * sy * cz - sx * cy * sz
    qz = cx * cy * sz + sx * sy * cz
    qw = cx * cy * cz - sx * sy * sz
    return Quaternion((qw, qx, qy, qz))  # mathutils order is (w, x, y, z)


def _three_frame_to_blender_quat(rx, ry, rz) -> Quaternion:
    q_three = _three_euler_deg_to_quat(rx, ry, rz)
    return _CONV_Q_INV @ q_three


def _three_pos_to_blender(p) -> tuple:
    """Inverse of the outgoing toThreePos('blender') = (bx, bz, -by)."""
    return (p.get('x', 0.0), -p.get('z', 0.0), p.get('y', 0.0))


# ── Gather helpers (shared by push-to-Studio and push-to-Maya) ─────────────
def _gather_lights(context):
    lights = []
    for obj in context.selected_objects:
        if obj.type != 'LIGHT':
            continue
        ld  = obj.data
        loc = obj.matrix_world.translation
        q   = obj.matrix_world.to_quaternion()
        rot = convert_rotation_to_euler_deg(q)

        entry = {
            'id':       obj.name,
            'name':     obj.name,
            'type':     ld.type,          # 'POINT','SUN','SPOT','AREA'
            'color':    {'r': ld.color.r, 'g': ld.color.g, 'b': ld.color.b},
            'energy':   ld.energy,
            'position': {'x': loc.x, 'y': loc.y, 'z': loc.z},
            'rotation': rot,
        }
        if ld.type == 'SPOT':
            entry['spot_size'] = ld.spot_size   # full cone angle in radians
        lights.append(entry)
    return lights


def _gather_camera(cam_obj):
    loc = cam_obj.matrix_world.translation
    q   = cam_obj.matrix_world.to_quaternion()
    rot = convert_rotation_to_euler_deg(q)
    return {
        'position': {'x': loc.x, 'y': loc.y, 'z': loc.z},
        'rotation': rot,
        'fov':      math.degrees(cam_obj.data.angle),
    }


def _gather_world(context):
    # The Studio only has an RGBELoader wired up (no EXR support yet, a
    # pre-existing gap unrelated to this bridge) - .hdr/.hdri environment
    # textures work; anything else will fail to load on the receiving side
    # with a clear error rather than silently.
    world = context.scene.world
    if not (world and world.use_nodes):
        return None
    for node in world.node_tree.nodes:
        if node.type == 'TEX_ENVIRONMENT' and node.image:
            img = node.image
            try:
                if img.packed_file:
                    raw = img.packed_file.data
                else:
                    with open(bpy.path.abspath(img.filepath), 'rb') as f:
                        raw = f.read()

                file_name = os.path.basename(img.filepath) if img.filepath else img.name
                if not os.path.splitext(file_name)[1]:
                    file_name += '.hdr'

                strength = 1.0
                bg_node = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
                if bg_node:
                    strength = bg_node.inputs['Strength'].default_value

                return {
                    'fileName': file_name,
                    'dataBase64': base64.b64encode(raw).decode('ascii'),
                    'strength': strength,
                }
            except Exception as e:
                return {'error': f'Could not read HDRI "{img.name}": {e}'}
    return None


# ── Mesh export ────────────────────────────────────────────────────────────
def _export_selected_meshes_glb(context) -> dict:
    """
    Export currently selected mesh objects to a temporary GLB file.
    Returns {'fileName': ..., 'dataBase64': ..., 'objectNames': [...]}
    or {'error': ...} on failure.
    """
    selected = [o for o in context.selected_objects if o.type == 'MESH']
    if not selected:
        return {'error': 'No mesh objects selected'}

    prev_active = context.view_layer.objects.active
    prev_selected = {o: o.select_get() for o in context.scene.objects}
    tmp_path = None

    try:
        for o in context.scene.objects:
            o.select_set(False)
        for o in selected:
            o.select_set(True)
        context.view_layer.objects.active = selected[0]

        with tempfile.NamedTemporaryFile(suffix='.glb', delete=False) as tf:
            tmp_path = tf.name

        bpy.ops.export_scene.gltf(
            filepath=tmp_path,
            use_selection=True,
            export_format='GLB',
            export_yup=True,    # Handles Z-up -> Y-up for meshes
            export_apply=True,  # Apply modifiers/transforms
            export_animations=False,
        )

        with open(tmp_path, 'rb') as f:
            data = base64.b64encode(f.read()).decode('ascii')

        file_name = '_'.join(o.name for o in selected[:3]) + '.glb'
        return {
            'fileName':    file_name,
            'dataBase64':  data,
            'objectNames': [o.name for o in selected],
        }
    except Exception as e:
        return {'error': str(e)}
    finally:
        for o, sel in prev_selected.items():
            o.select_set(sel)
        context.view_layer.objects.active = prev_active
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _export_selected_meshes_obj(context) -> dict:
    """
    Same as _export_selected_meshes_glb but writes OBJ instead - Maya has no
    native glTF importer, but OBJ import is always available, so the direct
    Maya bridge uses this format instead of the Studio's GLB.
    """
    selected = [o for o in context.selected_objects if o.type == 'MESH']
    if not selected:
        return {'error': 'No mesh objects selected'}

    prev_active = context.view_layer.objects.active
    prev_selected = {o: o.select_get() for o in context.scene.objects}
    tmp_path = None

    try:
        for o in context.scene.objects:
            o.select_set(False)
        for o in selected:
            o.select_set(True)
        context.view_layer.objects.active = selected[0]

        with tempfile.NamedTemporaryFile(suffix='.obj', delete=False) as tf:
            tmp_path = tf.name

        if hasattr(bpy.ops.wm, 'obj_export'):
            bpy.ops.wm.obj_export(filepath=tmp_path, export_selected_objects=True)
        else:
            bpy.ops.export_scene.obj(filepath=tmp_path, use_selection=True)

        with open(tmp_path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
        data = base64.b64encode(text.encode('utf-8')).decode('ascii')

        file_name = '_'.join(o.name for o in selected[:3]) + '.obj'
        return {
            'fileName':    file_name,
            'dataBase64':  data,
            'objectNames': [o.name for o in selected],
            'format':      'obj',
        }
    except Exception as e:
        return {'error': str(e)}
    finally:
        for o, sel in prev_selected.items():
            o.select_set(sel)
        context.view_layer.objects.active = prev_active
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ── Apply an incoming payload from Maya directly into the Blender scene ────
MAYA_TYPE_TO_BLENDER = {'POINT': 'POINT', 'SPOT': 'SPOT', 'SUN': 'SUN', 'AREA': 'AREA'}


def _apply_payload_from_maya(payload):
    context = bpy.context

    # ── Lights ──
    for entry in payload.get('lights', []):
        name = f"MayaBridge_{entry.get('id', entry.get('name', 'Light'))}"
        light_type = MAYA_TYPE_TO_BLENDER.get(entry.get('type', 'POINT'), 'POINT')
        obj = bpy.data.objects.get(name)
        if obj is None:
            ld = bpy.data.lights.new(name, type=light_type)
            obj = bpy.data.objects.new(name, ld)
            context.scene.collection.objects.link(obj)
        else:
            ld = obj.data
            if ld.type != light_type:
                ld.type = light_type

        color = entry.get('color', {})
        ld.color = (color.get('r', 1.0), color.get('g', 1.0), color.get('b', 1.0))
        ld.energy = entry.get('energy', 1000.0)

        obj.location = _three_pos_to_blender(entry.get('position', {}))
        rot = entry.get('rotation', {})
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = _three_frame_to_blender_quat(
            rot.get('x', 0), rot.get('y', 0), rot.get('z', 0)
        )

        if light_type == 'SPOT' and 'spot_size' in entry:
            ld.spot_size = entry['spot_size']  # radians, full cone angle - same field on both sides

    # ── Camera ──
    cam_data = payload.get('camera')
    if cam_data:
        name = "MayaBridge_Camera"
        obj = bpy.data.objects.get(name)
        if obj is None:
            cd = bpy.data.cameras.new(name)
            obj = bpy.data.objects.new(name, cd)
            context.scene.collection.objects.link(obj)
        else:
            cd = obj.data

        obj.location = _three_pos_to_blender(cam_data.get('position', {}))
        rot = cam_data.get('rotation', {})
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = _three_frame_to_blender_quat(
            rot.get('x', 0), rot.get('y', 0), rot.get('z', 0)
        )

        fov = cam_data.get('fov')
        if fov:
            cd.lens_unit = 'FOV'
            cd.angle = math.radians(fov)

        context.scene.camera = obj

    # ── Mesh objects (Maya sends OBJ, one 'g <name>' group per object) ──
    mesh_data = payload.get('mesh')
    if mesh_data and mesh_data.get('dataBase64'):
        raw = base64.b64decode(mesh_data['dataBase64'])
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.obj', delete=False) as tf:
                tf.write(raw)
                tmp_path = tf.name

            group = bpy.data.objects.get("MayaBridge_Meshes")
            if group is None:
                group = bpy.data.objects.new("MayaBridge_Meshes", None)
                context.scene.collection.objects.link(group)

            before = set(context.scene.objects)
            if hasattr(bpy.ops.wm, 'obj_import'):
                # use_split_groups: Maya's OBJ export writes each selected
                # object as its own 'g <name>' group (not 'o') - without
                # this flag Blender's importer merges every group in the
                # file into one object (verified empirically).
                bpy.ops.wm.obj_import(filepath=tmp_path, use_split_groups=True)
            else:
                bpy.ops.import_scene.obj(filepath=tmp_path)
            after = set(context.scene.objects)

            for obj in (after - before):
                final_name = f"MayaBridge_{obj.name}"
                existing = bpy.data.objects.get(final_name)
                if existing and existing != obj:
                    # Same name already exists - swap geometry in place so
                    # repeated pushes update the same object instead of
                    # piling up new ones each time.
                    old_data = existing.data
                    existing.data = obj.data
                    bpy.data.objects.remove(obj, do_unlink=True)
                    if old_data and old_data.users == 0:
                        bpy.data.meshes.remove(old_data)
                else:
                    obj.name = final_name
                    obj['_mayabridge_mesh'] = True
                    obj.parent = group
                    obj.matrix_parent_inverse = group.matrix_world.inverted()
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

    # ── World / HDRI ──
    world_data = payload.get('world')
    if world_data and world_data.get('dataBase64') and 'error' not in world_data:
        raw = base64.b64decode(world_data['dataBase64'])
        file_name = world_data.get('fileName', 'MayaBridge_World.hdr')
        tmp_path = os.path.join(tempfile.gettempdir(), f"mayabridge_{file_name}")
        with open(tmp_path, 'wb') as f:
            f.write(raw)

        img_name = "MayaBridge_World"
        old_img = bpy.data.images.get(img_name)
        if old_img:
            bpy.data.images.remove(old_img)
        img = bpy.data.images.load(tmp_path)
        img.name = img_name

        world = context.scene.world
        if world is None:
            world = bpy.data.worlds.new("World")
            context.scene.world = world
        world.use_nodes = True
        nt = world.node_tree
        env_node = next((n for n in nt.nodes if n.type == 'TEX_ENVIRONMENT'), None)
        if env_node is None:
            env_node = nt.nodes.new('ShaderNodeTexEnvironment')
        env_node.image = img

        bg_node = next((n for n in nt.nodes if n.type == 'BACKGROUND'), None)
        if bg_node:
            bg_node.inputs['Strength'].default_value = world_data.get('strength', 1.0)
            if not bg_node.inputs['Color'].is_linked:
                nt.links.new(env_node.outputs['Color'], bg_node.inputs['Color'])


# ── Direct-bridge listener (receives pushes from Maya) ─────────────────────
_pending_direct_payload = {"data": None}
_direct_server = {"httpd": None, "thread": None}


def _consume_pending_direct_payload():
    payload = _pending_direct_payload["data"]
    _pending_direct_payload["data"] = None
    if payload is not None:
        try:
            _apply_payload_from_maya(payload)
            _direct_state["last_received"] = time.time()
        except Exception as e:
            print(f"[HDRI Forge Bridge] Error applying push from Maya: {e}")
        for area in getattr(bpy.context, 'screen', None).areas if bpy.context.screen else []:
            area.tag_redraw()
    return None  # one-shot, don't reschedule


class _DirectBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # keep Blender's console quiet - errors are still reported via print()

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == BRIDGE_PATH:
            self._send_json(200, {'ok': True, 'app': 'Blender', 'mode': 'blender'})
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

        _pending_direct_payload["data"] = payload
        # bpy.app.timers.register is explicitly documented as safe to call
        # from a background thread - this is how work gets handed back to
        # Blender's main thread, which all bpy/data API calls require.
        bpy.app.timers.register(_consume_pending_direct_payload, first_interval=0.0)
        self._send_json(200, {'ok': True})


def _start_direct_server():
    if _direct_server["httpd"] is not None:
        return
    try:
        httpd = HTTPServer(('127.0.0.1', BLENDER_RECEIVE_PORT), _DirectBridgeHandler)
    except OSError as e:
        print(f"[HDRI Forge Bridge] Could not start direct-bridge listener on port {BLENDER_RECEIVE_PORT}: {e}")
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


# ── Refresh-connection operators ────────────────────────────────────────────
class HDRIBRIDGE_OT_refresh(bpy.types.Operator):
    bl_idname = "hdribridge.refresh"
    bl_label = "Refresh Connection"
    bl_description = "Check for a running HDRI Forge Studio"

    def execute(self, context):
        found = probe_studio()
        if found:
            self.report({'INFO'}, f"Connected: {_state['label']}")
        else:
            self.report({'WARNING'}, "No HDRI Forge Studio found running")
        for area in context.screen.areas:
            area.tag_redraw()
        return {'FINISHED'}


class HDRIBRIDGE_OT_refresh_maya(bpy.types.Operator):
    bl_idname = "hdribridge.refresh_maya"
    bl_label = "Refresh Maya Connection"
    bl_description = "Check for Maya running with the HDRI Forge Bridge plugin loaded"

    def execute(self, context):
        found = probe_maya()
        if found:
            self.report({'INFO'}, "Connected to Maya")
        else:
            self.report({'WARNING'}, "No Maya bridge listener found")
        for area in context.screen.areas:
            area.tag_redraw()
        return {'FINISHED'}


# ── Main push operator (to Studio) ──────────────────────────────────────────
class HDRIBRIDGE_OT_push(bpy.types.Operator):
    bl_idname  = "hdribridge.push"
    bl_label   = "Push to HDRI Forge Studio"
    bl_description = "Send selected objects to HDRI Forge Studio"

    def execute(self, context):
        prefs = context.preferences.addons[__name__].preferences
        if prefs.auto_detect:
            # Always re-probe right before sending, rather than trusting the
            # background timer's last result - it can go stale (e.g. the
            # Desktop App was restarted since the last 4s tick) and silently
            # send the push to the wrong target.
            probe_studio()
        studio_url = get_studio_url(context)
        if not studio_url:
            self.report({'ERROR'}, "No HDRI Forge Studio found running - open the app or start the dev server")
            return {'CANCELLED'}

        payload = {'source': 'blender'}

        lights = _gather_lights(context)
        if lights:
            payload['lights'] = lights

        cam_obj = context.scene.camera
        if cam_obj:
            payload['camera'] = _gather_camera(cam_obj)

        world = _gather_world(context)
        if world:
            payload['world'] = world

        mesh_objs = [o for o in context.selected_objects if o.type == 'MESH']
        if mesh_objs:
            payload['mesh'] = _export_selected_meshes_glb(context)

        try:
            data = json.dumps(payload).encode('utf-8')
            req  = urllib.request.Request(
                studio_url,
                data    = data,
                headers = {'Content-Type': 'application/json'},
                method  = 'POST',
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
            self.report({'INFO'}, f"Pushed to {_state['label'] or 'Studio'}: {list(payload.keys())}")
        except urllib.error.URLError as e:
            _state["url"] = None
            _state["label"] = None
            self.report({'ERROR'}, f"Studio unreachable: {e}")
            return {'CANCELLED'}
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}

        return {'FINISHED'}


# ── Push operator (direct to Maya) ──────────────────────────────────────────
class HDRIBRIDGE_OT_push_to_maya(bpy.types.Operator):
    bl_idname = "hdribridge.push_to_maya"
    bl_label = "Push to Maya"
    bl_description = "Send selected objects directly to Maya (bypasses HDRI Forge Studio)"

    def execute(self, context):
        # Always re-probe right before sending - same stale-cache class of
        # bug already fixed on the Studio-facing push.
        probe_maya()
        if not _direct_state["maya_connected"]:
            self.report({'ERROR'}, "No Maya bridge listener found - open Maya with the HDRI Forge Bridge plugin loaded")
            return {'CANCELLED'}

        payload = {'source': 'blender'}

        lights = _gather_lights(context)
        if lights:
            payload['lights'] = lights

        cam_obj = context.scene.camera
        if cam_obj:
            payload['camera'] = _gather_camera(cam_obj)

        world = _gather_world(context)
        if world:
            payload['world'] = world

        mesh_objs = [o for o in context.selected_objects if o.type == 'MESH']
        if mesh_objs:
            payload['mesh'] = _export_selected_meshes_obj(context)

        try:
            data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                MAYA_DIRECT_URL,
                data=data,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
            self.report({'INFO'}, f"Pushed to Maya: {list(payload.keys())}")
        except urllib.error.URLError as e:
            _direct_state["maya_connected"] = False
            self.report({'ERROR'}, f"Maya unreachable: {e}")
            return {'CANCELLED'}
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}

        return {'FINISHED'}


# ── Panel ──────────────────────────────────────────────────────────────────
class HDRIBRIDGE_PT_panel(bpy.types.Panel):
    bl_label       = "HDRI Forge Bridge"
    bl_idname      = "HDRIBRIDGE_PT_panel"
    bl_space_type  = "VIEW_3D"
    bl_region_type = "UI"
    bl_category    = "HDRI Bridge"

    def draw(self, context):
        layout = self.layout
        prefs = context.preferences.addons[__name__].preferences

        tabs = layout.row(align=True)
        tabs.prop(prefs, "active_tab", expand=True)
        layout.separator()

        sel    = context.selected_objects
        lights = [o for o in sel if o.type == 'LIGHT']
        meshes = [o for o in sel if o.type == 'MESH']

        if prefs.active_tab == 'MAYA':
            row = layout.row(align=True)
            if _direct_state["maya_connected"]:
                row.label(text="Connected — Maya", icon='CHECKMARK')
            else:
                row.label(text="Not connected", icon='X')
            row.operator("hdribridge.refresh_maya", text="", icon='FILE_REFRESH')

            box = layout.box()
            box.label(text=f"Listening for Maya on port {BLENDER_RECEIVE_PORT}", icon='INFO')
            if _direct_state["last_received"]:
                age = time.time() - _direct_state["last_received"]
                box.label(text=f"Last push received {age:.0f}s ago")
            else:
                box.label(text="No push received yet")

            layout.separator()
            layout.label(text=f"Selected: {len(lights)} lights, {len(meshes)} meshes")
            layout.operator("hdribridge.push_to_maya", icon='EXPORT')
            return

        row = layout.row(align=True)
        if _state["url"]:
            row.label(text=f"Connected — {_state['label']}", icon='CHECKMARK')
        else:
            row.label(text="Not connected", icon='X')
        row.operator("hdribridge.refresh", text="", icon='FILE_REFRESH')

        layout.separator()
        layout.label(text=f"Selected: {len(lights)} lights, {len(meshes)} meshes")
        layout.operator("hdribridge.push", icon='EXPORT')


# ── Registration ───────────────────────────────────────────────────────────
classes = [
    HDRIBRIDGE_AddonPreferences,
    HDRIBRIDGE_OT_refresh,
    HDRIBRIDGE_OT_refresh_maya,
    HDRIBRIDGE_OT_push,
    HDRIBRIDGE_OT_push_to_maya,
    HDRIBRIDGE_PT_panel,
]

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.app.timers.register(_background_probe, first_interval=0.5)
    _start_direct_server()

def unregister():
    _stop_direct_server()
    if bpy.app.timers.is_registered(_background_probe):
        bpy.app.timers.unregister(_background_probe)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)

if __name__ == "__main__":
    register()
