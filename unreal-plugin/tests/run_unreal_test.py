"""
Run the Unreal integration test headless against a real Unreal Editor.

    python unreal-plugin/tests/run_unreal_test.py "E:/UE4/UE_5.8"          (engine root; or set UE_ROOT)
    python unreal-plugin/tests/run_unreal_test.py "E:/UE4/UE_5.8" --install   also test the installed plug-in itself

It builds a throw-away blank project in a temp folder, starts UnrealEditor-Cmd with the test script and prints
the result. The first start of a new engine/project builds caches and can take a few minutes.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.abspath(os.path.join(HERE, "..", "HDRIForgeBridge"))


def main(argv):
    engine = next((a for a in argv if not a.startswith("--")), os.environ.get("UE_ROOT"))
    if not engine:
        print(__doc__)
        return 2
    install = "--install" in argv
    exe = os.path.join(engine, "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe")
    if not os.path.exists(exe):
        print("UnrealEditor-Cmd.exe not found under", engine)
        return 2

    work = tempfile.mkdtemp(prefix="forge_unreal_test_")
    proj = os.path.join(work, "ForgeTest")
    os.makedirs(os.path.join(proj, "Content"))
    plugins = [{"Name": "PythonScriptPlugin", "Enabled": True},
               {"Name": "EditorScriptingUtilities", "Enabled": True},
               {"Name": "HDRIBackdrop", "Enabled": True}]
    if install:
        shutil.copytree(PLUGIN, os.path.join(proj, "Plugins", "HDRIForgeBridge"))
        plugins.append({"Name": "HDRIForgeBridge", "Enabled": True})
    with open(os.path.join(proj, "ForgeTest.uproject"), "w") as f:
        json.dump({"FileVersion": 3, "EngineAssociation": "5.8", "Plugins": plugins}, f)

    out = os.path.join(work, "result.txt")
    env = dict(os.environ, FORGE_TEST_OUT=out, FORGE_PLUGIN_PYTHON=os.path.join(PLUGIN, "Content", "Python"))
    script = os.path.join(HERE, "unreal_integration_test.py").replace("\\", "/")
    # -ExecutePythonScript quits the editor as soon as the script returns, but this test needs the editor to keep
    # ticking (texture imports, actor spawns and the HTTP listener are serviced from the tick), so it is run as a
    # console command instead and quits the editor itself when done. The command line is built by hand: Unreal wants
    # -ExecCmds="py <path>" with the quotes around the whole value, which a list of arguments cannot express.
    cmd = '"%s" "%s" -ExecCmds="py %s" -unattended -nosplash -nullrhi -nop4 -stdout -FullStdOutLogOutput' % (
        exe, os.path.join(proj, "ForgeTest.uproject"), script)
    log = os.path.join(work, "ue.log")
    with open(log, "w") as lf:
        subprocess.run(cmd, env=env, stdout=lf, stderr=subprocess.STDOUT, timeout=900)
    if os.path.exists(out):
        print(open(out).read())
        ok = open(out).read().strip().endswith("ALL PASS")
    else:
        print("no result file; see", log)
        ok = False
    print("work folder:", work)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
