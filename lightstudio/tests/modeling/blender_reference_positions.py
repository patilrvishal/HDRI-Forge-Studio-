import bmesh, json, sys
def cube():
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2.0); bm.faces.ensure_lookup_table(); bm.edges.ensure_lookup_table(); return bm
def verts(bm):
    # map Blender (x, y, z-up) -> app (x, z, -y)
    return sorted([[round(v.co.x, 4), round(v.co.z, 4), round(-v.co.y, 4) + 0.0] for v in bm.verts])
res = {}
def vedge(bm):
    return [e for e in bm.edges if all(abs(v.co.x - 1) < 1e-6 and abs(v.co.y - 1) < 1e-6 for v in e.verts)][0]
for seg in (1, 2, 3):
    bm = cube(); bmesh.ops.bevel(bm, geom=[vedge(bm)], offset=0.2, segments=seg, affect='EDGES', offset_type='OFFSET', profile=0.5)
    res['bevel1_seg%d' % seg] = verts(bm)
bm = cube(); bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.2, segments=1, affect='EDGES', offset_type='OFFSET'); res['bevel_all_seg1'] = verts(bm)
top = max(bm.faces if False else cube().faces, key=lambda f: 0)
bm = cube(); t = max(bm.faces, key=lambda f: f.calc_center_median().z)
bmesh.ops.inset_region(bm, faces=[t], thickness=0.2, depth=0.0, use_even_offset=True, use_boundary=True, use_relative_offset=False); res['inset_top'] = verts(bm)
bm = cube(); t = max(bm.faces, key=lambda f: f.calc_center_median().z)
bmesh.ops.inset_region(bm, faces=[t], thickness=0.2, depth=0.3, use_even_offset=True, use_boundary=True); res['inset_top_depth'] = verts(bm)
# extrude top by 0.5 along normal
bm = cube(); t = max(bm.faces, key=lambda f: f.calc_center_median().z)
r = bmesh.ops.extrude_face_region(bm, geom=[t]); nv = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
bmesh.ops.translate(bm, vec=(0, 0, 0.5), verts=nv); bmesh.ops.delete(bm, geom=[t], context='FACES_ONLY'); res['extrude_top'] = verts(bm)
# loop cut ~ subdivide vertical edges 1 cut
bm = cube(); vert = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1]
bmesh.ops.subdivide_edges(bm, edges=vert, cuts=1, use_grid_fill=True); res['loopcut1'] = verts(bm)
# poke
bm = cube(); bmesh.ops.poke(bm, faces=list(bm.faces), offset=0.0); res['poke'] = verts(bm)
# solidify plane
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
for seg in (2,3):
    bm = cube(); bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.2, segments=seg, affect='EDGES', offset_type='OFFSET', profile=0.5); res['bevel_all_seg%d' % seg] = verts(bm)
open(sys.argv[-1], 'w').write(json.dumps(res))
