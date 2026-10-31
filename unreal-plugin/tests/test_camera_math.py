"""
Camera maths of the Unreal bridge, checked against three.js's own rotation conventions without needing Unreal.

Run:  python -m unittest discover -s unreal-plugin/tests -v
"""
import math
import os
import sys
import types
import unittest

# The bridge imports `unreal` at module level; the maths under test does not touch it.
sys.modules.setdefault("unreal", types.ModuleType("unreal"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "HDRIForgeBridge", "Content", "Python"))
import hdri_forge_bridge_unreal as b  # noqa: E402


class V(object):
    def __init__(self, x, y, z):
        self.x, self.y, self.z = x, y, z


def basis_for_yaw(deg):
    """Unreal axes (X forward, Y right, Z up) of a camera turned `deg` clockwise seen from above."""
    a = math.radians(deg)
    fwd = V(math.cos(a), math.sin(a), 0)
    right = V(-math.sin(a), math.cos(a), 0)
    return right, V(0, 0, 1), fwd


def apply_euler_xyz(e, v):
    """three.js Euler XYZ (degrees) applied to a vector: R = Rx * Ry * Rz."""
    x, y, z = (math.radians(e[k]) for k in ("x", "y", "z"))
    # Rz
    vx, vy, vz = v
    vx, vy = vx * math.cos(z) - vy * math.sin(z), vx * math.sin(z) + vy * math.cos(z)
    # Ry
    vx, vz = vx * math.cos(y) + vz * math.sin(y), -vx * math.sin(y) + vz * math.cos(y)
    # Rx
    vy, vz = vy * math.cos(x) - vz * math.sin(x), vy * math.sin(x) + vz * math.cos(x)
    return (vx, vy, vz)


class CameraMathTests(unittest.TestCase):
    def test_axes_map_to_forge(self):
        # forward (+X) -> -Z, right (+Y) -> +X, up (+Z) -> +Y
        self.assertEqual(b._forge_vec(V(1, 0, 0)), (0, 0, -1))
        self.assertEqual(b._forge_vec(V(0, 1, 0)), (1, 0, 0))
        self.assertEqual(b._forge_vec(V(0, 0, 1)), (0, 1, 0))

    def test_default_camera_has_no_rotation(self):
        r, u, f = basis_for_yaw(0)
        e = b.rotation_to_euler_deg(r, u, f)
        for k in "xyz":
            self.assertAlmostEqual(e[k], 0.0, places=6)

    def test_euler_reproduces_the_camera_direction(self):
        # For any camera turn, the three.js Euler must rotate three's "forward" (-Z) onto the converted forward.
        for yaw in (-170, -90, -30, 0, 45, 90, 135, 180):
            r, u, f = basis_for_yaw(yaw)
            e = b.rotation_to_euler_deg(r, u, f)
            got = apply_euler_xyz(e, (0, 0, -1))
            want = b._forge_vec(f)
            for g, w in zip(got, want):
                self.assertAlmostEqual(g, w, places=6, msg="yaw %s" % yaw)
            up = apply_euler_xyz(e, (0, 1, 0))
            for g, w in zip(up, b._forge_vec(u)):
                self.assertAlmostEqual(g, w, places=6, msg="yaw %s (up)" % yaw)

    def test_quarter_turn_right_is_minus_ninety_about_y(self):
        r, u, f = basis_for_yaw(90)
        self.assertAlmostEqual(b.rotation_to_euler_deg(r, u, f)["y"], -90.0, places=6)

    def test_pitched_camera(self):
        # Looking 30 degrees up while facing +X.
        p = math.radians(30)
        f = V(math.cos(p), 0, math.sin(p))
        u = V(-math.sin(p), 0, math.cos(p))
        r = V(0, 1, 0)
        e = b.rotation_to_euler_deg(r, u, f)
        got = apply_euler_xyz(e, (0, 0, -1))
        for g, w in zip(got, b._forge_vec(f)):
            self.assertAlmostEqual(g, w, places=6)

    def test_camera_dict_is_in_metres(self):
        r, u, f = basis_for_yaw(0)
        c = b._camera_dict("id", "Cam", V(1000, 200, 150), r, u, f, 40.0)
        self.assertAlmostEqual(c["position"]["x"], 2.0)      # Y_u 200 cm
        self.assertAlmostEqual(c["position"]["y"], 1.5)      # Z_u 150 cm
        self.assertAlmostEqual(c["position"]["z"], -10.0)    # -X_u 1000 cm
        self.assertEqual(c["fov"], 40.0)


if __name__ == "__main__":
    unittest.main()
