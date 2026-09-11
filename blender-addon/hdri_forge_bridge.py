bl_info = {
    "name":     "HDRI Forge Bridge",
    "author":   "HDRI Forge Studio",
    "version":  (1, 1, 0),
    "blender":  (4, 0, 0),
    "location": "View3D > Sidebar > HDRI Bridge",
    "description": "Push selected Blender objects to HDRI Forge Studio in real time",
    "category": "3D View",
}

import bpy, math, json, base64, tempfile, os, urllib.request, urllib.error
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

# Cached result of the last auto-detect probe, shared by the panel (read-only,
# fast) and the probing/push operators (the only things allowed to update it).
_state = {"url": None, "label": None}


def _probe_one(url, timeout=0.35):
    """GET the bridge endpoint - a real Studio answers 200 with no side effects."""
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


# ── Rotation conversion ────────────────────────────────────────────────────
def convert_rotation_to_euler_deg(q_blender: Quaternion) -> dict:
    """
    Converts a Blender quaternion to Three.js Euler XYZ degrees using the same
    asin/atan2 formula as Three.js's Euler.setFromRotationMatrix, so the
    decomposition matches exactly on the Studio side.
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


# ── Refresh-connection operator ─────────────────────────────────────────────
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


# ── Main push operator ─────────────────────────────────────────────────────
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

        # ── Lights ──
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

        if lights:
            payload['lights'] = lights

        # ── Camera ──
        cam_obj = context.scene.camera
        if cam_obj:
            loc = cam_obj.matrix_world.translation
            q   = cam_obj.matrix_world.to_quaternion()
            rot = convert_rotation_to_euler_deg(q)
            payload['camera'] = {
                'position': {'x': loc.x, 'y': loc.y, 'z': loc.z},
                'rotation': rot,
                'fov':      math.degrees(cam_obj.data.angle),
            }

        # ── World / HDRI ──
        # The Studio only has an RGBELoader wired up (no EXR support yet, a
        # pre-existing gap unrelated to this bridge) - .hdr/.hdri environment
        # textures work; anything else will fail to load on the Studio side
        # with a clear error rather than silently.
        world = context.scene.world
        if world and world.use_nodes:
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

                        payload['world'] = {
                            'fileName': file_name,
                            'dataBase64': base64.b64encode(raw).decode('ascii'),
                            'strength': strength,
                        }
                    except Exception as e:
                        payload['world'] = {'error': f'Could not read HDRI "{img.name}": {e}'}
                    break

        # ── Mesh objects ──
        mesh_objs = [o for o in context.selected_objects if o.type == 'MESH']
        if mesh_objs:
            payload['mesh'] = _export_selected_meshes_glb(context)

        if not payload:
            self.report({'WARNING'}, "Nothing selected to push")
            return {'CANCELLED'}

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

        if prefs.active_tab == 'MAYA':
            box = layout.box()
            box.label(text="Blender <-> Maya direct connection", icon='INFO')
            box.label(text="Not built yet - coming soon.")
            box.label(text="For now, push through the")
            box.label(text="HDRI Forge Studio tab from both apps.")
            return

        sel    = context.selected_objects
        lights = [o for o in sel if o.type == 'LIGHT']
        meshes = [o for o in sel if o.type == 'MESH']

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
    HDRIBRIDGE_OT_push,
    HDRIBRIDGE_PT_panel,
]

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.app.timers.register(_background_probe, first_interval=0.5)

def unregister():
    if bpy.app.timers.is_registered(_background_probe):
        bpy.app.timers.unregister(_background_probe)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)

if __name__ == "__main__":
    register()
