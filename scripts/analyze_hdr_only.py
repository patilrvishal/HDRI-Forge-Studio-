#!/usr/bin/env python3
"""HDR pixel stats with correct Radiance RLE decode."""
import struct, numpy as np

with open('/home/z/my-project/upload/ferndale_studio_07_2k.hdr', 'rb') as f:
    data = f.read()

header_end = data.index(b'\n\n')
dims_start = header_end + 2
newline_pos = data.index(b'\n', dims_start)
dims = data[dims_start:newline_pos].decode('ascii').strip().split()
width, height = int(dims[3]), int(dims[1])
pixel_data = data[newline_pos + 1:]
print(f"Size: {width}x{height}, pixel data: {len(pixel_data):,} bytes")

# Radiance new RLE format:
# Each scanline starts with: 0x02, 0x02, width_hi, width_lo
# Then 4 channels of RLE data

pixels_r, pixels_g, pixels_b = [], [], []
offset = 0

for row in range(height):
    if width < 8 or width > 32768:
        # Flat (no RLE)
        for col in range(width):
            if offset + 4 > len(pixel_data): break
            r, g, b, e = pixel_data[offset:offset+4]; offset += 4
            if e == 0:
                pixels_r.append(0.0); pixels_g.append(0.0); pixels_b.append(0.0)
            else:
                s = 2.0 ** (e - 128 - 8)
                pixels_r.append(r * s); pixels_g.append(g * s); pixels_b.append(b * s)
    else:
        # RLE scanline: check for marker [0x02, 0x02, w_hi, w_lo]
        if (offset + 4 <= len(pixel_data) and 
            pixel_data[offset] == 2 and pixel_data[offset+1] == 2):
            offset += 2  # skip marker bytes
            w = (pixel_data[offset] << 8) | pixel_data[offset+1]
            offset += 2
            assert w == width, f"Row {row}: width {w} != {width}"
            
            # Decode 4 channels
            ch_data = [[], [], [], []]
            for ch in range(4):
                count = 0
                while count < width:
                    code = pixel_data[offset]; offset += 1
                    if code > 128:
                        run_len = code - 128
                        val = pixel_data[offset]; offset += 1
                        ch_data[ch].extend([val] * run_len)
                        count += run_len
                    else:
                        literal_len = code
                        ch_data[ch].extend(pixel_data[offset:offset+literal_len])
                        offset += literal_len
                        count += literal_len
            
            for col in range(width):
                r, g, b, e = ch_data[0][col], ch_data[1][col], ch_data[2][col], ch_data[3][col]
                if e == 0:
                    pixels_r.append(0.0); pixels_g.append(0.0); pixels_b.append(0.0)
                else:
                    s = 2.0 ** (e - 128 - 8)
                    pixels_r.append(r * s); pixels_g.append(g * s); pixels_b.append(b * s)
        else:
            # Old-style RLE or flat
            for col in range(width):
                if offset + 4 > len(pixel_data): break
                r, g, b, e = pixel_data[offset:offset+4]; offset += 4
                if e == 0:
                    pixels_r.append(0.0); pixels_g.append(0.0); pixels_b.append(0.0)
                else:
                    s = 2.0 ** (e - 128 - 8)
                    pixels_r.append(r * s); pixels_g.append(g * s); pixels_b.append(b * s)

r_arr = np.array(pixels_r, dtype=np.float64)
g_arr = np.array(pixels_g, dtype=np.float64)
b_arr = np.array(pixels_b, dtype=np.float64)
total = len(r_arr)
print(f"Decoded: {total:,} pixels (expected {width*height:,}), consumed: {offset:,}/{len(pixel_data):,} bytes")

for name, arr in [('R', r_arr), ('G', g_arr), ('B', b_arr)]:
    print(f"\n  {name}:")
    print(f"    Min:    {arr.min():.6f}")
    print(f"    Max:    {arr.max():.6f}")
    print(f"    Mean:   {arr.mean():.6f}")
    print(f"    Median: {np.median(arr):.6f}")
    p = np.percentile(arr, [50, 90, 95, 99, 99.5, 99.9])
    print(f"    P50:{p[0]:.4f} P90:{p[1]:.4f} P95:{p[2]:.4f} P99:{p[3]:.4f} P99.5:{p[4]:.4f} P99.9:{p[5]:.4f}")
    above1 = np.sum(arr > 1.0)
    below01 = np.sum(arr < 0.01)
    is_zero = np.sum(arr == 0.0)
    print(f"    >1.0: {above1:,} ({100*above1/total:.1f}%)")
    print(f"    <0.01: {below01:,} ({100*below01/total:.1f}%)")
    print(f"    =0.0: {is_zero:,} ({100*is_zero/total:.1f}%)")

lum = 0.2126*r_arr + 0.7152*g_arr + 0.0722*b_arr
nz = lum[lum > 0]
print(f"\n  Luminance: min={lum.min():.6f} max={lum.max():.6f} median={np.median(lum):.6f}")
if len(nz) > 0:
    print(f"  Dynamic range: {nz.max()/nz.min():.0f}x ({np.log2(nz.max()/nz.min()):.1f} stops)")