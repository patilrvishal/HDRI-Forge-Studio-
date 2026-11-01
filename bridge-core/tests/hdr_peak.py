"""
Find the brightest spot of Forge's streamed HDRI, and the direction Forge means by it.

Used by the Maya orientation test (Maya cannot decode Radiance RLE on its own), and a handy sanity check
that Forge's live encoder writes a valid file. Downloads the newest map through forge_link_core.

    python bridge-core/tests/hdr_peak.py [out.json]

Forge's convention (three.js, Y-up; HDRIExporter.pixelToDirection):
    u = (x + .5) / W,  v = (y + .5) / H   (row 0 = TOP)
    theta = (u - .5) * 2pi,  phi = v * pi
    dir   = (sin(phi) cos(theta), cos(phi), sin(phi) sin(theta))
Maya is also right-handed and Y-up, so that direction is used as-is for Maya.
"""
import json
import math
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import forge_link_core as core  # noqa: E402


def decode_rgbe_rle(data):
    """Radiance .hdr (new-style RLE or flat) -> (width, height, list of (r, g, b) floats, top row first)."""
    m = re.search(rb"\n\n([-+]Y)\s+(\d+)\s+([-+]X)\s+(\d+)\n", data)
    if not m:
        raise ValueError("no resolution line in the .hdr header")
    h, w = int(m.group(2)), int(m.group(4))
    pos = m.end()
    px = []
    for _ in range(h):
        if data[pos] == 2 and data[pos + 1] == 2 and (data[pos + 2] << 8 | data[pos + 3]) == w:
            pos += 4
            chans = []
            for _c in range(4):
                line = bytearray()
                while len(line) < w:
                    n = data[pos]
                    pos += 1
                    if n > 128:
                        line.extend(bytes([data[pos]]) * (n - 128))
                        pos += 1
                    else:
                        line.extend(data[pos:pos + n])
                        pos += n
                chans.append(line)
            for x in range(w):
                r, g, b, e = chans[0][x], chans[1][x], chans[2][x], chans[3][x]
                f = math.ldexp(1.0, e - 136) if e else 0.0
                px.append((r * f, g * f, b * f))
        else:                                       # flat (uncompressed) scanline
            for _x in range(w):
                r, g, b, e = data[pos:pos + 4]
                pos += 4
                f = math.ldexp(1.0, e - 136) if e else 0.0
                px.append((r * f, g * f, b * f))
    return w, h, px


def forge_direction(x, y, w, h):
    u, v = (x + 0.5) / w, (y + 0.5) / h
    theta, phi = (u - 0.5) * 2 * math.pi, v * math.pi
    return (math.sin(phi) * math.cos(theta), math.cos(phi), math.sin(phi) * math.sin(theta))


def top_peaks(w, h, lum, count=2, min_separation_deg=25.0):
    """The `count` brightest spots that are at least `min_separation_deg` apart on the sphere."""
    order = sorted(range(len(lum)), key=lum.__getitem__, reverse=True)
    cos_min = math.cos(math.radians(min_separation_deg))
    peaks = []
    for i in order[: w * 40]:                      # only the brightest ~40 rows' worth of pixels need checking
        x, y = i % w, i // w
        d = forge_direction(x, y, w, h)
        if all(sum(a * b for a, b in zip(d, q["direction"])) < cos_min for q in peaks):
            peaks.append({"pixel": [x, y], "peak": lum[i], "direction": d})
            if len(peaks) == count:
                break
    return peaks


def main(argv):
    frame = core.fetch_latest(tempfile.gettempdir() + "/forge_peak", name="peak")
    with open(frame.path, "rb") as fh:
        w, h, px = decode_rgbe_rle(fh.read())
    lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px]
    peaks = top_peaks(w, h, lum)
    result = {
        "version": frame.version, "width": w, "height": h, "mean": sum(lum) / len(lum),
        "peaks": peaks,
        # kept for the older single-light tests
        "pixel": peaks[0]["pixel"], "peak": peaks[0]["peak"], "direction": peaks[0]["direction"],
    }
    text = json.dumps(result, indent=1)
    print(text)
    if len(argv) > 1:
        with open(argv[1], "w") as f:
            f.write(text)


if __name__ == "__main__":
    main(sys.argv)
