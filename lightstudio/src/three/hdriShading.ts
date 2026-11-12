import * as THREE from 'three';

/**
 * Shaded view of a rig's room from the HDRI capture point.
 *
 * The analytic HDRI renderer knows each object's silhouette (and its flat colour) but not how the surface is lit. For a rig's
 * studio set the real renderer already knows: lit walls, the glow of the strips, reflections in the glossy floor. So the room
 * is captured once into a cube map from the capture point and turned into an equirectangular float map; wherever the HDRI
 * caster hits an included part, that part's shaded radiance is used instead of its flat colour.
 */
export interface ShadedMap { data: Float32Array; w: number; h: number }

type Provider = (scene: THREE.Scene, origin: THREE.Vector3) => ShadedMap | null;
let provider: Provider | null = null;

export function registerShadedProvider(p: Provider): void { provider = p; }
export function getShadedMap(scene: THREE.Scene, origin: THREE.Vector3): ShadedMap | null {
  try { return provider ? provider(scene, origin) : null; } catch (e) { console.warn('[HDRI] shaded room capture failed', e); return null; }
}

/** Nearest sample of the shaded map in direction (dx, dy, dz) (same mapping as the HDRI's pixel directions). */
export function sampleShaded(map: ShadedMap, dx: number, dy: number, dz: number, out: [number, number, number]): void {
  const u = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5;
  const v = Math.acos(Math.max(-1, Math.min(1, dy))) / Math.PI;
  const x = Math.min(map.w - 1, Math.max(0, Math.floor(u * map.w)));
  const y = Math.min(map.h - 1, Math.max(0, Math.floor((1 - v) * map.h)));      // the read-back rows run bottom to top
  const i = (y * map.w + x) * 4;
  out[0] = map.data[i]; out[1] = map.data[i + 1]; out[2] = map.data[i + 2];
}

const EQ_W = 1024, EQ_H = 512;

export function createShadedProvider(renderer: THREE.WebGLRenderer): Provider {
  let cubeRT: THREE.WebGLCubeRenderTarget | null = null;
  let eqRT: THREE.WebGLRenderTarget | null = null;
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform samplerCube tCube;
      varying vec2 vUv;
      void main() {
        float theta = (vUv.x - 0.5) * 6.28318530718;
        float phi = (1.0 - vUv.y) * 3.14159265359;
        vec3 dir = vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
        gl_FragColor = vec4(textureCube(tCube, dir).rgb, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const buf = new Float32Array(EQ_W * EQ_H * 4);

  return (scene, origin) => {
    const rig = scene.children.find((o) => o.userData.isRigSet);
    if (!rig) return null;                                           // no studio set: the flat colours are all there is
    cubeRT ??= new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
    eqRT ??= new THREE.WebGLRenderTarget(EQ_W, EQ_H, { type: THREE.FloatType, depthBuffer: false });

    // only the set and its lights: not the model (the viewer stands inside it), helpers, grid or editor dressing
    const hidden: THREE.Object3D[] = [];
    for (const o of scene.children) {
      if (o === rig || (o as THREE.Light).isLight) continue;
      if (o.visible) { hidden.push(o); o.visible = false; }
    }
    const prevEnv = scene.environment, prevBg = scene.background, prevFog = scene.fog;
    scene.environment = null;                                         // the HDRI is what we are making: no feedback loop
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;
    const cam = new THREE.CubeCamera(0.0005, 120, cubeRT);
    cam.position.copy(origin);
    scene.add(cam);
    try {
      cam.update(renderer, scene);
    } finally {
      scene.remove(cam);
      scene.environment = prevEnv; scene.background = prevBg; scene.fog = prevFog;
      hidden.forEach((o) => { o.visible = true; });
    }

    mat.uniforms.tCube.value = cubeRT.texture;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(eqRT);
    renderer.render(quadScene, quadCam);
    renderer.readRenderTargetPixels(eqRT, 0, 0, EQ_W, EQ_H, buf);
    renderer.setRenderTarget(prevTarget);
    return { data: buf, w: EQ_W, h: EQ_H };
  };
}
