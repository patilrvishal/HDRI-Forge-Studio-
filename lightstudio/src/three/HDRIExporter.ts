/**
 * HDRIExporter - Analytical HDRI generation for LightForge Studio.
 *
 * Generates true HDR (.hdr / .exr) equirectangular images from scene lights
 * using PURE MATHEMATICS - no CubeCamera, no proxy meshes, no WebGL rendering.
 *
 * For every pixel in the output image:
 *   1. Convert pixel position â†’ world direction vector (equirectangular mapping)
 *   2. For each light in scene â†’ calculate radiance mathematically from that direction
 *   3. Write the raw float value directly to pixel array
 *   4. Encode as RGBE (.hdr) or float32 (.exr)
 *
 * LIGHT VISIBILITY IN HDRI:
 *   Lights are rendered as visible bright glowing regions (disks/rectangles) in the
 *   HDRI, not infinitely small points. Each light has an angular size derived from
 *   its physical size and distance. A soft Gaussian falloff around the edges ensures
 *   lights are visible across resolutions (512-4096). Radiance is computed using
 *   proper solid-angle weighting so total flux is preserved regardless of resolution.
 *
 * Pipeline (matching SVG reference):
 *   Stage 1: Light sources â†’ ExtractedLight data
 *   Stage 2: Capture method â†’ Analytical per-pixel (no camera)
 *   Stage 3: Raw radiance â†’ Float32 array, unbounded values
 *   Stage 4: Projection â†’ Equirectangular 2:1 ratio
 *   Stage 5: Color space â†’ Linear (no gamma, no tone mapping)
 *   Stage 6: File encoding â†’ RGBE (.hdr) or float32 (.exr)
 *   Stage 7: Output â†’ Downloadable file
 *
 * No external libraries - pure Three.js + TypeScript.
 */
import * as THREE from 'three';
import { hdriBase64ToArrayBuffer } from '../store/hdriDataStore';
import { useHDRIAssetStore } from '../store/hdriAssetStore';
import { useSceneStore } from '../store/sceneStore';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// --------- Types ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Normalized light data extracted from a THREE.Scene. */
interface ExtractedLight {
  type: 'point' | 'spot' | 'directional' | 'area' | 'hemisphere';
  color: THREE.Color;
  intensity: number;
  position: THREE.Vector3;
  /** SpotLight only */
  direction?: THREE.Vector3;
  angle?: number;
  penumbra?: number;
  decay?: number;
  /** RectAreaLight only */
  width?: number;
  height?: number;
  edgeSoftness?: number;
  dropShadow?: { enabled: boolean; angle: number; distance: number; intensity: number; softness: number };
  right?: THREE.Vector3;
  up?: THREE.Vector3;
  normal?: THREE.Vector3;
  /** HemisphereLight only */
  groundColor?: THREE.Color;
  /** RectAreaLight only - 0..1, see the alpha-composite note in evaluateLightRadiance. */
  opacity?: number;
}

/**
 * One environment HDRI layer contributing to the export/preview.
 *
 * Layers composite in array order using `opacity` as an alpha-blend against
 * whatever earlier layers already accumulated (background-first, each
 * later layer painted "over" the last) - matching how HDRI Shapes and area
 * lights already occlude rather than just adding brightness on top. A
 * layer with opacity=100 (the default - see grading fields below) fully
 * replaces what's beneath it, same as plain addition used to behave when
 * there was only ever one real HDRI layer; opacity<100 lets it blend
 * through, and this is also what gives moving a Custom HDRI up/down the
 * layer stack an actual visible effect.
 */
export interface EnvLayer {
  /** Decoded equirectangular HDR texture (from RGBELoader). */
  texture: THREE.DataTexture;
  /** Final intensity multiplier (per-asset intensity x global intensity). */
  intensity: number;
  /** Rotation around the Y axis, in RADIANS. */
  rotation: number;
  /** 0-100, default 100 (fully opaque - same as the old purely-additive
   *  behavior). How much this layer blends over the accumulated result of
   *  every earlier layer. */
  opacity?: number;
  /** -100..100, default 0 (no change). Contrast pivoted around mid-grey. */
  contrast?: number;
  /** Default 1 (no change). Gamma curve on top of the decoded HDR values. */
  gamma?: number;
  /** -100..100, default 0 (no change). Desaturate toward luminance at
   *  -100, oversaturate at +100. */
  saturation?: number;
}

/** Apply gamma -> contrast -> saturation to a linear RGB color, in that
 *  order (gamma reshapes the curve first, contrast pivots around the
 *  resulting mid-grey, saturation is a post-process on top of both) -
 *  shared by every place that samples a graded EnvLayer, so the HDRI
 *  Preview panel and the exported file always agree on the exact math. */
function applyColorGrading(
  color: THREE.Color,
  contrast: number | undefined,
  gamma: number | undefined,
  saturation: number | undefined,
): THREE.Color {
  let r = color.r, g = color.g, b = color.b;

  if (gamma !== undefined && gamma !== 1) {
    const invGamma = 1 / Math.max(0.01, gamma);
    r = Math.pow(Math.max(0, r), invGamma);
    g = Math.pow(Math.max(0, g), invGamma);
    b = Math.pow(Math.max(0, b), invGamma);
  }

  if (contrast) {
    // -100..100 -> a multiplicative factor pivoted at 0.5 (mid-grey in
    // display space) - values above 1.0 stay proportionally more extreme
    // instead of clamping, since this operates in unbounded HDR space.
    const factor = (100 + contrast) / 100;
    r = (r - 0.5) * factor + 0.5;
    g = (g - 0.5) * factor + 0.5;
    b = (b - 0.5) * factor + 0.5;
  }

  if (saturation) {
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const factor = (100 + saturation) / 100;
    r = lum + (r - lum) * factor;
    g = lum + (g - lum) * factor;
    b = lum + (b - lum) * factor;
  }

  return new THREE.Color(Math.max(0, r), Math.max(0, g), Math.max(0, b));
}

/** Options for the main downloadHDRI() entry point. */
export interface HDRIExportOptions {
  /** Equirectangular width: 512 | 1024 | 2048 | 4096 | 8192 */
  width: 512 | 1024 | 2048 | 4096 | 8192;
  /** Equirectangular height: 256 | 512 | 1024 | 2048 | 4096 */
  height: 256 | 512 | 1024 | 2048 | 4096;
  /** Output format */
  format: 'hdr' | 'exr';
  /**
   * Pre-built environment layers.
   * If omitted, every ACTIVE asset in the HDRI asset store is auto-loaded.
   */
  environmentLayers?: EnvLayer[];
  /** Global multiplier applied on top of each layer's own intensity. */
  environmentGlobalIntensity?: number;
  /** Legacy single-texture fields - used only if no layers are found. */
  includeEnvironment?: boolean;
  environmentTexture?: THREE.Texture | null;
  environmentIntensity?: number;
  environmentRotation?: number;
  /** World-space capture point (default: origin) */
  capturePoint?: THREE.Vector3;
  /** Optional filename (without extension) */
  filename?: string;
  /**
   * View Exposure, baked into the exported data as a linear multiplier so
   * the file matches what the HDRI Preview panel/viewport show. Default 1.0
   * (no change). Values still exceed 1.0 where the scene does - this only
   * scales, it does not clamp/tonemap, so the file stays true HDR.
   */
  viewExposure?: number;
}

// --------- Constants ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Apparent angular radius of the real sun: ~0.2657deg = 0.004635 rad */
const SUN_ANGULAR_RADIUS = 0.004635;

/**
 * Visual angular radius for point/spot lights in the HDRI.
 * Real point lights are infinitely small, but we render them as visible
 * bright disks so they appear in the exported HDRI. 2.5deg = 0.0436 rad
 * gives a clearly visible glow at all standard resolutions.
 */
const POINT_LIGHT_VISUAL_RADIUS = 1.0 * (Math.PI / 180);

/** Gaussian softness factor: controls edge falloff smoothness (higher = softer edge). */
const GAUSSIAN_SOFTNESS = 1.5;

/**
 * Master export exposure. Multiplies EVERY light's radiance.
 * Tune this ONE value until the exported HDRI matches the viewport.
 *   Too bright / washed out -> lower it (0.1, 0.05, 0.01)
 *   Too dark                -> raise it (2, 5, 10)
 */
const EXPORT_EXPOSURE = 200.0;

// --------- FUNCTION 1: pixelToDirection ------------------------------------------------------------------------------------------------------------------------------------

/**
 * Convert an output image pixel (x, y) to a 3D world direction vector
 * using equirectangular (latitude-longitude) projection.
 *
 * Mapping follows the standard equirectangular convention:
 *   theta (azimuth) = u Ã— 2PI,  phi (elevation) = v Ã— PI
 *   dir = (sin(phi)*sin(theta), cos(phi), sin(phi)*cos(theta))
 *
 * Output is 2:1 ratio (width:height) as required by HDR standards.
 *
 * @param x      - Horizontal pixel coordinate (0 = left edge).
 * @param y      - Vertical pixel coordinate (0 = top edge).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Normalized direction vector in world space.
 */
function pixelToDirection(
  x: number,
  y: number,
  width: number,
  height: number,
): THREE.Vector3 {
  const u = (x + 0.5) / width;
  const v = (y + 0.5) / height;
  const theta = (u - 0.5) * 2 * Math.PI; // azimuth, Blender/three.js convention
  const phi = v * Math.PI;               // elevation 0â†’PI (top to bottom)

  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta), // X
    Math.cos(phi),                   // Y (up)
    Math.sin(phi) * Math.sin(theta), // Z
  ).normalize();
}

/**
 * Calculate the solid angle (steradians) of a single pixel in an equirectangular map.
 * This varies across the image - pixels near the poles cover less solid angle
 * than pixels near the equator. Proper solid-angle weighting ensures total
 * flux is preserved regardless of resolution.
 *
 * @param y      - Pixel row (0 = top/north pole).
 * @param height - Total image height.
 * @param width  - Total image width.
 * @returns Solid angle in steradians for this pixel.
 */
function pixelSolidAngle(y: number, height: number, width: number): number {
  const thetaSize = (2 * Math.PI) / width;
  const phi1 = (y / height) * Math.PI;
  const phi2 = ((y + 1) / height) * Math.PI;
  return thetaSize * (Math.cos(phi1) - Math.cos(phi2));
}

/**
 * Smooth Gaussian-like soft falloff for light edges.
 * Returns 1.0 at center (angle=0), smoothly falling to ~0 at the angular radius.
 *
 * @param angle  - Angular distance from light center (radians).
 * @param radius - Angular radius of the light (radians).
 * @returns Falloff factor in [0, 1].
 */
function softFalloff(angle: number, radius: number): number {
  if (angle >= radius) return 0;
  const t = angle / radius; // 0 at center, 1 at edge
  // Smoothstep-based falloff: stays near 1.0 in center, drops smoothly at edge
  const s = t * t * (3 - 2 * t);
  return 1.0 - s;
}

// --------- FUNCTION 2: evaluateLightRadiance ---------------------------------------------------------------------------------------------------------------------

/**
 * For a given light and view direction, calculate the radiance arriving from
 * that direction at the capture point. Lights are rendered as visible bright
 * regions (not infinitely small points) with proper solid-angle radiance scaling.
 *
 * Key principle from the SVG pipeline (Stage 3):
 *   "Values are UNBOUNDED - can be 0.001 to 100,000+"
 *   "Dark shadow = 0.001, Softbox = 200-2000, Sun disk = 50,000+"
 *
 * @param light        - Extracted light data.
 * @param dir          - Normalized world direction being evaluated.
 * @param capturePoint - World-space capture position.
 * @returns Radiance color (linear, can be >> 1.0 for true HDR), plus - for
 *   rect area lights only - `coverage`: how much of this pixel the light's
 *   physical rectangle actually covers (0..1, already feathered by Edge
 *   Softness). The caller uses this to alpha-composite the rectangle as an
 *   occluding "card" over the background rather than adding it on top (see
 *   the main render loop) - undefined for every other light type, which
 *   have no physical footprint and stay purely additive.
 */
function evaluateLightRadiance(
  light: ExtractedLight,
  dir: THREE.Vector3,
  capturePoint: THREE.Vector3,
): { r: number; g: number; b: number; coverage?: number } {
  const result: { r: number; g: number; b: number; coverage?: number } = { r: 0, g: 0, b: 0 };

  switch (light.type) {
    // ------ Point Light ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    // Rendered as a visible glowing disk with angular radius derived from
    // the light's distance and a minimum visual size for visibility.
    // Radiance scales with intensity / solid_angle so total flux is preserved.
    case 'point': {
      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      toLight.normalize();

      // Angular distance from this pixel's direction to the light
      const cosAngle = Math.max(-1, Math.min(1, dir.dot(toLight)));
      const angle = Math.acos(cosAngle);

      // Visual angular radius: use the larger of physical or minimum visible size
      // Physical: atan2(0.3, dist) - treat light as a 0.3m radius sphere
      // Minimum: POINT_LIGHT_VISUAL_RADIUS - ensures visibility at any distance
      const physicalRadius = Math.atan2(0.3, dist);
      const visualRadius = Math.max(physicalRadius, POINT_LIGHT_VISUAL_RADIUS);

      // Soft edge falloff
      const falloff = softFalloff(angle, visualRadius * GAUSSIAN_SOFTNESS);
      if (falloff <= 0) break;

      // Radiance: intensity * scale, calibrated to land in the documented
      // 200-2000 HDR hotspot range at typical intensity/distance. This must
      // NOT also multiply by EXPORT_EXPOSURE - that stacked on top of this
      // already-tuned constant, pinning point lights ~400,000x too bright so
      // every intensity from 1 to 1000 clipped identically to pure white in
      // the tonemapped preview (looked like "brightness does nothing").
      const radiance = light.intensity * 2000 * falloff;
      result.r = light.color.r * radiance;
      result.g = light.color.g * radiance;
      result.b = light.color.b * radiance;

      break;
    }

    // ------ Spot Light ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    // Same as point light but with cone angle and penumbra falloff.
    // Only visible if the capture point is inside the spot cone.
    case 'spot': {
      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      toLight.normalize();

      // Check capture point is inside spot cone
      const toCaptureDir = new THREE.Vector3()
        .subVectors(capturePoint, light.position)
        .normalize();
      const lightDir = light.direction ?? new THREE.Vector3(0, -1, 0).clone().normalize();
      const spotAngle = Math.acos(
        Math.max(-1, Math.min(1, toCaptureDir.dot(lightDir))),
      );
      const halfAngle = light.angle ?? Math.PI / 4;
      const penumbra = light.penumbra ?? 0.1;

      if (spotAngle >= halfAngle) break; // Outside cone

      // Cone intensity falloff (smoothstep in penumbra region)
      const coneT = Math.max(0, Math.min(1, (halfAngle - spotAngle) / Math.max(0.001, penumbra * halfAngle)));
      const coneFalloff = coneT * coneT * (3 - 2 * coneT);

      // Angular distance to light center
      const cosAngle = Math.max(-1, Math.min(1, dir.dot(toLight)));
      const angle = Math.acos(cosAngle);

      // Visual angular radius with cone-aware sizing
      const physicalRadius = Math.atan2(0.3, dist);
      // Scale visual size by the spot cone - wider cone = larger apparent source
      const coneScale = Math.sin(halfAngle);
      const visualRadius = Math.max(physicalRadius, POINT_LIGHT_VISUAL_RADIUS * coneScale);

      const falloff = softFalloff(angle, visualRadius * GAUSSIAN_SOFTNESS);
      if (falloff <= 0) break;

      // Radiance with distance decay and cone falloff. Same tuned constant
      // as point light - must not also multiply by EXPORT_EXPOSURE (see
      // point light comment above for why that stacked to always-clipped).
      const decay = light.decay ?? 2;
      const distDecay = Math.pow(Math.max(0.1, dist), -decay) * Math.pow(Math.max(0.1, 5), decay);
      const radiance = light.intensity * 2000 * falloff * coneFalloff * distDecay;

      result.r = light.color.r * radiance;
      result.g = light.color.g * radiance;
      result.b = light.color.b * radiance;
      break;
    }

    // ------ Directional Light (Sun) ------------------------------------------------------------------------------------------------------------------------------------
    // Sun is a tiny extremely bright disk at infinity. Uses the real solar
    // angular radius (0.2657deg). Soft glow extends ~5x beyond the disk.
    case 'directional': {
      const lightDir = light.direction ?? new THREE.Vector3(0, -1, 0).clone().normalize();
      const toSun = lightDir.clone().negate().normalize();

      const cosAngle = Math.max(-1, Math.min(1, dir.dot(toSun)));
      const angleToSun = Math.acos(cosAngle);

      if (angleToSun < SUN_ANGULAR_RADIUS) {
        // ------ Sun disk: extremely bright (Stage 3: "Sun disk = 50,000+")
        const radiance = light.intensity * 5000 * EXPORT_EXPOSURE;
        result.r = light.color.r * radiance;
        result.g = light.color.g * radiance;
        result.b = light.color.b * radiance;
      } else {
        // ------ Soft glow / sky gradient around the sun
        // Extends to ~5x the solar radius with smooth falloff
        const glowRadius = SUN_ANGULAR_RADIUS * 8;
        const glowFalloff = softFalloff(angleToSun, glowRadius);
        if (glowFalloff > 0) {
          // Glow is much dimmer than the disk but still HDR (>1.0)
          const glowRadiance = light.intensity * 10 * glowFalloff;
          result.r = light.color.r * glowRadiance;
          result.g = light.color.g * glowRadiance;
          result.b = light.color.b * glowRadiance;
        }
      }
      break;
    }

    // ------ Rect Area Light ------------------------------------------------------------------------------------------------------------------------------------------------------------
    // Analytic per-pixel evaluation of the rectangle's angular footprint -
    // the same gnomonic-projection rectangle test HDRIShapesLayer uses for
    // HDRI Shapes - instead of the previous 12x12 grid of discrete point
    // samples averaged into a soft glow. The old approach fundamentally
    // could not produce a crisp edge: even flooring the per-sample falloff
    // radius (to fix a star-burst artifact when it shrank too far) still
    // left every pixel as a blend of up to 144 soft dots, so Edge Softness
    // at 0 still looked blurry, not sharp. This tests the exact analytic
    // boundary of the rectangle, so 0 is genuinely a hard cutoff and
    // increasing Edge Softness smoothly widens the feather inward from
    // that real edge - matching how an HDRI Shape's own Softness behaves.
    case 'area': {
      const lightNormal = light.normal ?? new THREE.Vector3(0, 0, 1);
      const facingDir = new THREE.Vector3()
        .subVectors(capturePoint, light.position)
        .normalize();

      // Only contribute if capture point faces the front of the rect
      if (facingDir.dot(lightNormal) < 0) break;

      const lightRight = light.right ?? new THREE.Vector3(1, 0, 0);
      const lightUp = light.up ?? new THREE.Vector3(0, 1, 0);
      const rectW = light.width ?? 2;
      const rectH = light.height ?? 2;

      const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
      const dist = Math.max(0.01, toLight.length());
      const centerDir = toLight.clone().normalize();

      const cosc = dir.x * centerDir.x + dir.y * centerDir.y + dir.z * centerDir.z;
      if (cosc <= 0.02) break; // behind the light's own hemisphere

      // Project the pixel's direction into the rectangle's local tangent
      // plane (right/up axes), same math as HDRIShapesLayer's paintPatch.
      const lx = (dir.x * lightRight.x + dir.y * lightRight.y + dir.z * lightRight.z) / cosc;
      const ly = (dir.x * lightUp.x + dir.y * lightUp.y + dir.z * lightUp.z) / cosc;

      const halfW = Math.max(0.02, Math.atan2(rectW / 2, dist));
      const halfH = Math.max(0.02, Math.atan2(rectH / 2, dist));
      const nx = Math.abs(lx) / Math.tan(Math.min(halfW, 1.55));
      const ny = Math.abs(ly) / Math.tan(Math.min(halfH, 1.55));
      if (nx > 1 || ny > 1) break; // outside the rectangle's true footprint

      const feather = Math.max(0, Math.min(1, (light.edgeSoftness ?? 50) / 100));
      const featherLo = 1 - feather;
      const edge = Math.max(nx, ny); // Chebyshev distance = box falloff
      const coverage = feather < 0.01 ? 1 : 1 - smoothstepHDRI((edge - featherLo) / Math.max(0.001, 1 - featherLo));
      if (coverage <= 0) break;

      // Cosine emission factor (Lambert's law for the area surface)
      const cosEmit = Math.max(0, -(centerDir.x * lightNormal.x + centerDir.y * lightNormal.y + centerDir.z * lightNormal.z));

      // Radiance: intensity * cosEmit / solidAngle * coverage. Area lights
      // in studio HDRI should be 200-2000 range (Stage 3).
      const solidAngle = 4 * halfW * halfH;
      const safeSA = Math.max(1e-6, solidAngle);
      const radiance = (light.intensity * cosEmit * coverage * 0.5 * EXPORT_EXPOSURE) / safeSA;

      result.r = light.color.r * radiance;
      result.g = light.color.g * radiance;
      result.b = light.color.b * radiance;
      result.coverage = coverage;
      break;
    }

    // ------ Hemisphere Light ---------------------------------------------------------------------------------------------------------------------------------------------------------
    // Smooth gradient from ground color (bottom) to sky color (top).
    // This is an ambient fill - values are typically 0.1-0.5 range.
    case 'hemisphere': {
      const t = (dir.y + 1) / 2; // 0 = ground, 1 = sky
      const skyCol = light.color;
      const gndCol = light.groundColor ?? new THREE.Color(0, 0, 0);
      result.r = (gndCol.r * (1 - t) + skyCol.r * t) * light.intensity;
      result.g = (gndCol.g * (1 - t) + skyCol.g * t) * light.intensity;
      result.b = (gndCol.b * (1 - t) + skyCol.b * t) * light.intensity;
      break;
    }
  }

  return result;
}

function smoothstepHDRI(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

interface ShadowPatch {
  dir: THREE.Vector3;
  /** RectAreaLight's own right/up axes, carried into the shadow unrotated -
   *  so the shadow is a rectangle in the SAME orientation as the light that
   *  cast it, not a generic circular blob. */
  right: THREE.Vector3;
  up: THREE.Vector3;
  halfW: number;
  halfH: number;
  featherLo: number;
  intensity: number;
}

/**
 * Build one darkening patch per area-type light with an enabled drop shadow.
 * The patch is offset from the light's own apparent direction by rotating it
 * along a great circle (Rodrigues' formula) toward a tangent-plane axis
 * picked by "angle", walking "distance" percent of the light's own angular
 * size - the equivalent of a Photoshop drop shadow's angle/distance, just
 * expressed on a sphere instead of a flat canvas. The shadow keeps the
 * light's actual rectangular footprint (via its right/up axes and
 * width/height), rather than approximating it as a circle - so a wide,
 * flat area light casts a wide, flat shadow, not a round one.
 */
function buildLightShadowPatches(lights: ExtractedLight[], capturePoint: THREE.Vector3): ShadowPatch[] {
  const patches: ShadowPatch[] = [];

  for (const light of lights) {
    if (light.type !== 'area') continue;
    const shadow = light.dropShadow;
    if (!shadow?.enabled || shadow.intensity <= 0) continue;

    const toLight = new THREE.Vector3().subVectors(light.position, capturePoint);
    const dist = Math.max(0.01, toLight.length());
    const baseDir = toLight.clone().normalize();

    const halfW = Math.max(0.02, Math.atan2((light.width ?? 1) / 2, dist));
    const halfH = Math.max(0.02, Math.atan2((light.height ?? 1) / 2, dist));
    const angularRadius = (halfW + halfH) / 2;

    // Tangent basis at baseDir, used only to pick the offset direction - the
    // shadow's own orientation still comes from the light's right/up below.
    const worldUp = new THREE.Vector3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(worldUp, baseDir);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(baseDir, right).normalize();

    const angleRad = (shadow.angle * Math.PI) / 180;
    const axis = right.clone().multiplyScalar(Math.cos(angleRad)).addScaledVector(up, Math.sin(angleRad));

    const angularDist = angularRadius * (shadow.distance / 100);
    const shadowDir = baseDir
      .clone()
      .multiplyScalar(Math.cos(angularDist))
      .addScaledVector(axis, Math.sin(angularDist))
      .normalize();

    // The light's OWN right/up (from RectAreaLight's world quaternion) define
    // the shadow rectangle's orientation, so a rotated light casts a shadow
    // rotated the same way - not always axis-aligned to the tangent plane.
    const lightRight = (light.right ?? right).clone().normalize();
    const lightUp = (light.up ?? up).clone().normalize();

    patches.push({
      dir: shadowDir,
      right: lightRight,
      up: lightUp,
      halfW,
      halfH,
      featherLo: Math.max(0, 1 - shadow.softness / 100),
      intensity: Math.max(0, Math.min(1, shadow.intensity / 100)),
    });
  }

  return patches;
}

// --------- FUNCTION 3: generateAnalyticalHDRI ------------------------------------------------------------------------------------------------------------------

/**
 * Generate a true HDR equirectangular image analytically from scene lights.
 *
 * Pipeline stages implemented:
 *   Stage 2 (Capture): Analytical per-pixel, no camera/render
 *   Stage 3 (Radiance): Float32 RGBA, unbounded values (0.001 to 100,000+)
 *   Stage 4 (Projection): Equirectangular, 2:1 ratio, top-to-bottom
 *   Stage 5 (Color Space): Linear - no gamma, no tone mapping
 *
 * @param scene           - The THREE.Scene containing lights.
 * @param width           - Output width in pixels.
 * @param height          - Output height in pixels (should be width/2 for 2:1).
 * @param capturePoint    - World-space capture position (default: origin).
 * @param includeEnv      - Whether to include loaded environment texture.
 * @param envTexture      - User-loaded equirectangular environment texture.
 * @param envIntensity    - Environment brightness multiplier.
 * @param envRotation     - Environment rotation in radians (around Y axis).
 * @returns Float32Array of RGBA (4 floats per pixel, linear, top-to-bottom).
 */
export async function generateAnalyticalHDRI(
  scene: THREE.Scene,
  width: number,
  height: number,
  capturePoint: THREE.Vector3,
  envLayers: EnvLayer[] = [],
): Promise<Float32Array> {
  const pixels = new Float32Array(width * height * 4);

  // Extract all lights from scene
  const lights = extractLightsFromScene(scene);
  console.log('[LightForge] Found lights:', lights.length);
lights.forEach((l, i) => {
    console.log(`[LightForge] Light ${i}: type=${l.type} R=${l.color.r.toFixed(3)} G=${l.color.g.toFixed(3)} B=${l.color.b.toFixed(3)} intensity=${l.intensity}`);
  });

  // Photoshop-style drop shadows for area-type lights - a darkening patch
  // offset from the light's own apparent direction, applied as a post-process
  // multiply on the final summed radiance (so it darkens whatever's actually
  // there - env, other lights - the same way a real drop shadow layer would).
  const shadowPatches = buildLightShadowPatches(lights, capturePoint);
  // For each pixel, calculate analytical radiance
  for (let y = 0; y < height; y++) {
    // Pre-compute solid angle for this row
    const sa = pixelSolidAngle(y, height, width);

    for (let x = 0; x < width; x++) {
      const dir = pixelToDirection(x, y, width, height);

      let r = 0, g = 0, b = 0;

      // Background first: every active environment layer, composited in
      // array order (the same order shown/reorderable in the Light List
      // panel's layer stack).
      //
      // Real Custom HDRI asset layers carry an explicit `opacity` and
      // ALPHA-COMPOSITE over whatever earlier layers already accumulated -
      // this is what makes moving one up/down the stack (and its Opacity
      // slider) actually visible: 100% fully replaces what's beneath it,
      // lower values blend through. The HDRI Shapes/Gradient composite
      // layer (built in HDRIPreviewPanel/downloadHDRI) deliberately leaves
      // `opacity` undefined and stays purely ADDITIVE instead - its base
      // fill covers the whole frame as a placeholder (near-black, or the
      // gradient), not real content, so alpha-replacing the whole frame
      // with it would blank out every real HDRI layer everywhere the
      // shape/gradient doesn't actually paint something, which is exactly
      // the "everything else disappears" bug fixed earlier this session.
      for (let i = 0; i < envLayers.length; i++) {
        const layer = envLayers[i];
        const raw = sampleEnvTexture(layer.texture, dir, layer.rotation, layer.intensity);
        const e = (layer.contrast || layer.saturation || (layer.gamma !== undefined && layer.gamma !== 1))
          ? applyColorGrading(raw, layer.contrast, layer.gamma, layer.saturation)
          : raw;

        if (layer.opacity !== undefined) {
          const alpha = Math.max(0, Math.min(1, layer.opacity / 100));
          r = r * (1 - alpha) + e.r * alpha;
          g = g * (1 - alpha) + e.g * alpha;
          b = b * (1 - alpha) + e.b * alpha;
        } else {
          r += e.r;
          g += e.g;
          b += e.b;
        }
      }

      // Composite each light on top of that background.
      //
      // Rect area lights have a real physical footprint (a card), so they
      // ALPHA-COMPOSITE over the background rather than adding to it - a
      // black/dark-colored panel is still an opaque card blocking whatever
      // is behind it, exactly like the HDRI Shapes layer. Purely additive
      // blending (the old behaviour) meant a light's visibility was
      // entirely a function of its own brightness*color: a dark color
      // computed near-zero radiance, which added to the background changed
      // it by nothing, so the light silently "disappeared" instead of
      // rendering as its own (dark) patch - Opacity had no way to bring it
      // back since it only ever scaled that same near-zero contribution.
      // Alpha = coverage (the rectangle's feathered footprint) x opacity,
      // so Opacity now does what its name says: 100% = fully opaque card in
      // the light's actual color, 0% = fully see-through to the background,
      // independent of how dark or bright that color happens to be.
      //
      // Every other light type has no physical footprint (a point/spot/
      // directional/hemisphere light is just a glow, not a card), so they
      // stay purely additive, same as before.
      for (let i = 0; i < lights.length; i++) {
        const c = evaluateLightRadiance(lights[i], dir, capturePoint);
        if (c.coverage !== undefined) {
          const alpha = Math.max(0, Math.min(1, c.coverage * (lights[i].opacity ?? 1)));
          r = r * (1 - alpha) + c.r * alpha;
          g = g * (1 - alpha) + c.g * alpha;
          b = b * (1 - alpha) + c.b * alpha;
        } else {
          r += c.r;
          g += c.g;
          b += c.b;
        }
      }

      // Drop shadows darken the already-summed result, same as a Photoshop
      // multiply layer - applied last so it affects env + every light, not
      // just the light that owns the shadow.
      for (let i = 0; i < shadowPatches.length; i++) {
        const sp = shadowPatches[i];
        const cosc = dir.dot(sp.dir);
        if (cosc <= 0.02) continue; // behind the shadow's own hemisphere

        // Same gnomonic rectangle test HDRIShapesLayer uses for shapes, so a
        // rectangular light casts a rectangular shadow in its own actual
        // orientation - not a circular approximation.
        const lx = (dir.x * sp.right.x + dir.y * sp.right.y + dir.z * sp.right.z) / cosc;
        const ly = (dir.x * sp.up.x + dir.y * sp.up.y + dir.z * sp.up.z) / cosc;
        const nx = Math.abs(lx) / Math.tan(Math.min(sp.halfW, 1.55));
        const ny = Math.abs(ly) / Math.tan(Math.min(sp.halfH, 1.55));
        if (nx > 1 || ny > 1) continue;

        const edge = Math.max(nx, ny);
        const coverage = edge <= sp.featherLo ? 1 : 1 - smoothstepHDRI((edge - sp.featherLo) / Math.max(0.001, 1 - sp.featherLo));
        const darken = 1 - sp.intensity * coverage;
        r *= darken;
        g *= darken;
        b *= darken;
      }

      const idx = (y * width + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 1.0;
    }

    // Log progress every 100 rows + yield to event loop
    if (y % 100 === 0) {
      const pct = Math.round((y / height) * 100);
      console.log(`[LightForge HDRI] ${pct}% complete`);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // VERIFY - Stage 3 check: max pixel MUST be > 1.0 for true HDR
  let maxVal = 0;
  let nonBlackCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const m = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (m > maxVal) maxVal = m;
    if (m > 0.001) nonBlackCount++;
  }
  const totalPixels = width * height;
  console.log(`[LightForge HDRI] Max pixel value: ${maxVal.toFixed(1)}`);
  console.log(`[LightForge HDRI] Non-black pixels: ${nonBlackCount} / ${totalPixels} (${((nonBlackCount / totalPixels) * 100).toFixed(1)}%)`);
  console.log(`[LightForge HDRI] True HDR: ${maxVal > 1.0}`);
  if (maxVal <= 1.0) {
    console.warn('[LightForge HDRI] WARNING: Max pixel value <= 1.0 - output is LDR, not HDR!');
  }
  if (nonBlackCount === 0) {
    console.error('[LightForge HDRI] ERROR: All pixels are black! No lights found or all lights out of range.');
  }

  return pixels;
}

// --------- FUNCTION 4: extractLightsFromScene ------------------------------------------------------------------------------------------------------------------

/**
 * Traverse a THREE.Scene and extract all physical lights into a
 * plain-data format suitable for analytical radiance evaluation.
 *
 * Skips objects where:
 *   - obj.userData.isLightHelper === true
 *   - obj.userData.isProxy === true
 *   - obj.userData.isGrid === true
 *   - obj.visible === false
 *   - obj instanceof THREE.AmbientLight (omnidirectional, no position)
 *
 * @param scene - The THREE.Scene to traverse.
 * @returns Array of extracted light data objects.
 */
function extractLightsFromScene(scene: THREE.Scene): ExtractedLight[] {
  const lights: ExtractedLight[] = [];
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();

  scene.traverse((child) => {
    if (!(child instanceof THREE.Light)) return;
    if (!child.visible) return;
    if (child.userData.isLightHelper === true) return;
    if (child.userData.isProxy === true) return;
    if (child.userData.isGrid === true) return;
    // Skip AmbientLight - no position/direction, adds uniform light to all pixels
    if (child instanceof THREE.AmbientLight) return;

    child.getWorldPosition(worldPos);

    // ------ PointLight ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    if (child instanceof THREE.PointLight) {
      lights.push({
        type: 'point',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        decay: child.decay,
      });
      return;
    }

    // ------ SpotLight ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    if (child instanceof THREE.SpotLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({
        type: 'spot',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        direction: dir.clone(),
        angle: child.angle,
        penumbra: child.penumbra,
        decay: child.decay,
      });
      return;
    }

    // ------ DirectionalLight ---------------------------------------------------------------------------------------------------------------------------------------------------------
    if (child instanceof THREE.DirectionalLight) {
      const dir = new THREE.Vector3();
      child.getWorldDirection(dir);
      lights.push({
        type: 'directional',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        direction: dir.clone(),
      });
      return;
    }

    // ------ RectAreaLight ------------------------------------------------------------------------------------------------------------------------------------------------------------------
    if (child instanceof THREE.RectAreaLight) {
      child.getWorldQuaternion(worldQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
      lights.push({
        type: 'area',
        color: child.color.clone(),
        intensity: child.intensity,
        position: worldPos.clone(),
        width: child.width,
        height: child.height,
        right: right.clone(),
        up: up.clone(),
        normal: normal.clone(),
        // Set by engine.ts's _updateLight/_createLight from the light's
        // store field - without reading it back here, the user's Edge
        // Softness slider had no effect on the HDRI Preview/export at all,
        // silently falling back to the same default every time.
        edgeSoftness: typeof child.userData.edgeSoftness === 'number' ? child.userData.edgeSoftness : undefined,
        dropShadow: child.userData.dropShadow,
        opacity: typeof child.userData.opacity === 'number' ? child.userData.opacity : 1,
      });
      return;
    }

    // ------ HemisphereLight ------------------------------------------------------------------------------------------------------------------------------------------------------------
    // Skip HemisphereLight - it illuminates ALL directions equally (ambient fill)
    // Including it would make entire HDRI non-black, ruining HDR dynamic range
    if (child instanceof THREE.HemisphereLight) {
      return;
    }
  });

  return lights;
}

// --------- FUNCTION 5: sampleEnvTexture ------------------------------------------------------------------------------------------------------------------------------------

/**
 * Sample a loaded HDRI environment texture for a given world direction.
 *
 * Applies envRotation (rotation around Y axis), converts direction to UV
 * via equirectangular projection, then bilinear-samples the texture.
 * Handles DataTexture (Float32 from RGBELoader), HTMLCanvasElement, and ImageData.
 *
 * @param texture   - Equirectangular environment texture.
 * @param dir       - Normalized world direction to sample.
 * @param rotation  - Rotation in radians around Y axis.
 * @param intensity - Brightness multiplier.
 * @returns Sampled color (linear, scaled by intensity).
 */
function sampleEnvTexture(
  texture: THREE.Texture,
  dir: THREE.Vector3,
  rotation: number,
  intensity: number,
): THREE.Color {
  // ------ Step 1: Apply Y-axis rotation ------------------------------------------------------------------------------------------------------------------------------
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const rx =  dir.x * cosR + dir.z * sinR;
  const rz = -dir.x * sinR + dir.z * cosR;
  const ry =  dir.y;

  // ------ Step 2: Direction â†’ equirectangular UV ---------------------------------------------------------------------------------------------------
  // phi=0 = top (Y+), phi=PI = bottom (Y-)
  const phi   = Math.acos(Math.max(-1, Math.min(1, ry)));
  const theta = Math.atan2(rz, rx);   // matches directionFromPixel

  const u = theta / (2 * Math.PI) + 0.5;  // 0..1 horizontal
  const v = phi   / Math.PI;              // 0=top..1=bottom

  // ------ Step 3: Get image data ---------------------------------------------------------------------------------------------------------------------------------------------------
  const img = texture.image;
  if (!img) return new THREE.Color(0, 0, 0);

  const texW: number = (img as any).width  ?? 0;
  const texH: number = (img as any).height ?? 0;
  if (!texW || !texH) return new THREE.Color(0, 0, 0);

  // ------ PATH A: RGBELoader DataTexture â†’ Float32Array (HDR linear values) ------------------
  // This is the primary path when user loads a .hdr file via RGBELoader
  const rawData = (img as any).data;
  if (rawData instanceof Float32Array || rawData instanceof Uint16Array) {
    const px = u * texW - 0.5;
    const py = v * texH - 0.5;

    // Clamp to valid range
    const x0 = Math.max(0, Math.min(texW - 1, Math.floor(px)));
    const y0 = Math.max(0, Math.min(texH - 1, Math.floor(py)));
    const x1 = Math.min(texW - 1, x0 + 1);
    const y1 = Math.min(texH - 1, y0 + 1);
    const fx = px - Math.floor(px);
    const fy = py - Math.floor(py);

    // 4 corner indices (RGBA = 4 floats per pixel)
    const i00 = (y0 * texW + x0) * 4;
    const i10 = (y0 * texW + x1) * 4;
    const i01 = (y1 * texW + x0) * 4;
    const i11 = (y1 * texW + x1) * 4;

    // Bilinear weights
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx       * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx       * fy;

// RGBELoader returns a Uint16Array of IEEE-754 binary16 (half-float) BITS,
    // not plain integers. Dividing by 65535 treats the raw bit pattern as a
    // magnitude, which is meaningless - it destroys the HDR values entirely.
    // Decode the bits properly instead.
    const isU16 = rawData instanceof Uint16Array;
    const toF = (v: number): number => {
      if (!isU16) return v;
      const sign = (v & 0x8000) ? -1 : 1;
      const exp  = (v & 0x7C00) >> 10;
      const frac =  v & 0x03FF;
      if (exp === 0)      return sign * Math.pow(2, -14) * (frac / 1024);
      if (exp === 0x1F)   return frac ? NaN : sign * Infinity;
      return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
    };

    const r = (toF(rawData[i00])   * w00 + toF(rawData[i10])   * w10 +
               toF(rawData[i01])   * w01 + toF(rawData[i11])   * w11) * intensity;
    const g = (toF(rawData[i00+1]) * w00 + toF(rawData[i10+1]) * w10 +
               toF(rawData[i01+1]) * w01 + toF(rawData[i11+1]) * w11) * intensity;
    const b = (toF(rawData[i00+2]) * w00 + toF(rawData[i10+2]) * w10 +
               toF(rawData[i01+2]) * w01 + toF(rawData[i11+2]) * w11) * intensity;

    return new THREE.Color(Math.max(0, r), Math.max(0, g), Math.max(0, b));
  }

  // ------ PATH B: Uint8Array DataTexture ---------------------------------------------------------------------------------------------------------------------------
  if (rawData instanceof Uint8Array || rawData instanceof Uint8ClampedArray) {
    const px = Math.max(0, Math.min(texW - 1, Math.floor(u * texW)));
    const py = Math.max(0, Math.min(texH - 1, Math.floor(v * texH)));
    const idx = (py * texW + px) * 4;
    return new THREE.Color(
      sRGBToLinear(rawData[idx]   / 255) * intensity,
      sRGBToLinear(rawData[idx+1] / 255) * intensity,
      sRGBToLinear(rawData[idx+2] / 255) * intensity,
    );
  }

  // ------ PATH C: HTMLImageElement / HTMLVideoElement (draw to canvas) ------------------------------------
  if (img instanceof HTMLImageElement ||
      img instanceof HTMLVideoElement ||
      img instanceof HTMLCanvasElement) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = Math.min(texW, 512); // Cap for performance
      canvas.height = Math.min(texH, 256);
      const scaleX = canvas.width  / texW;
      const scaleY = canvas.height / texH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return new THREE.Color(0, 0, 0);
      ctx.drawImage(img as HTMLImageElement, 0, 0, canvas.width, canvas.height);
      const px2 = Math.max(0, Math.min(canvas.width  - 1, Math.floor(u * texW * scaleX)));
      const py2 = Math.max(0, Math.min(canvas.height - 1, Math.floor(v * texH * scaleY)));
      const pixel = ctx.getImageData(px2, py2, 1, 1).data;
      return new THREE.Color(
        sRGBToLinear(pixel[0] / 255) * intensity,
        sRGBToLinear(pixel[1] / 255) * intensity,
        sRGBToLinear(pixel[2] / 255) * intensity,
      );
    } catch {
      return new THREE.Color(0, 0, 0);
    }
  }

  // ------ PATH D: ImageData ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  if (img instanceof ImageData) {
    const px = Math.max(0, Math.min(texW - 1, Math.floor(u * texW)));
    const py = Math.max(0, Math.min(texH - 1, Math.floor(v * texH)));
    const idx = (py * texW + px) * 4;
    return new THREE.Color(
      sRGBToLinear(img.data[idx]   / 255) * intensity,
      sRGBToLinear(img.data[idx+1] / 255) * intensity,
      sRGBToLinear(img.data[idx+2] / 255) * intensity,
    );
  }

  return new THREE.Color(0, 0, 0);
}


/**
 * Convert sRGB gamma value to linear (Stage 5: linear color space mandatory).
 */
function sRGBToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

// --------- FUNCTION 6: encodeHDR - Radiance RGBE ---------------------------------------------------------------------------------------------------------

/**
 * Encode HDR pixel data into a Radiance RGBE .hdr file (ArrayBuffer).
 *
 * Stage 6 (File Encoding): RGBE format
 *   R, G, B = mantissa bytes (0-255)
 *   E = shared exponent (biased +128)
 *   Decoded value = RGB Ã— 2^(Eâˆ’128) / 256
 *   Range: 10^-38 to 10^38
 *
 * Header format (exact):
 *   #?RADIANCE\n
 *   SOFTWARE=LightForge Studio\n
 *   FORMAT=32-bit_rle_rgbe\n
 *   EXPOSURE=1.0\n
 *   \n
 *   -Y {height} +X {width}\n
 *
 * Input: RGBA Float32Array (4 floats/pixel, top-to-bottom, linear).
 *
 * @param pixels - Float32Array of RGBA (4 floats/pixel, linear, top-to-bottom).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .hdr file as ArrayBuffer.
 */
export function encodeHDR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  const headerText =
    '#?RADIANCE\n' +
    'SOFTWARE=LightForge Studio\n' +
    'FORMAT=32-bit_rle_rgbe\n' +
    'EXPOSURE=1.0\n' +
    `\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(headerText);

  const pixelDataSize = width * height * 4;
  const pixelData = new Uint8Array(pixelDataSize);

  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    rgbFloatToRGBE(r, g, b, pixelData, i * 4);
  }

  const buffer = new ArrayBuffer(headerBytes.length + pixelDataSize);
  const view = new Uint8Array(buffer);
  view.set(headerBytes, 0);
  view.set(pixelData, headerBytes.length);
  return buffer;
}

/**
 * Convert a single RGB float triplet to Radiance RGBE (4 bytes).
 *
 * Algorithm:
 *   maxVal = max(r, g, b)
 *   if maxVal < 1e-32: output [0,0,0,0]
 *   else:
 *     exp = floor(log2(maxVal)) + 1
 *     correction: if maxVal * 2^(-exp) < 0.5: exp--
 *                 if maxVal * 2^(-exp) >= 1.0: exp++
 *     scale = 2^(-exp) * 256
 *     R/G/B = clamp(floor(component * scale), 0, 255)
 *     E = clamp(exp + 128, 0, 255)
 */
function rgbFloatToRGBE(
  r: number,
  g: number,
  b: number,
  out: Uint8Array,
  off: number,
): void {
  const maxVal = Math.max(r, g, b);

  if (maxVal < 1e-32) {
    out[off] = 0;
    out[off + 1] = 0;
    out[off + 2] = 0;
    out[off + 3] = 0;
    return;
  }

  let exp = Math.floor(Math.log2(maxVal)) + 1;

  // Correction pass: ensure mantissa is in [0.5, 1.0)
  const scaled = maxVal * Math.pow(2, -exp);
  if (scaled < 0.5) {
    exp--;
  } else if (scaled >= 1.0) {
    exp++;
  }

  const scale = Math.pow(2, -exp) * 256.0;
  out[off] = Math.max(0, Math.min(255, Math.floor(r * scale)));
  out[off + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
  out[off + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
  out[off + 3] = Math.max(0, Math.min(255, exp + 128));
}

// --------- FUNCTION 7: encodeEXR - OpenEXR ------------------------------------------------------------------------------------------------------------------------

/**
 * Encode HDR pixel data into an OpenEXR .exr file (ArrayBuffer).
 *
 * Stage 6 (File Encoding): OpenEXR format
 *   Channels: B, G, R (alphabetical order, float32)
 *   Compression: NO_COMPRESSION (0)
 *   Magic: 0x762F3101 (20000630 decimal), Version: 2
 *
 * Input: RGBA Float32Array (4 floats/pixel, top-to-bottom, linear).
 * Alpha in input is ignored; no alpha channel in output (RGB only).
 *
 * @param pixels - Float32Array of RGBA (4 floats/pixel, linear, top-to-bottom).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Complete .exr file as ArrayBuffer.
 */
export function encodeEXR(
  pixels: Float32Array,
  width: number,
  height: number,
): ArrayBuffer {
  const CHANNEL_NAMES = ['B', 'G', 'R'] as const;
  const PIXEL_TYPE_FLOAT = 2;
  const NUM_CHANNELS = 3;
  const BYTES_PER_PIXEL = NUM_CHANNELS * 4;
  const SCANLINE_DATA_SIZE = width * BYTES_PER_PIXEL;

  // ------ Low-level write helpers ------------------------------------------------------------------------------------------------------------------------------------------
  const intToBytes = (val: number): number[] => [
    val & 0xff,
    (val >>> 8) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 24) & 0xff,
  ];

  const floatToBytes = (val: number): number[] => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    return [...new Uint8Array(buf)];
  };

  const writeName = (arr: number[], str: string): void => {
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) arr.push(b);
    arr.push(0);
  };

  const writeChannelEntry = (arr: number[], name: string): void => {
    const bytes = new TextEncoder().encode(name);
    for (const b of bytes) arr.push(b);
    arr.push(0);
    const nameLen = bytes.length + 1;
    const pad = (4 - (nameLen % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
    // pixel_type(i32) + pLinear(u32) + x_sampling(u32) + y_sampling(u32)
    for (const v of intToBytes(PIXEL_TYPE_FLOAT)) arr.push(v);
    for (const v of intToBytes(0)) arr.push(v);
    for (const v of intToBytes(1)) arr.push(v);
    for (const v of intToBytes(1)) arr.push(v);
  };

  const writeAttrValue = (arr: number[], valueBytes: number[]): void => {
    for (const v of intToBytes(valueBytes.length)) arr.push(v);
    for (const b of valueBytes) arr.push(b);
    const pad = (4 - (valueBytes.length % 4)) % 4;
    for (let i = 0; i < pad; i++) arr.push(0);
  };

  // ------ Build header attributes ------------------------------------------------------------------------------------------------------------------------------------------
  const hdr: number[] = [];

  // 1) channels (chlist)
  writeName(hdr, 'channels');
  writeName(hdr, 'chlist');
  const channelData: number[] = [];
  for (const chName of CHANNEL_NAMES) {
    writeChannelEntry(channelData, chName);
  }
  channelData.push(0);
  writeAttrValue(hdr, channelData);

  // 2) compression
  writeName(hdr, 'compression');
  writeName(hdr, 'compression');
  writeAttrValue(hdr, [0]);

  // 3) dataWindow (box2i)
  writeName(hdr, 'dataWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0), ...intToBytes(0),
    ...intToBytes(width - 1), ...intToBytes(height - 1),
  ]);

  // 4) displayWindow (box2i)
  writeName(hdr, 'displayWindow');
  writeName(hdr, 'box2i');
  writeAttrValue(hdr, [
    ...intToBytes(0), ...intToBytes(0),
    ...intToBytes(width - 1), ...intToBytes(height - 1),
  ]);

  // 5) lineOrder
  writeName(hdr, 'lineOrder');
  writeName(hdr, 'lineOrder');
  writeAttrValue(hdr, [0]);

  // 6) pixelAspectRatio
  writeName(hdr, 'pixelAspectRatio');
  writeName(hdr, 'float');
  writeAttrValue(hdr, floatToBytes(1.0));

  // 7) screenWindowCenter (v2f)
  writeName(hdr, 'screenWindowCenter');
  writeName(hdr, 'v2f');
  writeAttrValue(hdr, [...floatToBytes(0.0), ...floatToBytes(0.0)]);

  // 8) screenWindowWidth
  writeName(hdr, 'screenWindowWidth');
  writeName(hdr, 'float');
  writeAttrValue(hdr, floatToBytes(1.0));

  // End of header
  hdr.push(0);
  while (hdr.length % 8 !== 0) hdr.push(0);

  const fileHeaderSize = 8;
  const headerSize = hdr.length;
  const offsetTableSize = height * 8;
  const scanlineDataStart = fileHeaderSize + headerSize + offsetTableSize;
  const scanlineBlockSize = 4 + 4 + SCANLINE_DATA_SIZE;

  // ------ Offset table ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(scanlineDataStart + y * scanlineBlockSize);
  }

  // ------ Scanline pixel data ---------------------------------------------------------------------------------------------------------------------------------------------------
  const scanlines: number[] = [];
  for (let y = 0; y < height; y++) {
    for (const v of intToBytes(y)) scanlines.push(v);
    for (const v of intToBytes(SCANLINE_DATA_SIZE)) scanlines.push(v);
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      for (const b of floatToBytes(pixels[srcIdx + 2])) scanlines.push(b); // B
      for (const b of floatToBytes(pixels[srcIdx + 1])) scanlines.push(b); // G
      for (const b of floatToBytes(pixels[srcIdx])) scanlines.push(b);     // R
    }
  }

  // ------ Assemble file ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const totalSize = fileHeaderSize + headerSize + offsetTableSize + scanlines.length;
  const file = new Uint8Array(totalSize);
  const dv = new DataView(file.buffer);

  dv.setUint32(0, 20000630, true);
  dv.setUint32(4, 2, true);

  file.set(new Uint8Array(hdr), 8);

  const offsetBase = fileHeaderSize + headerSize;
  for (let y = 0; y < height; y++) {
    const off = offsets[y];
    dv.setUint32(offsetBase + y * 8, off & 0xffffffff, true);
    dv.setUint32(offsetBase + y * 8 + 4, Math.floor(off / 0x100000000) & 0xffffffff, true);
  }

  file.set(new Uint8Array(scanlines), scanlineDataStart);

  return file.buffer;
}

// --------- FUNCTION 8: downloadHDRI ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Generate and download a true HDR equirectangular image from scene lights.
 *
 * This is the main entry point for HDRI export. It analytically computes
 * radiance for every pixel (no CubeCamera, no WebGL rendering), then
 * encodes and downloads the result as .hdr or .exr.
 *
 * @param scene   - The THREE.Scene containing lights to export.
 * @param options - Export configuration (resolution, format, env settings).
 */
export async function downloadHDRI(
  scene: THREE.Scene,
  options: HDRIExportOptions,
): Promise<void> {
  const { width, height, format, capturePoint, filename } = options;

  const cp = capturePoint ?? new THREE.Vector3(0, 0, 0);

  // Resolve environment layers:
  //   1. Explicitly passed layers win.
  //   2. Otherwise auto-load EVERY active asset from the HDRI asset store.
  //   3. Legacy single-texture fields are a last-resort fallback.
  let layers: EnvLayer[] =
    options.environmentLayers ??
    (await loadActiveHDRILayers(options.environmentGlobalIntensity ?? 1.0));

  // Gradient background acts as its own environment layer, same as a real
  // loaded HDRI, so the exported file matches what the HDRI Preview panel
  // shows instead of coming out black whenever no real .hdr is active.
  if (!options.environmentLayers) {
    const gb = useSceneStore.getState().environment.gradientBackground;
    if (gb?.enabled) {
      layers.push(gradientToEnvLayer(gb, options.environmentGlobalIntensity ?? 1.0));
    }
  }

  if (layers.length === 0 && options.includeEnvironment && options.environmentTexture) {
    layers = [
      {
        texture: options.environmentTexture as THREE.DataTexture,
        intensity: options.environmentIntensity ?? 1.0,
        rotation: options.environmentRotation ?? 0,
      },
    ];
  }

  console.log(
    `[LightForge HDRI] Generating ${width}x${height} ${format.toUpperCase()} - ` +
    `${layers.length} env layer(s)`,
  );

  const pixels = await generateAnalyticalHDRI(scene, width, height, cp, layers);

  // Bake View Exposure into the exported data as a linear multiplier, so the
  // file's brightness matches what the HDRI Preview panel and viewport show.
  // Still a plain scalar (no Reinhard/gamma), so values stay unbounded and
  // the file remains true HDR - just scaled, the same way exposure works as
  // a linear stops multiplier on a real camera.
  const exposure = options.viewExposure ?? useSceneStore.getState().renderSettings.exposure;
  if (exposure !== 1.0) {
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] *= exposure;
    }
    console.log(`[LightForge HDRI] Baked View Exposure ${exposure.toFixed(2)}x into exported data`);
  }

  const baseName = filename ?? `lightforge_hdri_${Date.now()}`;
  const ext = format === 'hdr' ? '.hdr' : '.exr';
  const mimeType = format === 'hdr' ? 'image/vnd.radiance' : 'image/x-exr';

  const buffer: ArrayBuffer =
    format === 'hdr'
      ? encodeHDR(pixels, width, height)
      : encodeEXR(pixels, width, height);

  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}${ext}`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (link.parentNode) link.parentNode.removeChild(link);
  }, 250);

  console.log(`[LightForge HDRI] Export complete: ${baseName}${ext}`);
}

// --------- Environment texture loader ------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Load a raw .hdr ArrayBuffer into a THREE.DataTexture via RGBELoader.
 */
function loadHDRITexture(buffer: ArrayBuffer): Promise<THREE.DataTexture | null> {
  return new Promise<THREE.DataTexture | null>((resolve) => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const loader = new RGBELoader();
    loader.load(
      url,
      (texture) => {
        URL.revokeObjectURL(url);
        resolve(texture);
      },
      undefined,
      () => {
        URL.revokeObjectURL(url);
        resolve(null);
      },
    );
  });
}

/**
 * Load EVERY active HDRI asset from the asset store as an EnvLayer.
 *
 * This is what makes the export environment-agnostic: whatever HDRIs the user
 * has toggled Active in the ENV panel get baked in - one, several, or none.
 * Each layer keeps its own per-asset intensity and rotation; the global
 * intensity is folded in on top.
 *
 * @param globalIntensity - Global env intensity from the ENV panel (default 1.0).
 * @returns One EnvLayer per active, decodable asset. Empty array = lights only.
 */
/**
 * Render the gradient background config to an equirectangular canvas and wrap
 * it as an EnvLayer, so it flows through the exact same sampling path as a real
 * loaded .hdr file (sampleEnvTexture's Path C reads texture.image as a canvas).
 * Without this, the gradient only ever painted scene.background - it never
 * reached the exporter or the HDRI preview, which both read EnvLayer[].
 */
export interface GradientBackgroundConfig {
  type: 'linear' | 'radial' | 'conic';
  angle: number;
  stops: { color: string; position: number; opacity: number }[];
}

/**
 * Paint the gradient background directly onto an existing 2D context.
 * Factored out of gradientToEnvLayer so the HDRI Shapes compositor can use
 * the exact same gradient as its base fill, with shapes painted on top in
 * the SAME canvas (true alpha-over compositing) rather than as a separate
 * additive env layer, which is what makes a black shape actually block the
 * gradient beneath it instead of just contributing zero on top of it.
 */
export function paintGradientOntoContext(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: GradientBackgroundConfig,
): void {
  let gradient: CanvasGradient;
  if (config.type === 'radial') {
    gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
  } else {
    const rad = (config.angle * Math.PI) / 180;
    const x1 = w / 2 - (Math.cos(rad) * w) / 2;
    const y1 = h / 2 - (Math.sin(rad) * h) / 2;
    const x2 = w / 2 + (Math.cos(rad) * w) / 2;
    const y2 = h / 2 + (Math.sin(rad) * h) / 2;
    gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  }

  // Use the authored hex directly as a CSS color - canvas 2D operates in
  // sRGB display space, so routing it through THREE.Color first would
  // silently decode it to linear light and darken every stop when
  // Math.round(c.r * 255) re-treats it as 0-255 sRGB.
  const sorted = [...config.stops].sort((a, b) => a.position - b.position);
  for (const stop of sorted) {
    const clean = stop.color.replace('#', '');
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    gradient.addColorStop(stop.position, `rgba(${r}, ${g}, ${b}, ${stop.opacity})`);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

export function gradientToEnvLayer(config: GradientBackgroundConfig, intensity = 1.0): EnvLayer {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  paintGradientOntoContext(ctx, w, h, config);

  // Read the canvas ONCE into an ImageData buffer. sampleEnvTexture's canvas
  // path (Path C) calls getImageData(px, py, 1, 1) per sampled pixel, which is
  // a full readback every call - thousands of readbacks per preview render.
  // Routing through Path D (raw ImageData) indexes a typed array directly
  // instead, which is what made this hang.
  const imageData = ctx.getImageData(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas) as unknown as THREE.DataTexture;
  (tex as unknown as { image: ImageData }).image = imageData;

  return { texture: tex, intensity, rotation: 0 };
}

export async function loadActiveHDRILayers(globalIntensity = 1.0): Promise<EnvLayer[]> {
  const assets = useHDRIAssetStore
    .getState()
    .assets.filter((a) => a.active && a.dataBase64);

  if (assets.length === 0) {
    console.log('[LightForge HDRI] No active HDRI assets - exporting lights only');
    return [];
  }

  const layers: EnvLayer[] = [];

  for (const asset of assets) {
    try {
      const buffer = hdriBase64ToArrayBuffer(asset.dataBase64 as string);
      const texture = await loadHDRITexture(buffer);

      if (!texture) {
        console.warn(`[LightForge HDRI] Could not decode "${asset.name}" - skipping`);
        continue;
      }

      const img = texture.image as { width?: number; height?: number; data?: { constructor: { name: string } } };

      layers.push({
        texture,
        intensity: asset.intensity * globalIntensity,
        rotation: (asset.rotation * Math.PI) / 180,
        opacity: asset.opacity,
        contrast: asset.contrast,
        gamma: asset.gamma,
        saturation: asset.saturation,
      });

      console.log(
        `[LightForge HDRI] Env layer "${asset.name}" - ` +
        `${img?.width}x${img?.height}, ` +
        `type ${img?.data?.constructor?.name}, ` +
        `intensity ${(asset.intensity * globalIntensity).toFixed(2)}, ` +
        `rotation ${asset.rotation}deg`,
      );
    } catch (e) {
      console.warn(`[LightForge HDRI] Error loading "${asset.name}":`, e);
    }
  }

  return layers;
}

// --------- Convenience wrappers (backward-compatible with TopMenubar) ------------------------------------------

/**
 * Export the scene as a Radiance .hdr file using analytical generation.
 *
 * @deprecated Use downloadHDRI() directly for more control over options.
 * @param renderer - WebGL renderer (unused in analytical mode, kept for API compat).
 * @param scene    - The THREE.Scene containing lights.
 * @param options  - Export size and optional filename.
 */
export async function exportSceneAsHDR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string; environmentIntensity?: number },
): Promise<void> {
  void renderer; // unused in analytical mode - kept for API compatibility

  const resolution = options?.size ?? 2048;
  const height = Math.floor(resolution / 2);

  await downloadHDRI(scene, {
    width: resolution as 512 | 1024 | 2048 | 4096,
    height: height as 256 | 512 | 1024 | 2048,
    format: 'hdr',
    environmentGlobalIntensity: options?.environmentIntensity ?? 1.0,
    filename: options?.filename,
  });
}

/**
 * Export the scene as an OpenEXR .exr file using analytical generation.
 *
 * @deprecated Use downloadHDRI() directly for more control over options.
 * @param renderer - WebGL renderer (unused in analytical mode, kept for API compat).
 * @param scene    - The THREE.Scene containing lights.
 * @param options  - Export size and optional filename.
 */
export async function exportSceneAsEXR(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options?: { size?: number; filename?: string; environmentIntensity?: number },
): Promise<void> {
  void renderer; // unused in analytical mode - kept for API compatibility

  const resolution = options?.size ?? 2048;
  const height = Math.floor(resolution / 2);

  await downloadHDRI(scene, {
    width: resolution as 512 | 1024 | 2048 | 4096,
    height: height as 256 | 512 | 1024 | 2048,
    format: 'exr',
    environmentGlobalIntensity: options?.environmentIntensity ?? 1.0,
    filename: options?.filename,
  });
}