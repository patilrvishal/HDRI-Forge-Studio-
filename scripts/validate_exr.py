#!/usr/bin/env python3
"""Validate that our EXR encoder produces spec-compliant files by parsing the output."""
import struct

def parse_exr_header(filepath):
    """Parse EXR header and verify all attribute size fields are correct."""
    print(f"\nValidating: {filepath}")
    print(f"File size: {__import__('os').path.getsize(filepath):,} bytes")
    
    with open(filepath, 'rb') as f:
        # Magic + version
        magic = struct.unpack('<I', f.read(4))[0]
        version = struct.unpack('<I', f.read(4))[0]
        
        assert magic == 20000630, f"Bad magic: {magic:#x}"
        assert (version & 0xFF) == 2, f"Bad version: {version:#x}"
        print(f"  Magic: OK, Version: OK")
        
        # Parse attributes
        attr_count = 0
        while True:
            # Read attribute name
            name = b''
            while True:
                c = f.read(1)
                if c == b'\x00' or c == b'':
                    break
                name += c
            
            if not name:
                print(f"  End of header marker: OK")
                break
            
            # Read type
            type_name = b''
            while True:
                c = f.read(1)
                if c == b'\x00' or c == b'':
                    break
                type_name += c
            
            # Read size
            size = struct.unpack('<i', f.read(4))[0]
            
            # Read value
            value = f.read(size)
            
            # Skip padding
            pad = (4 - (size % 4)) % 4
            if pad > 0:
                f.read(pad)
            
            attr_name = name.decode('ascii')
            attr_type = type_name.decode('ascii')
            
            # Validate
            print(f"  Attr: {attr_name} (type={attr_type}, size={size})", end='')
            
            if attr_name == 'channels' and attr_type == 'chlist':
                # Parse channel list
                pos = 0
                ch_count = 0
                while pos < size and value[pos] != 0:
                    # Channel name
                    ch_name = b''
                    while pos < size and value[pos] != 0:
                        ch_name += bytes([value[pos]])
                        pos += 1
                    pos += 1  # null
                    # Pad to 4
                    ch_name_len = len(ch_name) + 1
                    ch_pad = (4 - (ch_name_len % 4)) % 4
                    pos += ch_pad
                    # Properties
                    pt = struct.unpack('<i', value[pos:pos+4])[0]; pos += 4
                    pl = struct.unpack('<I', value[pos:pos+4])[0]; pos += 4
                    xs = struct.unpack('<I', value[pos:pos+4])[0]; pos += 4
                    ys = struct.unpack('<I', value[pos:pos+4])[0]; pos += 4
                    pt_str = {0:'UINT',1:'HALF',2:'FLOAT'}.get(pt, f'?{pt}')
                    ch_count += 1
                    print(f"\n    -> {ch_name.decode()}: {pt_str} pLinear={bool(pl)} samp=({xs},{ys})", end='')
                # Check terminator
                assert value[pos] == 0, "Missing channel list terminator!"
                print(f"\n    -> {ch_count} channels + terminator = {size} bytes: OK", end='')
            
            elif attr_name == 'compression':
                comp_val = value[0]
                comp_str = {0:'NO_COMPRESSION',1:'RLE',2:'ZIPS',3:'ZIP',4:'PIZ'}.get(comp_val, f'?{comp_val}')
                assert size == 1, f"Compression size should be 1, got {size}"
                print(f" -> {comp_str}: OK", end='')
            
            elif attr_name in ('dataWindow', 'displayWindow'):
                xmin, ymin, xmax, ymax = struct.unpack('<iiii', value)
                assert size == 16, f"box2i size should be 16, got {size}"
                print(f" -> ({xmin},{ymin})-({xmax},{ymax}) [{xmax-xmin+1}x{ymax-ymin+1}]: OK", end='')
            
            elif attr_name == 'lineOrder':
                lo = {0:'INCREASING_Y',1:'DECREASING_Y'}.get(value[0], f'?{value[0]}')
                assert size == 1, f"lineOrder size should be 1, got {size}"
                print(f" -> {lo}: OK", end='')
            
            elif attr_name == 'pixelAspectRatio':
                par = struct.unpack('<f', value)[0]
                assert size == 4, f"pixelAspectRatio size should be 4, got {size}"
                print(f" -> {par}: OK", end='')
            
            elif attr_name == 'screenWindowCenter':
                cx, cy = struct.unpack('<ff', value)
                assert size == 8, f"screenWindowCenter size should be 8, got {size}"
                print(f" -> ({cx}, {cy}): OK", end='')
            
            elif attr_name == 'screenWindowWidth':
                sw = struct.unpack('<f', value)[0]
                assert size == 4, f"screenWindowWidth size should be 4, got {size}"
                print(f" -> {sw}: OK", end='')
            
            else:
                print(f" -> ({len(value)} bytes)", end='')
            
            attr_count += 1
            print()
        
        # Check header padding to 8-byte boundary
        pos = f.tell()
        print(f"\n  Header end at byte {pos}")
        assert pos % 8 == 0, f"Header not 8-byte aligned! pos={pos}"
        print(f"  8-byte alignment: OK")
        
        # Check offset table
        # We can't fully validate without knowing the exact image size,
        # but we can check the first offset
        first_offset = struct.unpack('<Q', f.read(8))[0]
        print(f"  First scanline offset: {first_offset}")
        
        print(f"\n  Total attributes: {attr_count}")
        print(f"  VALIDATION: PASSED ✓")

if __name__ == '__main__':
    # Validate the reference file
    parse_exr_header('/home/z/my-project/upload/ferndale_studio_07_1k.exr')
    print("\n" + "="*60)