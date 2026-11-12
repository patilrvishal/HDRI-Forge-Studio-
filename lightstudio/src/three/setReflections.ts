import * as THREE from 'three';

/**
 * Gives a studio set real reflections: the room is captured once from its middle into a cube map (HDR, so the emissive strips
 * stay far brighter than the walls) and every glossy surface flagged `userData.reflective` uses it as its own environment.
 * The material's roughness then blurs it, so a polished floor shows soft streaks under each strip, like the reference.
 */
/**
 * Box-projects a material's environment reflection onto the room, so the cube map (captured from one point) reflects the
 * room as if its walls were really where they are: the strips land in the right place on the floor instead of at infinity.
 */
function boxProject(mat: THREE.MeshStandardMaterial, box: THREE.Box3, capturePos: THREE.Vector3): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.bpMin = { value: box.min.clone() };
    shader.uniforms.bpMax = { value: box.max.clone() };
    shader.uniforms.bpCapture = { value: capturePos.clone() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoxWorldPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoxWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment;
    const needle = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );';
    if (!chunk.includes(needle)) return;                                  // other three version: keep the plain reflection
    const projected = chunk.replace(needle, needle + `
      {
        vec3 bpFirst = (bpMax - vBoxWorldPos) / reflectVec;
        vec3 bpSecond = (bpMin - vBoxWorldPos) / reflectVec;
        vec3 bpFar = max(bpFirst, bpSecond);
        float bpDist = min(min(bpFar.x, bpFar.y), bpFar.z);
        reflectVec = (vBoxWorldPos + reflectVec * bpDist) - bpCapture;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <envmap_physical_pars_fragment>',
      `varying vec3 vBoxWorldPos;
uniform vec3 bpMin;
uniform vec3 bpMax;
uniform vec3 bpCapture;
` + projected,
    );
  };
  mat.customProgramCacheKey = () => 'boxProjectedEnv';
}

export function applySetReflections(renderer: THREE.WebGLRenderer, scene: THREE.Scene, group: THREE.Group, at = new THREE.Vector3(0, 1.3, 0.5)): void {
  try {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 60, rt);
    cam.position.copy(at);
    // capture the room itself, not the editor dressing or the model
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.parent === scene && o !== group && !(o as THREE.Light).isLight && o !== cam) {
        if (o.visible) { hidden.push(o); o.visible = false; }
      }
    });
    const prevEnv = scene.environment;
    const prevBg = scene.background;
    scene.environment = null;
    scene.background = new THREE.Color(0x000000);
    scene.add(cam);
    cam.update(renderer, scene);
    scene.remove(cam);
    scene.environment = prevEnv;
    scene.background = prevBg;
    hidden.forEach((o) => { o.visible = true; });
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromCubemap(rt.texture);
    pmrem.dispose();
    rt.dispose();

    group.userData.reflEnv = env;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.reflective) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.envMap = env.texture;
        const rb = group.userData.reflBox as number[] | undefined;
        if (rb) boxProject(mat, new THREE.Box3(new THREE.Vector3(rb[0], rb[1], rb[2]), new THREE.Vector3(rb[3], rb[4], rb[5])), at);
        mat.envMapIntensity = (m.userData.reflectIntensity as number | undefined) ?? 1;
        mat.needsUpdate = true;
      }
    });
  } catch {
    /* reflections are a nicety: the set still renders without them */
  }
}

export function disposeSetReflections(group: THREE.Object3D): void {
  const env = group.userData.reflEnv as THREE.WebGLRenderTarget | undefined;
  if (env) env.dispose();
}
