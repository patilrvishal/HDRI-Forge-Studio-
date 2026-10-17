"""
Keep forge_link_core.py identical in every DCC addon folder.

The addons are installed by dropping files into the DCC, so each one needs its
own copy next to it. bridge-core/forge_link_core.py is the only file to edit.

    python bridge-core/sync.py          copy it into blender-addon/ and maya-plugin/
    python bridge-core/sync.py --check  exit 1 if any copy has drifted (use in CI / before a commit)
"""
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = os.path.join(ROOT, "bridge-core", "forge_link_core.py")
TARGETS = [
    os.path.join(ROOT, "blender-addon", "forge_link_core.py"),
    os.path.join(ROOT, "maya-plugin", "forge_link_core.py"),
]


def read(path):
    with open(path, "rb") as f:
        return f.read().replace(b"\r\n", b"\n")      # ignore line-ending differences between checkouts


def main(argv):
    check = "--check" in argv
    src = read(SOURCE)
    bad = []
    for t in TARGETS:
        same = os.path.exists(t) and read(t) == src
        if check:
            print(("ok     " if same else "DRIFT  ") + os.path.relpath(t, ROOT))
            if not same:
                bad.append(t)
        elif not same:
            shutil.copyfile(SOURCE, t)
            print("copied " + os.path.relpath(t, ROOT))
        else:
            print("same   " + os.path.relpath(t, ROOT))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
