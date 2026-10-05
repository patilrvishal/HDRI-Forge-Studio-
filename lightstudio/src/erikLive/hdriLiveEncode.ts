/**
 * Encoders for the Erik live link.
 *
 * Erik's engine reads Radiance .hdr (new-style RLE, like Photoshop writes) and a
 * tiny text .ash file holding order-2 spherical harmonics for diffuse lighting.
 * Conventions below were verified numerically against real Erik project files
 * (DAY environment: 0.3% mean error against the shipped .ash).
 */

/** float RGB -> Radiance RGBE (4 bytes) */
function rgbe(r: number, g: number, b: number, out: Uint8Array, o: number): void {
  const m = Math.max(r, g, b);
  if (!(m > 1e-32) || !Number.isFinite(m)) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
  let e = Math.floor(Math.log2(m)) + 1;
  let s = Math.pow(2, -e) * 256;
  const sc = m * Math.pow(2, -e);
  if (sc < 0.5) { e--; s = Math.pow(2, -e) * 256; } else if (sc >= 1) { e++; s = Math.pow(2, -e) * 256; }
  out[o] = Math.max(0, Math.min(255, Math.floor(r * s)));
  out[o + 1] = Math.max(0, Math.min(255, Math.floor(g * s)));
  out[o + 2] = Math.max(0, Math.min(255, Math.floor(b * s)));
  out[o + 3] = Math.max(0, Math.min(255, e + 128));
}

function rleChannel(src: Uint8Array, w: number, out: Uint8Array, op: number): number {
  let i = 0;
  while (i < w) {
    let run = 1;
    while (i + run < w && src[i + run] === src[i] && run < 127) run++;
    if (run >= 4) {
      out[op++] = 128 + run; out[op++] = src[i]; i += run;
    } else {
      const start = i;
      let n = 0;
      while (i < w && n < 128) {
        let r2 = 1;
        while (i + r2 < w && src[i + r2] === src[i] && r2 < 4) r2++;
        if (r2 >= 4) break;
        i++; n++;
      }
      if (n === 0) { n = 1; i = start + 1; }
      out[op++] = n;
      for (let k = 0; k < n; k++) out[op++] = src[start + k];
    }
  }
  return op;
}

/** Encode linear RGBA float pixels (top row first) as a Radiance RLE .hdr. Width must be 8..32767. */
export function encodeHDRRLE(pixels: Float32Array, width: number, height: number): Uint8Array {
  const head = new TextEncoder().encode(
    `#?RADIANCE\nSOFTWARE=HDRI Forge Studio (Erik live link)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
  );
  // worst case per scanline: 4 header bytes + 4 channels * (width + width/128 + 2)
  const out = new Uint8Array(head.length + height * (4 + 4 * (width + Math.ceil(width / 128) + 2)));
  out.set(head, 0);
  let op = head.length;
  const px = new Uint8Array(width * 4);
  const ch = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgbe(pixels[i], pixels[i + 1], pixels[i + 2], px, x * 4);
    }
    for (let x = 0; x < width; x++) {
      ch[0][x] = px[x * 4]; ch[1][x] = px[x * 4 + 1]; ch[2][x] = px[x * 4 + 2]; ch[3][x] = px[x * 4 + 3];
    }
    out[op++] = 2; out[op++] = 2; out[op++] = (width >> 8) & 255; out[op++] = width & 255;
    for (let c = 0; c < 4; c++) op = rleChannel(ch[c], width, out, op);
  }
  return out.slice(0, op);
}

/** Cosine-convolution band factors baked into Erik's .ash files (irradiance-ready). */
const BAND = [Math.PI, (2 * Math.PI) / 3, (2 * Math.PI) / 3, (2 * Math.PI) / 3,
  Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4];

const SH_C = [
  0.5 * Math.sqrt(1 / Math.PI), 0.5 * Math.sqrt(3 / Math.PI), 0.5 * Math.sqrt(3 / Math.PI), 0.5 * Math.sqrt(3 / Math.PI),
  0.5 * Math.sqrt(15 / Math.PI), 0.5 * Math.sqrt(15 / Math.PI), 0.25 * Math.sqrt(5 / Math.PI),
  0.5 * Math.sqrt(15 / Math.PI), 0.25 * Math.sqrt(15 / Math.PI),
];

/**
 * Order-2 SH (9 x RGB) from an equirect map, a verbatim port of
 * @derschmale/spherical-harmonizer generateSH({irradiance: true}) - the tool that made the
 * project's own .ash files (verified: identical coefficients on the project's DAY map).
 * Same sampling positions (x/width, no half-pixel), axes, cos(latitude) weighting and
 * band factors, so a map run through that tool and through Forge gives the same .ash.
 */
export function computeAshSH9(pixels: Float32Array, width: number, height: number): number[][] {
  const cosU = new Float64Array(width), sinU = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const u = -((x / width) * 2 - 1) + 0.5;
    cosU[x] = Math.cos(u * Math.PI); sinU[x] = Math.sin(u * Math.PI);
  }
  const acc = new Float64Array(27);
  let total = 0;
  for (let y = 0; y < height; y++) {
    const phi = ((y / height) * 2 - 1) * Math.PI / 2;
    const cp = Math.cos(phi), ny = -Math.sin(phi);
    for (let x = 0; x < width; x++) {
      const nx = cosU[x] * cp, nz = sinU[x] * cp;
      const t = [
        SH_C[0], SH_C[1] * ny, SH_C[2] * nz, SH_C[3] * nx,
        SH_C[4] * nx * ny, SH_C[5] * ny * nz, SH_C[6] * (3 * nz * nz - 1), SH_C[7] * nz * nx, SH_C[8] * (nx * nx - ny * ny),
      ];
      const i = (y * width + x) * 4;
      const r = pixels[i] * cp, g = pixels[i + 1] * cp, b = pixels[i + 2] * cp;
      for (let k = 0; k < 9; k++) {
        acc[k * 3] += t[k] * r; acc[k * 3 + 1] += t[k] * g; acc[k * 3 + 2] += t[k] * b;
      }
    }
    total += cp * width;
  }
  const out: number[][] = [];
  for (let k = 0; k < 9; k++) {
    const sc = (BAND[k] * Math.PI * 4) / total;
    out.push([acc[k * 3] * sc, acc[k * 3 + 1] * sc, acc[k * 3 + 2] * sc]);
  }
  return out;
}

export function formatAsh(c: number[][]): string {
  // plain decimals only (no exponent notation) so any .ash parser reads it
  const row = (k: number) => c[k].map((v) => (Number.isFinite(v) ? v : 0).toFixed(9)).join(' ');
  return (
    '# Generated with @derschmale/spherical-harmonizer\n\n' +
    `l=0:\nm=0: ${row(0)}\n\n` +
    `l=1:\nm=-1: ${row(1)}\nm=0: ${row(2)}\nm=1: ${row(3)}\n\n` +
    `l=2:\nm=-2: ${row(4)}\nm=-1: ${row(5)}\nm=0: ${row(6)}\nm=1: ${row(7)}\nm=2: ${row(8)}\n`
  );
}
