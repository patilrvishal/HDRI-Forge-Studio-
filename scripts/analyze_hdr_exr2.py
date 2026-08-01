#!/usr/bin/env python3
"""
Quick pixel stats from HDR/EXR using proper libraries.
"""
import numpy as np
import subprocess, sys

# Try to read EXR with OpenEXR
print("="*60)
print("EXR PIXEL STATS (via Python OpenEXR)")
print("="*60)
try:
    import OpenEXR
    import Imath
    exr = OpenEXR.InputFile('/home/z/my-project/upload/ferndale_studio_07_1k.exr')
    h = exr.header()
    dw = h['dataWindow']
    w = dw.max.x - dw.min.x + 1
    ht = dw.max.y - dw.min.y + 1
    ch_names = sorted(h['channels'].keys())  # alphabetical: A, B, G, R
    print(f"Size: {w}x{ht}, Channels: {ch_names}")
    
    pt = Imath.PixelType(Imath.PixelType.FLOAT)
    for name in ['R', 'G', 'B', 'A']:
        if name in ch_names:
            raw = exr.channel(name, pt)
            arr = np.frombuffer(raw, dtype=np.float32).reshape(ht, w)
            vals = arr.flatten()
            # Use float64 for stats to avoid overflow
            vals64 = vals.astype(np.float64)
            print(f"\n  {name}:")
            print(f"    Min:    {vals64.min():.6f}")
            print(f"    Max:    {vals64.max():.6f}")
            print(f"    Mean:   {vals64.mean():.6f}")
            print(f"    Median: {np.median(vals64):.6f}")
            p = np.percentile(vals64, [50, 90, 95, 99, 99.5, 99.9])
            print(f"    P50:{p[0]:.4f} P90:{p[1]:.4f} P95:{p[2]:.4f} P99:{p[3]:.4f} P99.5:{p[4]:.4f} P99.9:{p[5]:.4f}")
            above1 = np.sum(vals64 > 1.0)
            below01 = np.sum(vals64 < 0.01)
            is_zero = np.sum(vals64 == 0.0)
            print(f"    >1.0: {above1:,} ({100*above1/len(vals64):.1f}%)")
            print(f"    <0.01: {below01:,} ({100*below01/len(vals64):.1f}%)")
            print(f"    =0.0: {is_zero:,} ({100*is_zero/len(vals64):.1f}%)")
    
    # Luminance
    r = np.frombuffer(exr.channel('R', pt), dtype=np.float32).reshape(ht, w).astype(np.float64)
    g = np.frombuffer(exr.channel('G', pt), dtype=np.float32).reshape(ht, w).astype(np.float64)
    b = np.frombuffer(exr.channel('B', pt), dtype=np.float32).reshape(ht, w).astype(np.float64)
    lum = 0.2126*r + 0.7152*g + 0.0722*b
    nz = lum[lum > 0]
    print(f"\n  Luminance: min={lum.min():.6f} max={lum.max():.6f} median={np.median(lum):.6f}")
    if len(nz) > 0:
        print(f"  Dynamic range: {nz.max()/nz.min():.0f}x ({np.log2(nz.max()/nz.min()):.1f} stops)")
    
    exr.close()
except Exception as e:
    print(f"ERROR: {e}")

# Try to read HDR using OpenEXR too (it can read RGBE)
print(f"\n{'='*60}")
print("HDR PIXEL STATS (decoded via Python)")
print("="*60)
try:
    # Use OpenEXR to read the HDR as float
    # Or use the radiance library
    # Let's use a simple approach: convert to EXR first, or read directly
    
    # Actually, let's use the built-in RGBE decode with float64
    with open('/home/z/my-project/upload/ferndale_studio_07_2k.hdr', 'rb') as f:
        data = f.read()
    
    header_end = data.index(b'\n\n')
    dims_start = header_end + 2
    newline_pos = data.index(b'\n', dims_start)
    dims = data[dims_start:newline_pos].decode('ascii').strip().split()
    width, height = int(dims[3]), int(dims[1])
    pixel_data = data[newline_pos + 1:]
    
    print(f"Size: {width}x{height}")
    print(f"Pixel data: {len(pixel_data):,} bytes")
    
    # Use OpenEXR to read the HDR if it supports it
    # Otherwise, use a proper RGBE decode
    # Let's use the rgbe format approach but with float64
    import struct
    
    pixels_r = []
    pixels_g = []
    pixels_b = []
    
    offset = 0
    for row in range(height):
        if width >= 8 and width <= 32768:
            # RLE: read scanline width marker
            rle_w = struct.unpack('>I', pixel_data[offset:offset+4])[0]
            offset += 4
            if rle_w != width:
                # Not RLE, treat as flat
                offset -= 4
                for col in range(width):
                    r, g, b, e = pixel_data[offset:offset+4]
                    offset += 4
                    if e == 0:
                        pixels_r.append(0.0)
                        pixels_g.append(0.0)
                        pixels_b.append(0.0)
                    else:
                        s = 2.0 ** (e - 128 - 8)
                        pixels_r.append(r * s)
                        pixels_g.append(g * s)
                        pixels_b.append(b * s)
                continue
            
            # Decode 4 channels RLE
            ch_data = [[], [], [], []]
            for ch in range(4):
                count = 0
                while count < width and offset < len(pixel_data):
                    code = pixel_data[offset]
                    offset += 1
                    if code > 128:
                        run = code - 128
                        val = pixel_data[offset]
                        offset += 1
                        ch_data[ch].extend([val] * run)
                        count += run
                    else:
                        lit = code
                        ch_data[ch].extend(pixel_data[offset:offset+lit])
                        offset += lit
                        count += lit
                while len(ch_data[ch]) < width:
                    ch_data[ch].append(0)
            
            for col in range(width):
                r, g, b, e = ch_data[0][col], ch_data[1][col], ch_data[2][col], ch_data[3][col]
                if e == 0:
                    pixels_r.append(0.0)
                    pixels_g.append(0.0)
                    pixels_b.append(0.0)
                else:
                    s = 2.0 ** (e - 128 - 8)
                    pixels_r.append(r * s)
                    pixels_g.append(g * s)
                    pixels_b.append(b * s)
        else:
            for col in range(width):
                r, g, b, e = pixel_data[offset:offset+4]
                offset += 4
                if e == 0:
                    pixels_r.append(0.0)
                    pixels_g.append(0.0)
                    pixels_b.append(0.0)
                else:
                    s = 2.0 ** (e - 128 - 8)
                    pixels_r.append(r * s)
                    pixels_g.append(g * s)
                    pixels_b.append(b * s)
    
    # Convert to numpy float64
    r_arr = np.array(pixels_r, dtype=np.float64)
    g_arr = np.array(pixels_g, dtype=np.float64)
    b_arr = np.array(pixels_b, dtype=np.float64)
    
    total = len(r_arr)
    print(f"Decoded pixels: {total:,} (expected {width*height:,})")
    
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
    
    # Check data consumed
    print(f"\n  Data consumed: {offset:,} / {len(pixel_data):,} bytes")
    
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"ERROR: {e}")