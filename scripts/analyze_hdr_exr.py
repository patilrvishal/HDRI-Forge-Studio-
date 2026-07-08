#!/usr/bin/env python3
"""
Analyze reference HDR and EXR files: binary headers, pixel value statistics.
"""
import struct
import os
import numpy as np

def analyze_hdr(filepath):
    print(f"\n{'='*70}")
    print(f"HDR ANALYSIS: {os.path.basename(filepath)}")
    print(f"{'='*70}")
    print(f"File size: {os.path.getsize(filepath):,} bytes")
    
    with open(filepath, 'rb') as f:
        data = f.read()
    
    # Parse header
    header_end = data.index(b'\n\n')
    header_text = data[:header_end].decode('ascii', errors='replace')
    print(f"\n--- HEADER ---")
    for line in header_text.split('\n'):
        print(f"  {line}")
    
    # Dimensions line: read until newline
    dims_start = header_end + 2
    newline_pos = data.index(b'\n', dims_start)
    dims_line = data[dims_start:newline_pos].decode('ascii').strip()
    parts = dims_line.split()
    height = int(parts[1])
    width = int(parts[3])
    print(f"\n  Dimensions: {width} x {height}")
    
    pixel_start = newline_pos + 1
    pixel_data = data[pixel_start:]
    
    encoding = 'RLE' if b'FORMAT=32-bit_rle_rgbe' in header_text.encode('ascii') else 'flat'
    print(f"  Encoding: {encoding}")
    print(f"  Pixel data offset: {pixel_start}")
    print(f"  Pixel data size: {len(pixel_data):,} bytes")
    print(f"  Expected flat: {width * height * 4:,} bytes")
    
    # Decode RGBE pixels (handle both flat and RLE)
    pixels = []
    scanline_offset = 0
    
    for row in range(height):
        if width < 8 or width > 32768:
            # Flat encoding
            for col in range(width):
                if scanline_offset + 4 > len(pixel_data):
                    break
                r, g, b, e = pixel_data[scanline_offset:scanline_offset+4]
                scanline_offset += 4
                if e == 0:
                    pixels.extend([0.0, 0.0, 0.0])
                else:
                    scale = np.ldexp(1.0, int(e) - (128 + 8))
                    pixels.extend([r * scale, g * scale, b * scale])
        else:
            # Check for RLE scanline marker
            if scanline_offset + 4 > len(pixel_data):
                break
            rle_width = struct.unpack('>I', pixel_data[scanline_offset:scanline_offset+4])[0]
            
            if rle_width != width:
                # Not RLE, decode as flat from this point
                for col in range(width):
                    if scanline_offset + 4 > len(pixel_data):
                        break
                    r, g, b, e = pixel_data[scanline_offset:scanline_offset+4]
                    scanline_offset += 4
                    if e == 0:
                        pixels.extend([0.0, 0.0, 0.0])
                    else:
                        scale = np.ldexp(1.0, int(e) - (128 + 8))
                        pixels.extend([r * scale, g * scale, b * scale])
                continue
            
            scanline_offset += 4
            channel_data = [[], [], [], []]
            for ch in range(4):
                count = 0
                while count < width:
                    if scanline_offset >= len(pixel_data):
                        break
                    code = pixel_data[scanline_offset]
                    scanline_offset += 1
                    if code > 128:
                        run_len = code - 128
                        if scanline_offset >= len(pixel_data):
                            break
                        val = pixel_data[scanline_offset]
                        scanline_offset += 1
                        channel_data[ch].extend([val] * run_len)
                        count += run_len
                    else:
                        literal_len = code
                        channel_data[ch].extend(pixel_data[scanline_offset:scanline_offset+literal_len])
                        scanline_offset += literal_len
                        count += literal_len
                while len(channel_data[ch]) < width:
                    channel_data[ch].append(0)
            
            for col in range(width):
                r, g, b, e = channel_data[0][col], channel_data[1][col], channel_data[2][col], channel_data[3][col]
                if e == 0:
                    pixels.extend([0.0, 0.0, 0.0])
                else:
                    scale = np.ldexp(1.0, int(e) - (128 + 8))
                    pixels.extend([r * scale, g * scale, b * scale])
    
    pixels = np.array(pixels, dtype=np.float32).reshape(-1, 3)
    luminance = 0.2126 * pixels[:, 0] + 0.7152 * pixels[:, 1] + 0.0722 * pixels[:, 2]
    
    print(f"\n--- PIXEL VALUE STATISTICS ---")
    for i, ch in enumerate(['R', 'G', 'B']):
        vals = pixels[:, i]
        print(f"\n  {ch} channel:")
        print(f"    Min:     {vals.min():.6f}")
        print(f"    Max:     {vals.max():.6f}")
        print(f"    Mean:    {vals.mean():.6f}")
        print(f"    StdDev:  {vals.std():.6f}")
        print(f"    Median:  {np.median(vals):.6f}")
        p = np.percentile(vals, [99, 99.5, 99.9, 99.99, 100])
        print(f"    P99:     {p[0]:.4f}")
        print(f"    P99.5:   {p[1]:.4f}")
        print(f"    P99.9:   {p[2]:.4f}")
        print(f"    P99.99:  {p[3]:.4f}")
        print(f"    P100:    {p[4]:.4f}")
        above_1 = np.sum(vals > 1.0)
        print(f"    Pixels > 1.0: {above_1:,} ({100*above_1/len(vals):.2f}%)")
        zero_count = np.sum(vals == 0.0)
        print(f"    Pixels = 0.0: {zero_count:,} ({100*zero_count/len(vals):.2f}%)")
        near_black = np.sum(vals < 0.01)
        print(f"    Pixels < 0.01: {near_black:,} ({100*near_black/len(vals):.2f}%)")
    
    print(f"\n  Luminance (Y):")
    print(f"    Min:     {luminance.min():.6f}")
    print(f"    Max:     {luminance.max():.6f}")
    print(f"    Mean:    {luminance.mean():.6f}")
    print(f"    Median:  {np.median(luminance):.6f}")
    
    nonzero = luminance[luminance > 0]
    if len(nonzero) > 0:
        print(f"\n  Dynamic Range:")
        print(f"    Max/Min (non-zero): {nonzero.max()/max(nonzero.min(), 1e-10):.1f}x")
        print(f"    Max/Median: {nonzero.max()/np.median(nonzero):.1f}x")
        print(f"    Stops (log2(max/min)): {np.log2(nonzero.max()/max(nonzero.min(), 1e-10)):.1f} stops")
    
    return {'width': width, 'height': height, 'pixels': pixels, 'header_text': header_text, 'encoding': encoding}


def analyze_exr(filepath):
    print(f"\n{'='*70}")
    print(f"EXR ANALYSIS: {os.path.basename(filepath)}")
    print(f"{'='*70}")
    print(f"File size: {os.path.getsize(filepath):,} bytes")
    
    with open(filepath, 'rb') as f:
        magic = f.read(4)
        print(f"\n  Magic: {magic.hex()} ({struct.unpack('<I', magic)[0]})")
        
        version = struct.unpack('<I', f.read(4))[0]
        print(f"  Version: {version:#010x}")
        print(f"    Version number: {version & 0xFF}")
        print(f"    Tiled: {bool(version & (1 << 9))}")
        print(f"    Long names: {bool(version & (1 << 10))}")
        print(f"    Deep data: {bool(version & (1 << 12))}")
        print(f"    Multi-part: {bool(version & (1 << 13))}")
        
        print(f"\n--- HEADER ATTRIBUTES ---")
        channels = []
        compression = None
        data_window = None
        display_window = None
        line_order = None
        pixel_aspect = None
        comp_str = 'N/A'
        
        while True:
            name_bytes = b''
            while True:
                ch = f.read(1)
                if ch == b'\x00' or ch == b'':
                    break
                name_bytes += ch
            
            if not name_bytes:
                break
            
            name = name_bytes.decode('ascii')
            
            type_bytes = b''
            while True:
                ch = f.read(1)
                if ch == b'\x00' or ch == b'':
                    break
                type_bytes += ch
            attr_type = type_bytes.decode('ascii')
            
            size = struct.unpack('<i', f.read(4))[0]
            value = f.read(size)
            
            print(f"  {name}: type={attr_type}, size={size}", end='')
            
            if name == 'channels':
                pos = 0
                while pos < size:
                    ch_name = b''
                    while pos < size and value[pos] != 0:
                        ch_name += bytes([value[pos]])
                        pos += 1
                    pos += 1
                    if pos + 16 > size:
                        break
                    ch_pixel_type = struct.unpack('<i', value[pos:pos+4])[0]
                    pos += 4
                    p_linear = struct.unpack('<I', value[pos:pos+4])[0]
                    pos += 4
                    ch_x_sampling = struct.unpack('<I', value[pos:pos+4])[0]
                    pos += 4
                    ch_y_sampling = struct.unpack('<I', value[pos:pos+4])[0]
                    pos += 4
                    pixel_type_str = {0: 'UINT', 1: 'HALF', 2: 'FLOAT'}.get(ch_pixel_type, f'UNKNOWN({ch_pixel_type})')
                    channels.append({
                        'name': ch_name.decode('ascii'),
                        'pixel_type': ch_pixel_type,
                        'pixel_type_str': pixel_type_str,
                        'p_linear': bool(p_linear),
                        'x_sampling': ch_x_sampling,
                        'y_sampling': ch_y_sampling
                    })
                print(f" -> {len(channels)} channels:")
                for c in channels:
                    print(f"      {c['name']}: {c['pixel_type_str']}, pLinear={c['p_linear']}, sampling=({c['x_sampling']},{c['y_sampling']})")
            elif name == 'compression':
                compression = struct.unpack('B', value)[0]
                comp_str = {0: 'NO_COMPRESSION', 1: 'RLE', 2: 'ZIPS', 3: 'ZIP', 4: 'PIZ', 5: 'PXR24', 6: 'B44', 7: 'B44A', 8: 'DWAA', 9: 'DWAB'}.get(compression, f'UNKNOWN({compression})')
                print(f" -> {comp_str}")
            elif name == 'dataWindow':
                xmin, ymin, xmax, ymax = struct.unpack('<iiii', value)
                data_window = (xmin, ymin, xmax, ymax)
                print(f" -> ({xmin}, {ymin}) to ({xmax}, {ymax}) => {xmax-xmin+1} x {ymax-ymin+1}")
            elif name == 'displayWindow':
                xmin, ymin, xmax, ymax = struct.unpack('<iiii', value)
                display_window = (xmin, ymin, xmax, ymax)
                print(f" -> ({xmin}, {ymin}) to ({xmax}, {ymax}) => {xmax-xmin+1} x {ymax-ymin+1}")
            elif name == 'lineOrder':
                line_order = struct.unpack('B', value)[0]
                lo_str = {0: 'INCREASING_Y', 1: 'DECREASING_Y', 2: 'RANDOM_Y'}.get(line_order, f'UNKNOWN({line_order})')
                print(f" -> {lo_str}")
            elif name == 'pixelAspectRatio':
                pixel_aspect = struct.unpack('<f', value)[0]
                print(f" -> {pixel_aspect}")
            else:
                try:
                    print(f" -> {value.decode('ascii').strip()}")
                except:
                    print(f" -> (binary, {len(value)} bytes)")
        
        width = data_window[2] - data_window[0] + 1 if data_window else 0
        height = data_window[3] - data_window[1] + 1 if data_window else 0
        print(f"\n  Effective dimensions: {width} x {height}")
        
        # Try OpenEXR library for pixel stats
        try:
            import OpenEXR
            import Imath
            print(f"\n  Using OpenEXR Python library for pixel analysis...")
            exr_file = OpenEXR.InputFile(filepath)
            header = exr_file.header()
            dw = header['dataWindow']
            exr_w = dw.max.x - dw.min.x + 1
            exr_h = dw.max.y - dw.min.y + 1
            ch_names = list(header['channels'].keys())
            print(f"  OpenEXR: {exr_w} x {exr_h}, channels: {ch_names}")
            
            pt = Imath.PixelType(Imath.PixelType.FLOAT)
            if 'R' in ch_names and 'G' in ch_names and 'B' in ch_names:
                r = np.frombuffer(exr_file.channel('R', pt), dtype=np.float32).reshape(exr_h, exr_w)
                g = np.frombuffer(exr_file.channel('G', pt), dtype=np.float32).reshape(exr_h, exr_w)
                b = np.frombuffer(exr_file.channel('B', pt), dtype=np.float32).reshape(exr_h, exr_w)
                
                print(f"\n--- PIXEL VALUE STATISTICS ---")
                for name, arr in [('R', r), ('G', g), ('B', b)]:
                    vals = arr.flatten()
                    print(f"\n  {name} channel:")
                    print(f"    Min:     {vals.min():.6f}")
                    print(f"    Max:     {vals.max():.6f}")
                    print(f"    Mean:    {vals.mean():.6f}")
                    print(f"    StdDev:  {vals.std():.6f}")
                    print(f"    Median:  {np.median(vals):.6f}")
                    p = np.percentile(vals, [99, 99.5, 99.9, 99.99, 100])
                    print(f"    P99:     {p[0]:.4f}")
                    print(f"    P99.5:   {p[1]:.4f}")
                    print(f"    P99.9:   {p[2]:.4f}")
                    print(f"    P99.99:  {p[3]:.4f}")
                    print(f"    P100:    {p[4]:.4f}")
                    above_1 = np.sum(vals > 1.0)
                    print(f"    Pixels > 1.0: {above_1:,} ({100*above_1/len(vals):.2f}%)")
                    zero_count = np.sum(vals == 0.0)
                    print(f"    Pixels = 0.0: {zero_count:,} ({100*zero_count/len(vals):.2f}%)")
                    near_black = np.sum(vals < 0.01)
                    print(f"    Pixels < 0.01: {near_black:,} ({100*near_black/len(vals):.2f}%)")
                
                lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
                print(f"\n  Luminance (Y):")
                print(f"    Min:     {lum.min():.6f}")
                print(f"    Max:     {lum.max():.6f}")
                print(f"    Mean:    {lum.mean():.6f}")
                print(f"    Median:  {np.median(lum):.6f}")
                nonzero = lum[lum > 0]
                if len(nonzero) > 0:
                    print(f"\n  Dynamic Range:")
                    print(f"    Max/Min (non-zero): {nonzero.max()/max(nonzero.min(), 1e-10):.1f}x")
                    print(f"    Max/Median: {nonzero.max()/np.median(nonzero):.1f}x")
                    print(f"    Stops (log2(max/min)): {np.log2(nonzero.max()/max(nonzero.min(), 1e-10)):.1f} stops")
                
                if 'A' in ch_names:
                    a = np.frombuffer(exr_file.channel('A', pt), dtype=np.float32).reshape(exr_h, exr_w)
                    print(f"\n  Alpha: min={a.min():.6f}, max={a.max():.6f}, all_ones={np.all(a == 1.0)}")
                
            exr_file.close()
        except ImportError:
            print(f"\n  OpenEXR Python lib not available, skipping pixel analysis")
        
        return {
            'width': width, 'height': height, 'channels': channels,
            'compression': compression, 'compression_str': comp_str,
            'data_window': data_window, 'display_window': display_window,
            'line_order': line_order, 'pixel_aspect_ratio': pixel_aspect,
        }


if __name__ == '__main__':
    hdr_info = analyze_hdr('/home/z/my-project/upload/ferndale_studio_07_2k.hdr')
    exr_info = analyze_exr('/home/z/my-project/upload/ferndale_studio_07_1k.exr')
    
    print(f"\n{'='*70}")
    print(f"KEY SPECS FOR HDRIExporter COMPARISON")
    print(f"{'='*70}")
    print(f"\n  HDR:")
    print(f"    Dimensions: {hdr_info['width']}x{hdr_info['height']}")
    print(f"    Encoding: {hdr_info['encoding']}")
    print(f"    Header lines: {hdr_info['header_text'].split(chr(10))}")
    
    print(f"\n  EXR:")
    print(f"    Dimensions: {exr_info['width']}x{exr_info['height']}")
    print(f"    Channels: {[(c['name'], c['pixel_type_str']) for c in exr_info['channels']]}")
    print(f"    Compression: {exr_info['compression_str']}")
    print(f"    Line order: {exr_info['line_order']}")