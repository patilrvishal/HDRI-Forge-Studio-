/**
 * Test script: Verify HDR and EXR encoding produces valid file structures.
 * Run: node scripts/test_hdri_encoding.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DOWNLOAD_DIR = join(PROJECT_ROOT, '..', 'download');

// ── Create test gradient pattern ────────────────────────────────────────────
function createTestPattern(width, height) {
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const u = x / (width - 1);
      const v = y / (height - 1);
      pixels[idx] = u * 4.0;        // R: 0 to 4 (HDR!)
      pixels[idx + 1] = v * 2.0;   // G: 0 to 2
      pixels[idx + 2] = 0.5;       // B: constant
      pixels[idx + 3] = 1.0;
    }
  }
  return pixels;
}

// ── RGBE encoding ───────────────────────────────────────────────────────────
function rgbFloatToRGBE(r, g, b, out, off) {
  const maxVal = Math.max(r, g, b);
  if (maxVal < 1e-32) { out[off] = out[off+1] = out[off+2] = out[off+3] = 0; return; }
  let exp = Math.floor(Math.log2(maxVal)) + 1;
  const scaled = maxVal * Math.pow(2, -exp);
  if (scaled < 0.5) exp--;
  else if (scaled >= 1.0) exp++;
  const scale = Math.pow(2, -exp) * 256.0;
  out[off] = Math.max(0, Math.min(255, Math.floor(r * scale)));
  out[off+1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
  out[off+2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
  out[off+3] = Math.max(0, Math.min(255, exp + 128));
}

function rleEncodeChannel(rgbeData, rowOffset, channel, width, out, outOff) {
  let written = 0, x = 0;
  while (x < width) {
    let runLen = 1;
    const val = rgbeData[rowOffset + x * 4 + channel];
    while (x + runLen < width && runLen < 128 && rgbeData[rowOffset + (x + runLen) * 4 + channel] === val) runLen++;
    if (runLen >= 3) {
      out[outOff + written++] = 0x80 | runLen;
      out[outOff + written++] = val;
      x += runLen;
    } else {
      let litLen = 0, litStart = x;
      while (litLen < 128 && x + litLen < width) {
        if (litLen > 0) {
          const nv = rgbeData[rowOffset + (x + litLen) * 4 + channel];
          let fr = 1;
          while (x + litLen + fr < width && fr < 3 && rgbeData[rowOffset + (x + litLen + fr) * 4 + channel] === nv) fr++;
          if (fr >= 3) break;
        }
        litLen++;
      }
      out[outOff + written++] = litLen;
      for (let i = 0; i < litLen; i++) out[outOff + written++] = rgbeData[rowOffset + (litStart + i) * 4 + channel];
      x += litLen;
    }
  }
  return written;
}

function encodeHDR(pixels, width, height) {
  const headerStr = '#?RADIANCE\nSOFTWARE=LightForge Studio\nFORMAT=32-bit_rle_rgbe\n\n-Y ' + height + ' +X ' + width + '\n';
  const headerBytes = Buffer.from(headerStr, 'utf-8');
  const rgbeData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgbFloatToRGBE(pixels[i*4], pixels[i*4+1], pixels[i*4+2], rgbeData, i*4);
  }
  const maxRLE = 4 + 4 * (128 + 128 * 2);
  const rleBuf = new Uint8Array(height * maxRLE);
  let rleOff = 0;
  for (let y = 0; y < height; y++) {
    rleBuf[rleOff++] = 0x02; rleBuf[rleOff++] = 0x02;
    rleBuf[rleOff++] = (width >> 8) & 0xFF; rleBuf[rleOff++] = width & 0xFF;
    for (let ch = 0; ch < 4; ch++) rleOff += rleEncodeChannel(rgbeData, y * width * 4, ch, width, rleBuf, rleOff);
  }
  return Buffer.concat([headerBytes, rleBuf.subarray(0, rleOff)]);
}

// ── EXR encoding (matching HDRIExporter.ts exactly) ─────────────────────────
function intToBytesLE(val) { const b = Buffer.alloc(4); b.writeInt32LE(val, 0); return b; }
function floatToBytesLE(val) { const b = Buffer.alloc(4); b.writeFloatLE(val, 0); return b; }

function buildChannelEntry(name) {
  const nameBytes = Buffer.from(name, 'utf-8');
  const nameWithNull = nameBytes.length + 1;
  const namePadded = nameWithNull + ((4 - (nameWithNull % 4)) % 4);
  const entry = Buffer.alloc(namePadded + 5 * 4);
  nameBytes.copy(entry, 0);
  const dv = new DataView(entry.buffer, entry.byteOffset);
  let off = namePadded;
  dv.setInt32(off, 2, true); off += 4; // FLOAT
  dv.setInt32(off, 0, true); off += 4; // pLinear
  dv.setInt32(off, 0, true); off += 4; // reserved
  dv.setInt32(off, 1, true); off += 4; // xSampling
  dv.setInt32(off, 1, true); off += 4; // ySampling (v2)
  return entry;
}

function buildAttribute(name, type, valueBuf) {
  const nameBytes = Buffer.from(name, 'utf-8');
  const typeBytes = Buffer.from(type, 'utf-8');
  const valuePadLen = (4 - (valueBuf.length % 4)) % 4;
  // OpenEXR spec: name\0 + type\0 + size(int32) + value + valuePad
  const totalSize = nameBytes.length + 1 + typeBytes.length + 1 + 4 + valueBuf.length + valuePadLen;
  const attr = Buffer.alloc(totalSize);
  const dv = new DataView(attr.buffer, attr.byteOffset);
  let off = 0;
  nameBytes.copy(attr, off); off += nameBytes.length + 1;
  typeBytes.copy(attr, off); off += typeBytes.length + 1;
  dv.setInt32(off, valueBuf.length, true); off += 4;
  valueBuf.copy(attr, off);
  return attr;
}

function encodeEXR(pixels, width, height) {
  const BYTES_PER_PIXEL = 3 * 4;
  const SCANLINE_PIXEL_DATA_SIZE = width * BYTES_PER_PIXEL;

  const channelEntries = ['B', 'G', 'R'].map(n => buildChannelEntry(n));
  const nullTerm = Buffer.alloc(1);
  const channelListValue = Buffer.concat([...channelEntries, nullTerm]);

  const compressionValue = Buffer.from([0]);
  const dwVal = Buffer.alloc(16);
  const dwDv = new DataView(dwVal.buffer, dwVal.byteOffset);
  dwDv.setInt32(0, 0, true); dwDv.setInt32(4, 0, true);
  dwDv.setInt32(8, width-1, true); dwDv.setInt32(12, height-1, true);

  const attrs = [
    buildAttribute('channels', 'chlist', channelListValue),
    buildAttribute('compression', 'compression', compressionValue),
    buildAttribute('dataWindow', 'box2i', dwVal),
    buildAttribute('displayWindow', 'box2i', Buffer.from(dwVal)),
    buildAttribute('lineOrder', 'lineOrder', Buffer.from([0])),
    buildAttribute('pixelAspectRatio', 'float', floatToBytesLE(1.0)),
    buildAttribute('screenWindowCenter', 'v2f', Buffer.concat([floatToBytesLE(0.0), floatToBytesLE(0.0)])),
    buildAttribute('screenWindowWidth', 'float', floatToBytesLE(1.0)),
  ];

  const headerContent = Buffer.concat(attrs);
  const prePad = Buffer.concat([headerContent, Buffer.alloc(1)]); // + end-of-header null
  const headerPadLen = (8 - (prePad.length % 8)) % 8;
  const headerBlock = Buffer.concat([prePad, Buffer.alloc(headerPadLen)]);

  const magicSize = 8;
  const offsetTableSize = height * 8;
  const scanlineDataStart = magicSize + headerBlock.length + offsetTableSize;
  const scanlineTotalSize = 8 + SCANLINE_PIXEL_DATA_SIZE;

  const offsetTable = Buffer.alloc(offsetTableSize);
  for (let y = 0; y < height; y++) {
    const offset = scanlineDataStart + y * scanlineTotalSize;
    offsetTable.writeUInt32LE(offset & 0xFFFFFFFF, y * 8);
    offsetTable.writeUInt32LE(Math.floor(offset / 0x100000000), y * 8 + 4);
  }

  const scanlineData = Buffer.alloc(height * scanlineTotalSize);
  for (let y = 0; y < height; y++) {
    const base = y * scanlineTotalSize;
    scanlineData.writeInt32LE(y, base);
    scanlineData.writeInt32LE(SCANLINE_PIXEL_DATA_SIZE, base + 4);
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const pi = base + 8 + x * 12;
      scanlineData.writeFloatLE(pixels[si+2], pi);
      scanlineData.writeFloatLE(pixels[si+1], pi+4);
      scanlineData.writeFloatLE(pixels[si], pi+8);
    }
  }

  const magicVer = Buffer.alloc(8);
  magicVer.writeUInt32LE(20000630, 0);
  magicVer.writeUInt32LE(2, 4);

  return Buffer.concat([magicVer, headerBlock, offsetTable, scanlineData]);
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateHDR(buf, w, h) {
  const errors = [];
  const text = buf.toString('ascii', 0, Math.min(buf.length, 300));
  if (!text.startsWith('#?RADIANCE')) errors.push('Missing #?RADIANCE');
  if (!text.includes('FORMAT=32-bit_rle_rgbe')) errors.push('Wrong FORMAT');
  const m = text.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!m) errors.push('No dimension line');
  else {
    if (parseInt(m[1]) !== h) errors.push(`Height: got ${m[1]}, expected ${h}`);
    if (parseInt(m[2]) !== w) errors.push(`Width: got ${m[2]}, expected ${w}`);
  }
  const headerEnd = buf.indexOf(0x0A, text.indexOf('-Y')) + 1;
  if (headerEnd + 4 <= buf.length) {
    if (buf[headerEnd] !== 0x02) errors.push(`Scanline[0]=${buf[headerEnd]}, expected 0x02`);
    if (buf[headerEnd+1] !== 0x02) errors.push(`Scanline[1]=${buf[headerEnd+1]}, expected 0x02`);
    const sw = (buf[headerEnd+2] << 8) | buf[headerEnd+3];
    if (sw !== w) errors.push(`Scanline width: ${sw}, expected ${w}`);
  } else errors.push('No scanline data');
  return errors;
}

function validateEXR(buf, w, h) {
  const errors = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 20000630) errors.push('Bad magic');
  if (dv.getUint32(4, true) !== 2) errors.push('Bad version');

  let off = 8;
  let foundChannels = false, foundCompression = false, foundDataWindow = false;
  let channelCount = 0;
  let iterations = 0;

  // Parse header attributes
  while (off < buf.length && iterations < 20) {
    iterations++;
    // Read attribute name (null-terminated, NO padding)
    const nameStart = off;
    while (off < buf.length && buf[off] !== 0) off++;
    if (off >= buf.length) break;
    const name = buf.toString('ascii', nameStart, off);
    off++; // skip null

    if (name === '') break; // end of header

    // Read attribute type (null-terminated, NO padding)
    const typeStart = off;
    while (off < buf.length && buf[off] !== 0) off++;
    const type = buf.toString('ascii', typeStart, off);
    off++; // skip null

    // Read size (int32 LE)
    if (off + 4 > buf.length) { errors.push('Truncated at size field'); break; }
    const size = dv.getUint32(off, true);
    off += 4;

    if (name === 'channels') {
      foundChannels = true;
      // Parse chlist value: channel entries + null terminator
      let chOff = off;
      const chEnd = off + size - 1; // -1 for null terminator
      while (chOff < chEnd) {
        const cnStart = chOff;
        while (chOff < chEnd && buf[chOff] !== 0) chOff++;
        const cn = buf.toString('ascii', cnStart, chOff);
        chOff++; // null
        // Pad channel name to 4 bytes
        const cnPadded = cn.length + 1 + ((4 - ((cn.length + 1) % 4)) % 4);
        chOff = cnStart + cnPadded;
        // 5 int32 fields (pixelType, pLinear, reserved, xSampling, ySampling)
        if (chOff + 20 <= buf.length) {
          const pt = dv.getUint32(chOff, true);
          if (pt !== 2) errors.push(`Channel ${cn}: pixelType=${pt}, expected 2`);
          const ys = dv.getUint32(chOff + 16, true);
          if (ys !== 1) errors.push(`Channel ${cn}: ySampling=${ys}, expected 1`);
          chOff += 20;
        } else { break; }
        if (cn.length > 0) channelCount++;
      }
    }

    if (name === 'compression') foundCompression = true;
    if (name === 'dataWindow') foundDataWindow = true;

    // Skip value + padding
    off += size;
    const valuePad = (4 - (size % 4)) % 4;
    off += valuePad;
  }

  if (!foundChannels) errors.push('Missing channels attr');
  if (!foundCompression) errors.push('Missing compression attr');
  if (!foundDataWindow) errors.push('Missing dataWindow attr');
  if (channelCount !== 3) errors.push(`Channel count: ${channelCount}, expected 3`);

  // After null byte, padding brings us to 8-byte alignment
  const paddedEnd = off + ((8 - (off % 8)) % 8);
  if (paddedEnd % 8 !== 0) errors.push(`Header end at ${off} padded to ${paddedEnd}, not 8-byte aligned`);

  return errors;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const W = 64, H = 32;
const pixels = createTestPattern(W, H);

console.log('=== Testing HDR Encoding ===');
const hdrBuf = encodeHDR(pixels, W, H);
console.log(`HDR size: ${hdrBuf.length} bytes`);
const hdrErrs = validateHDR(hdrBuf, W, H);
if (hdrErrs.length === 0) console.log('HDR: VALID ✓');
else { console.log('HDR: INVALID ✗'); hdrErrs.forEach(e => console.log(`  - ${e}`)); }

console.log('\n=== Testing EXR Encoding ===');
const exrBuf = encodeEXR(pixels, W, H);
console.log(`EXR size: ${exrBuf.length} bytes`);
const exrErrs = validateEXR(exrBuf, W, H);
if (exrErrs.length === 0) console.log('EXR: VALID ✓');
else { console.log('EXR: INVALID ✗'); exrErrs.forEach(e => console.log(`  - ${e}`)); }

// Write test files
try {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  writeFileSync(join(DOWNLOAD_DIR, 'test_hdri_export.hdr'), hdrBuf);
  writeFileSync(join(DOWNLOAD_DIR, 'test_hdri_export.exr'), exrBuf);
  console.log(`\nTest files written to ${DOWNLOAD_DIR}/`);
} catch (e) { console.log('\nWrite error:', e.message); }

const allOK = hdrErrs.length === 0 && exrErrs.length === 0;
console.log('\n' + (allOK ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'));
process.exit(allOK ? 0 : 1);