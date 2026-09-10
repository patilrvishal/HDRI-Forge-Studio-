bl_info = {
    "name":     "HDRI Forge Bridge",
    "author":   "HDRI Forge Studio",
    "version":  (1, 0, 0),
    "blender":  (4, 0, 0),
    "location": "View3D > Sidebar > HDRI Bridge",
    "description": "Push selected Blender objects to HDRI Forge Studio in real time",
    "category": "3D View",
}

import bpy, math, json, base64, tempfile, os, urllib.request, urllib.error
from mathutils import Quaternion

STUDIO_URL = "http://localhost:5173/__hdri_bridge_push"

# Quaternion that rotates Blender Z-up to Three.js Y-up (-90 deg around X)
_CONV_Q = Quaternion((1, 0, 0), math.radians(-90))
_CONV_Q_INV = _CONV_Q.inverted()


# -- Rotation conversion -----------------------------------------------------
def convert_rotation_to_euler_deg(q_blender: Quaternion) -> dict:
    """
    Converts a Blender quaternion to Three.js Euler XYZ degrees using the same
    asin/atan2 formula as Three.js's Euler.setFromRotationMatrix, so the
    decomposition matches exactly on the Studio side.
    """
    q3 = _CONV_Q @ q_blender @ _CONV_Q_INV
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


# -- Mesh export --------------------------------------------------------------
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
            'fileName': file_name,
            'dataBase64': data,
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


# -- Main push operator --------------------------------------------------------
class HDRIBRIDGE_OT_push(bpy.types.Operator):
    bl_idname = "hdribridge.push"
    bl_label = "Push to HDRI Forge Studio"
    bl_description = "Send selected objects to HDRI Forge Studio"

    def execute(self, context):
        payload = {}

        # -- Lights --
        lights = []
        for obj in context.selected_objects:
            if obj.type != 'LIGHT':
                continue
            ld = obj.data
            loc = obj.matrix_world.translation
            q = obj.matrix_world.to_quaternion()
            rot = convert_rotation_to_euler_deg(q)

            entry = {
                'id': obj.name,
                'name': obj.name,
                'type': ld.type,  # 'POINT', 'SUN', 'SPOT', 'AREA'
                'color': {'r': ld.color.r, 'g': ld.color.g, 'b': ld.color.b},
                'energy': ld.energy,
                'position': {'x': loc.x, 'y': loc.y, 'z': loc.z},
                'rotation': rot,
            }
            if ld.type == 'SPOT':
                entry['spot_size'] = ld.spot_size  # full cone angle, radians
            lights.append(entry)

        if lights:
            payload['lights'] = lights

        # -- Camera --
        cam_obj = context.scene.camera
        if cam_obj:
            loc = cam_obj.matrix_world.translation
            q = cam_obj.matrix_world.to_quaternion()
            rot = convert_rotation_to_euler_deg(q)
            payload['camera'] = {
                'position': {'x': loc.x, 'y': loc.y, 'z': loc.z},
                'rotation': rot,
                'fov': math.degrees(cam_obj.data.angle),
            }

        # -- World / HDRI --
        world = context.scene.world
        if world and world.use_nodes:
            for node in world.node_tree.nodes:
                if node.type == 'TEX_ENVIRONMENT' and node.image:
                    payload['world'] = {'hdri_path': node.image.filepath}
                    break

        # -- Mesh objects --
        mesh_objs = [o for o in context.selected_objects if o.type == 'MESH']
        if mesh_objs:
            payload['mesh'] = _export_selected_meshes_glb(context)

        if not payload:
            self.report({'WARNING'}, "Nothing selected to push")
            return {'CANCELLED'}

        try:
            data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                STUDIO_URL,
                data=data,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
            self.report({'INFO'}, f"Pushed to Studio: {list(payload.keys())}")
        except urllib.error.URLError as e:
            self.report({'ERROR'}, f"Studio unreachable: {e}")
            return {'CANCELLED'}
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}

        return {'FINISHED'}


# -- Panel ----------------------------------------------------------------------
class HDRIBRIDGE_PT_panel(bpy.types.Panel):
    bl_label = "HDRI Forge Bridge"
    bl_idname = "HDRIBRIDGE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "HDRI Bridge"

    def draw(self, context):
        layout = self.layout
        sel = context.selected_objects
        lights = [o for o in sel if o.type == 'LIGHT']
        meshes = [o for o in sel if o.type == 'MESH']

        layout.label(text=f"Selected: {len(lights)} lights, {len(meshes)} meshes")
        layout.operator("hdribridge.push", icon='EXPORT')
        layout.separator()
        layout.label(text=f"Target: {STUDIO_URL}", icon='URL')


# -- Registration -----------------------------------------------------------
classes = [HDRIBRIDGE_OT_push, HDRIBRIDGE_PT_panel]

def register():
    for cls in classes:
        bpy.utils.register_class(cls)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)

if __name__ == "__main__":
    register()
