// LightPaint: what a click can hit, and that the solved light really reflects at the clicked point.
// Run: npm run test:paint
import * as THREE from 'three';
import { PaintPicker, isPaintable } from '../../src/three/PaintPicker';
import { solveLightPaint } from '../../src/three/LightPaint';

let failed = 0;
function check(ok: boolean, msg: string): void {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + msg);
  if (!ok) failed++;
}

function sphere(radius = 1, seg = 64): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg / 2), new THREE.MeshStandardMaterial());
  m.updateMatrixWorld(true);
  return m;
}
const rayTo = (from: THREE.Vector3, to: THREE.Vector3): THREE.Ray => new THREE.Ray(from.clone(), to.clone().sub(from).normalize());
const cam = new THREE.Vector3(5, 3, 5);

function main(): void {
  // ── What can be clicked ───────────────────────────────────────
  {
    const scene = new THREE.Scene();
    const car = sphere(1);
    scene.add(car);
    const hidden = sphere(1.5);                     // a hidden variant in front of the car
    hidden.visible = false;
    scene.add(hidden);
    const hiddenParent = new THREE.Group();
    hiddenParent.visible = false;
    const nested = sphere(1.4);
    hiddenParent.add(nested);
    scene.add(hiddenParent);
    const helper = sphere(1.3);
    helper.userData.isHelper = true;
    scene.add(helper);
    const proxy = sphere(1.2);
    proxy.userData.isProxy = true;
    scene.add(proxy);
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 }));
    scene.add(ghost);
    scene.updateMatrixWorld(true);

    const picker = new PaintPicker();
    picker.refresh(scene);
    check(picker.count === 1, `only the visible car is paintable (${picker.count} meshes: hidden, nested-hidden, helper, proxy and fully transparent are ignored)`);
    const hit = picker.pick(rayTo(cam, new THREE.Vector3(0, 0, 0)));
    check(!!hit && hit.object === car, 'a click goes through hidden/helper meshes to the car behind them');
    check(isPaintable(car) && !isPaintable(hidden) && !isPaintable(helper) && !isPaintable(proxy), 'isPaintable agrees');
  }

  // ── Accuracy of the hit ───────────────────────────────────────
  {
    const scene = new THREE.Scene();
    const m = sphere(1, 128);
    scene.add(m);
    const picker = new PaintPicker();
    picker.refresh(scene);
    let worstPoint = 0, worstNormal = 0, n = 0;
    for (let i = 0; i < 200; i++) {
      const target = new THREE.Vector3(Math.sin(i) * 0.8, Math.cos(i * 1.7) * 0.8, Math.sin(i * 0.37) * 0.5);
      const ray = rayTo(cam, target);
      const hit = picker.pick(ray);
      if (!hit) continue;
      n++;
      worstPoint = Math.max(worstPoint, Math.abs(hit.point.length() - 1));            // on the unit sphere
      worstNormal = Math.max(worstNormal, 1 - hit.normal.dot(hit.point.clone().normalize()));
      if (hit.normal.dot(ray.direction) > 0) worstNormal = 1;                         // must face the viewer
    }
    check(n > 150 && worstPoint < 0.005, `hit points sit on the surface (worst ${worstPoint.toExponential(1)} over ${n} picks)`);
    check(worstNormal < 1e-3, `smooth normals match the true sphere normal and face the viewer (worst ${worstNormal.toExponential(1)})`);
  }

  // ── Non-uniform scale: the normal must use the inverse transpose ─
  {
    const scene = new THREE.Scene();
    const m = sphere(1, 128);
    m.scale.set(3, 1, 1);
    m.updateMatrixWorld(true);
    scene.add(m);
    const picker = new PaintPicker();
    picker.refresh(scene);
    const hit = picker.pick(rayTo(new THREE.Vector3(2, 4, 6), new THREE.Vector3(1.6, 0.5, 0.2)));
    if (!hit) {
      check(false, 'ray hits the stretched sphere');
    } else {
      // Ellipsoid x^2/9 + y^2 + z^2 = 1: normal is proportional to (x/9, y, z).
      const expected = new THREE.Vector3(hit.point.x / 9, hit.point.y, hit.point.z).normalize();
      check(expected.dot(hit.normal) > 0.999, `normals stay correct under non-uniform scale (cos ${expected.dot(hit.normal).toFixed(5)})`);
    }
  }

  // ── Reflection: the light really mirrors the view ray at the clicked point ──
  {
    const scene = new THREE.Scene();
    scene.add(sphere(1, 128));
    const picker = new PaintPicker();
    picker.refresh(scene);
    let worst = 1;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.copy(cam);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (let i = 0; i < 60; i++) {
      const target = new THREE.Vector3(Math.sin(i * 2.1) * 0.7, Math.cos(i * 1.3) * 0.7, Math.sin(i * 0.9) * 0.4);
      const ray = rayTo(cam, target);
      const hit = picker.pick(ray);
      if (!hit) continue;
      const res = solveLightPaint('reflection', hit.point, hit.normal, camera, new THREE.Vector3(), 2.5, undefined, ray.direction);
      const toLight = res.position.clone().sub(hit.point).normalize();
      const reflected = ray.direction.clone().sub(hit.normal.clone().multiplyScalar(2 * ray.direction.dot(hit.normal))).normalize();
      worst = Math.min(worst, toLight.dot(reflected));
    }
    check(worst > 0.99999, `the painted light sits exactly along the mirrored view ray (worst cos ${worst.toFixed(7)})`);

    // Orthographic camera: the cursor ray is parallel, "point minus camera position" would be wrong.
    const ortho = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    ortho.position.set(5, 3, 5);
    ortho.lookAt(0, 0, 0);
    ortho.updateMatrixWorld();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ortho.quaternion);
    const origin = new THREE.Vector3(0.3, 0.2, 0).applyMatrix4(ortho.matrixWorld);
    const ray = new THREE.Ray(origin, dir);
    const hit = picker.pick(ray);
    if (!hit) {
      check(false, 'orthographic ray hits the sphere');
    } else {
      const res = solveLightPaint('reflection', hit.point, hit.normal, ortho, new THREE.Vector3(), 2.5, undefined, ray.direction);
      const toLight = res.position.clone().sub(hit.point).normalize();
      const reflected = dir.clone().sub(hit.normal.clone().multiplyScalar(2 * dir.dot(hit.normal))).normalize();
      check(toLight.dot(reflected) > 0.99999, 'reflection is exact for an orthographic camera too');
    }
  }

  // ── Speed on a heavy mesh ─────────────────────────────────────
  {
    const scene = new THREE.Scene();
    const heavy = new THREE.Mesh(new THREE.SphereGeometry(1, 700, 700), new THREE.MeshStandardMaterial());   // ~980k triangles
    heavy.updateMatrixWorld(true);
    scene.add(heavy);
    const picker = new PaintPicker();
    let t = performance.now();
    picker.refresh(scene);
    const build = performance.now() - t;
    t = performance.now();
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      if (picker.pick(rayTo(cam, new THREE.Vector3(Math.sin(i) * 0.7, Math.cos(i * 1.7) * 0.7, 0)))) hits++;
    }
    const per = (performance.now() - t) / 200;
    console.log(`      (${Math.round((heavy.geometry.index?.count ?? 0) / 3 / 1000)}k triangles: BVH built in ${build.toFixed(0)} ms, ${per.toFixed(3)} ms per pick)`);
    const rc = new THREE.Raycaster();
    t = performance.now();
    for (let i = 0; i < 5; i++) {
      const r = rayTo(cam, new THREE.Vector3(Math.sin(i) * 0.7, Math.cos(i * 1.7) * 0.7, 0));
      rc.set(r.origin, r.direction);
      rc.intersectObject(heavy, false);
    }
    console.log(`      (three's own raycast on the same mesh: ${((performance.now() - t) / 5).toFixed(1)} ms per pick)`);
    check(hits > 150 && per < 2, `a pick on a ~1M-triangle mesh takes ${per.toFixed(2)} ms`);
  }

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
