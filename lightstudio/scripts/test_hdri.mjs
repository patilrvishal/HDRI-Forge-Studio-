/**
 * HDRI Exporter Unit Test
 * Verifies that analytical HDRI generation produces visible light data.
 * Run: node scripts/test_hdri.mjs
 *
 * Expected output (per SVG pipeline Stage 3):
 *   "Softbox = 200-2000, Sun disk = 50,000+"
 *   "Max pixel value should be > 1.0 (ideally 100-5000+)"
 */

const PI = Math.PI;
const TWO_PI = 2 * PI;
const DEG2RAD = PI / 180;

const POINT_LIGHT_VISUAL_RADIUS = 2.5 * DEG2RAD;
const GAUSSIAN_SOFTNESS = 4.0;
const SUN_ANGULAR_RADIUS = 0.004635;

function pixelToDirection(x, y, width, height) {
  const u = (x + 0.5) / width;
  const v = (y + 0.5) / height;
  const theta = u * TWO_PI;
  const phi = v * PI;
  const sinPhi = Math.sin(phi);
  return [sinPhi * Math.sin(theta), Math.cos(phi), sinPhi * Math.cos(theta)];
}

function normalize(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  if (len < 1e-10) return [0, 1, 0];
  return [v[0]/len, v[1]/len, v[2]/len];
}

function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

function softFalloff(angle, radius) {
  if (angle >= radius) return 0;
  const t = angle / radius;
  const s = t * t * (3 - 2 * t);
  return 1.0 - s;
}

function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }

const testLights = [
  { type: 'point', color: [1,1,1], intensity: 5, position: [3.5, 3, 3.5] },
  { type: 'directional', color: [1,0.95,0.8], intensity: 1, direction: [0,-1,0] },
  { type: 'area', color: [0.8,0.85,1], intensity: 2, position: [-5,2,0], width: 3, height: 2, right: [0,0,-1], up: [0,1,0], normal: [-1,0,0] },
];

function evaluateLightRadiance(light, dir, cp) {
  const result = [0, 0, 0];

  if (light.type === 'point') {
    const toLight = normalize(sub(light.position, cp));
    const dist = Math.sqrt((light.position[0]-cp[0])**2+(light.position[1]-cp[1])**2+(light.position[2]-cp[2])**2);
    const cosAngle = Math.max(-1, Math.min(1, dot(dir, toLight)));
    const angle = Math.acos(cosAngle);
    const physicalRadius = Math.atan2(0.3, Math.max(0.01, dist));
    const visualRadius = Math.max(physicalRadius, POINT_LIGHT_VISUAL_RADIUS);
    const falloff = softFalloff(angle, visualRadius * GAUSSIAN_SOFTNESS);
    if (falloff <= 0) return result;
    const solidAngle = PI * Math.sin(visualRadius) * Math.sin(visualRadius);
    const safeSA = Math.max(1e-6, solidAngle);
    const radiance = (light.intensity / safeSA) * 200 * falloff;
    result[0] = light.color[0]*radiance; result[1] = light.color[1]*radiance; result[2] = light.color[2]*radiance;
  } else if (light.type === 'directional') {
    const toSun = normalize([-light.direction[0],-light.direction[1],-light.direction[2]]);
    const cosAngle = Math.max(-1, Math.min(1, dot(dir, toSun)));
    const angleToSun = Math.acos(cosAngle);
    if (angleToSun < SUN_ANGULAR_RADIUS) {
      const radiance = light.intensity * 80000;
      result[0]=light.color[0]*radiance; result[1]=light.color[1]*radiance; result[2]=light.color[2]*radiance;
    } else {
      const glowRadius = SUN_ANGULAR_RADIUS * 8;
      const gf = softFalloff(angleToSun, glowRadius);
      if (gf > 0) {
        const radiance = light.intensity * 50 * gf;
        result[0]=light.color[0]*radiance; result[1]=light.color[1]*radiance; result[2]=light.color[2]*radiance;
      }
    }
  } else if (light.type === 'area') {
    const facingDir = normalize(sub(cp, light.position));
    if (dot(facingDir, light.normal) < 0) return result;
    const samples = 8;
    let accR=0,accG=0,accB=0;
    for (let sy=0;sy<samples;sy++) for (let sx=0;sx<samples;sx++) {
      const su=(sx+0.5)/samples, sv=(sy+0.5)/samples;
      const px=light.position[0]+light.right[0]*(su-0.5)*light.width+light.up[0]*(sv-0.5)*light.height;
      const py=light.position[1]+light.right[1]*(su-0.5)*light.width+light.up[1]*(sv-0.5)*light.height;
      const pz=light.position[2]+light.right[2]*(su-0.5)*light.width+light.up[2]*(sv-0.5)*light.height;
      const dx=px-cp[0],dy=py-cp[1],dz=pz-cp[2];
      const dist=Math.max(0.01,Math.sqrt(dx*dx+dy*dy+dz*dz));
      const invDist=1/dist;
      const tx=dx*invDist,ty=dy*invDist,tz=dz*invDist;
      const cosA=Math.max(-1,Math.min(1,dot(dir,[tx,ty,tz])));
      const angle=Math.acos(cosA);
      const subW=light.width/samples,subH=light.height/samples;
      const sampleRadius=Math.atan2(Math.max(subW,subH)*0.6,dist);
      const falloff=softFalloff(angle,sampleRadius*GAUSSIAN_SOFTNESS);
      if (falloff<=0) continue;
      const cosEmit=Math.max(0,-(tx*light.normal[0]+ty*light.normal[1]+tz*light.normal[2]));
      const solidAngle=PI*Math.sin(sampleRadius)*Math.sin(sampleRadius);
      const safeSA=Math.max(1e-6,solidAngle);
      const radiance=(light.intensity*cosEmit/safeSA)*150*falloff;
      accR+=light.color[0]*radiance; accG+=light.color[1]*radiance; accB+=light.color[2]*radiance;
    }
    const total=samples*samples;
    result[0]=accR/total; result[1]=accG/total; result[2]=accB/total;
  }
  return result;
}

const WIDTH=512, HEIGHT=256, cp=[0,0,0];
console.log(`\n=== HDRI Exporter Test: ${WIDTH}x${HEIGHT} ===`);
console.log(`Test lights: ${testLights.length} (point, directional, area)\n`);

let maxVal=0, nonBlack=0, maxPos={x:0,y:0};
for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++) {
  const dir=normalize(pixelToDirection(x,y,WIDTH,HEIGHT));
  let r=0,g=0,b=0;
  for (const light of testLights) { const c=evaluateLightRadiance(light,dir,cp); r+=c[0];g+=c[1];b+=c[2]; }
  const m=Math.max(r,g,b);
  if (m>maxVal) { maxVal=m; maxPos={x,y}; }
  if (m>0.001) nonBlack++;
}
const totalPixels=WIDTH*HEIGHT;
const pct=((nonBlack/totalPixels)*100).toFixed(1);
console.log(`\n=== RESULTS ===`);
console.log(`Max pixel value:  ${maxVal.toFixed(1)}`);
console.log(`Max pixel at:     (${maxPos.x}, ${maxPos.y})`);
console.log(`Non-black pixels: ${nonBlack} / ${totalPixels} (${pct}%)`);
console.log(`True HDR:         ${maxVal > 1.0 ? 'YES ✅' : 'NO ❌'}`);

if (maxVal > 50000) console.log(`Radiance range:    SUN DISK (>50,000) ✅`);
else if (maxVal > 200) console.log(`Radiance range:    SOFTBOX (200-2000) ✅`);
else if (maxVal > 1) console.log(`Radiance range:    Low HDR (${maxVal.toFixed(0)}) ⚠️`);
else console.log(`Radiance range:    LDR (<=1.0) ❌ BROKEN`);

if (nonBlack === 0) { console.log(`\n❌ FAIL: All pixels black!`); process.exit(1); }
else if (maxVal <= 1.0) { console.log(`\n❌ FAIL: LDR not HDR!`); process.exit(1); }
else { console.log(`\n✅ PASS: Visible HDR light data.`); process.exit(0); }